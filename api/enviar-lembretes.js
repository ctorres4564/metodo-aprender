/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — lembrete diário por e-mail (Fase 3b).
   =====================================================================
   Não é chamada pelo navegador do usuário. É disparada automaticamente
   uma vez por dia pelo Vercel Cron (ver vercel.json).

   Fluxo:
   1. Confirma que a chamada veio do Vercel Cron (header Authorization
      com o segredo CRON_SECRET) — sem isso, qualquer pessoa poderia
      disparar envios de e-mail manualmente.
   2. Busca em users/{uid} todo mundo com remindersEnabled == true.
   3. Para cada um, soma as fichas com revisão vencida hoje, em todos os
      módulos que essa pessoa estuda (coleção progress, filtrando por uid).
   4. Se houver pelo menos 1 ficha vencida, envia um e-mail via Resend.
      Quem não tem nada vencido hoje não recebe e-mail (evita notificação
      vazia / spam).

   Escalabilidade (ver processUsersWithConcurrency): os usuários são
   processados em paralelo, mas com um limite de concorrência (no máximo
   MAX_CONCURRENCY simultâneos) — não um Promise.all disparando tudo de
   uma vez (que sobrecarregaria Firestore/Auth/Resend numa conta com
   muitos usuários), nem um loop sequencial (lento, escala mal). Uma
   falha ou timeout em um usuário nunca impede o processamento dos
   demais. Mesma lógica de "quem recebe e-mail e por quê" de sempre —
   só a forma de percorrer a lista mudou.

   Variáveis de ambiente necessárias:
   - CRON_SECRET          segredo compartilhado com o Vercel Cron (ver
                           vercel.json + documentação do Vercel: quando
                           existe uma env var CRON_SECRET, o Vercel já
                           envia esse valor automaticamente no header
                           Authorization das chamadas de cron).
   - RESEND_API_KEY        chave de API da Resend (resend.com).
   - REMINDER_FROM_EMAIL   opcional, remetente do e-mail. Enquanto o
                           domínio não estiver verificado na Resend, só é
                           possível usar "onboarding@resend.dev" e só é
                           possível enviar para o e-mail da própria conta
                           Resend (modo sandbox/teste).
   - APP_URL               opcional, link incluído no e-mail (padrão:
                           https://metodo-aprender-ten.vercel.app).
   ===================================================================== */

import { adminAuth, adminDb } from "./_lib/firebaseAdmin.js";
import { withSentry } from "./_lib/sentry.js";

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_EMAIL = process.env.REMINDER_FROM_EMAIL || "onboarding@resend.dev";
const APP_URL = process.env.APP_URL || "https://metodo-aprender-ten.vercel.app";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function countDueCards(state) {
  if (!state || !state.cards) return 0;
  const t = todayStr();
  let count = 0;
  for (const cardId in state.cards) {
    const c = state.cards[cardId];
    if (c && c.seen && c.nextReview && c.nextReview <= t) count++;
  }
  return count;
}

async function sendReminderEmail(email, dueCount) {
  const subject = dueCount === 1
    ? "Você tem 1 revisão pendente no Método Aprender"
    : `Você tem ${dueCount} revisões pendentes no Método Aprender`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color:#1c2e22;">
      <h2 style="margin-bottom:4px;">🧠 Método Aprender</h2>
      <p>Olá! Você tem <b>${dueCount} ficha${dueCount === 1 ? "" : "s"}</b> esperando revisão hoje.</p>
      <p>Revisar no dia certo é o que faz a repetição espaçada funcionar — alguns minutos agora evitam
        ter que reaprender tudo depois.</p>
      <p style="margin-top:20px;">
        <a href="${APP_URL}" style="background:#6fcf7d; color:#0f1a14; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight:bold; display:inline-block;">
          Revisar agora
        </a>
      </p>
      <p style="margin-top:24px; font-size:12px; color:#7c8f83;">
        Você está recebendo este e-mail porque ativou lembretes diários no Método Aprender.
        Para desativar, entre no app → aba Progresso → desligue "Lembrete diário por e-mail".
      </p>
    </div>
  `;

  const resp = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject, html })
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Resend respondeu ${resp.status}: ${errText}`);
  }
}

const MAX_CONCURRENCY = 10;
// Generoso o bastante pra cobrir 1 leitura no Auth + 1 consulta no
// Firestore + 1 chamada à Resend com folga, mas curto o bastante pra
// nunca deixar um usuário travado (rede lenta, serviço externo pendurado)
// seguro o lote inteiro — o processamento dos demais usuários continua
// normalmente assim que o timeout estoura.
const PER_USER_TIMEOUT_MS = 20000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout de ${ms}ms ao processar ${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Processa UM usuário e devolve o desfecho, sem nunca lançar erro pra
// fora (isolamento de erro por usuário) — quem chama só precisa olhar
// o campo "outcome". "skipped" é um desfecho normal (não é falha): a
// pessoa não tem e-mail verificado, ou não tem nada vencido hoje.
// "failed" é reservado pra falha real de leitura/envio.
async function processUser(uid, db) {
  // SEGURANÇA (SEC-02): o campo users/{uid}.email é gravável pelo próprio
  // usuário (ver firestore.rules.txt) e não serve como destino de envio —
  // seria possível cadastrar o endereço de outra pessoa e mandar e-mails
  // para ela. O destinatário é SEMPRE o e-mail verificado do Firebase
  // Auth, que só o provedor de identidade pode atestar.
  let email = null;
  try {
    const authUser = await adminAuth().getUser(uid);
    if (authUser.email && authUser.emailVerified) email = authUser.email;
  } catch (e) {
    console.error(`Falha ao ler a conta ${uid} no Auth:`, e.message);
    return { uid, outcome: "failed" };
  }
  if (!email) return { uid, outcome: "skipped" };

  try {
    const progressSnap = await db.collection("progress").where("uid", "==", uid).get();
    let totalDue = 0;
    progressSnap.forEach((p) => {
      totalDue += countDueCards(p.data().state);
    });

    if (totalDue === 0) return { uid, outcome: "skipped" };

    await sendReminderEmail(email, totalDue);
    return { uid, outcome: "sent" };
  } catch (e) {
    console.error(`Falha ao processar lembrete para ${uid}:`, e.message);
    return { uid, outcome: "failed" };
  }
}

// Processa a lista inteira com no máximo "limit" usuários em andamento ao
// mesmo tempo: cada "worker" pega o próximo uid de um índice compartilhado
// e segue até a lista acabar. Diferente de Promise.all(users.map(...)),
// que dispararia TODOS de uma vez — aqui só existem "limit" operações
// em voo simultaneamente, não importa quantos usuários existam no total.
async function processUsersWithConcurrency(uids, db, limit) {
  const results = new Array(uids.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= uids.length) return;
      const uid = uids[i];
      try {
        results[i] = await withTimeout(processUser(uid, db), PER_USER_TIMEOUT_MS, `uid=${uid}`);
      } catch (e) {
        // Só cai aqui em timeout (processUser já trata os próprios erros
        // internamente) — conta como falha isolada e o worker segue pro
        // próximo usuário normalmente.
        console.error(`Timeout/falha isolada ao processar ${uid}:`, e.message);
        results[i] = { uid, outcome: "failed" };
      }
    }
  }

  const workerCount = Math.min(limit, uids.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function handler(req, res) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "Não autorizado." });
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    res.status(500).json({ error: "RESEND_API_KEY não configurada." });
    return;
  }

  const db = adminDb();

  try {
    const usersSnap = await db.collection("users").where("remindersEnabled", "==", true).get();
    const uids = usersSnap.docs.map((d) => d.id);

    const results = await processUsersWithConcurrency(uids, db, MAX_CONCURRENCY);

    const failedUids = results.filter((r) => r.outcome === "failed").map((r) => r.uid);
    const summary = {
      usuariosProcessados: results.length,
      enviados: results.filter((r) => r.outcome === "sent").length,
      ignorados: results.filter((r) => r.outcome === "skipped").length,
      falhas: failedUids.length,
      uidsComFalha: failedUids
    };

    res.status(200).json(summary);
  } catch (e) {
    console.error("Falha geral ao enviar lembretes:", e);
    res.status(500).json({ error: e.message });
  }
}

export default withSentry(handler);
