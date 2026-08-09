/* =====================================================================
   Verificação de login + controle de uso mensal de IA por usuário.
   =====================================================================
   Usado por todas as funções que chamam a OpenRouter (avaliar-explicacao,
   gerar-modulo, localizar-secao, gerar-analogia, regenerar-conceito) para garantir que:
   1. Só quem tem conta (login válido) consegue gastar créditos de IA.
   2. Cada pessoa tem um limite mensal de gerações, por plano.

   A cobrança real (Fase 2) já está em produção via Stripe: o campo "plan"
   em users/{uid} é mantido automaticamente pelo webhook (api/stripe-
   webhook.js) conforme o status da assinatura — este arquivo só lê esse
   campo (getUserPlan) para decidir o limite mensal, nunca escreve nele.
   ===================================================================== */
import { adminAuth, adminDb } from "./firebaseAdmin.js";

/* Duas cotas separadas, porque os custos são de ordens de grandeza diferentes.
 *
 * "explain" — avaliar explicação e gerar analogia. Medido em produção: cerca de
 * US$ 0,0009 por avaliação, ou meio centavo de real. Racionar isso não protege
 * nada e contraria o produto: explicar é o fluxo principal, e uma pessoa que
 * bate no teto simplesmente para de usar a coisa que deveria usar todo dia.
 * 300 avaliações/mês no plano gratuito custam menos de R$ 1,50.
 *
 * "generate" — gerar módulo, regenerar conceito e localizar seção. Processam
 * capítulos inteiros de livro e custam muito mais por chamada, então mantêm um
 * teto conservador. Este é o balde que realmente precisa de controle.
 *
 * Antes existia um contador único de 40/mês para tudo, o que fazia a avaliação
 * barata competir por espaço com a geração cara.
 */
const PLAN_LIMITS = {
  explain: { free: 300, premium: 3000 },
  generate: { free: 60, premium: 600 }
};

const DEFAULT_BUCKET = "generate";

function planLimit(bucket, plan) {
  const table = PLAN_LIMITS[bucket] || PLAN_LIMITS[DEFAULT_BUCKET];
  return table[plan] || table.free;
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// O balde "generate" mantém o id de documento antigo (`uid_AAAA-MM`) para não
// zerar nem duplicar a contagem de quem já usou o app neste mês. O balde novo
// ganha sufixo próprio.
function usageDocId(uid, bucket) {
  const base = `${uid}_${currentMonthKey()}`;
  return bucket === DEFAULT_BUCKET ? base : `${base}_${bucket}`;
}

// Extrai e valida o token de login enviado pelo cliente no header
// "Authorization: Bearer <idToken>". Retorna o usuário decodificado (uid,
// email...) ou null se não houver token válido.
export async function verifyUserFromRequest(req) {
  const header = req.headers["authorization"] || req.headers["Authorization"];
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  try {
    return await adminAuth().verifyIdToken(token);
  } catch (e) {
    console.error("Token de login inválido:", e.message);
    return null;
  }
}

// Exportado porque também é usado em api/material.js, pra checar o limite
// de materiais na Biblioteca por plano (mesmo princípio do limite de IA).
export async function getUserPlan(uid) {
  try {
    const snap = await adminDb().collection("users").doc(uid).get();
    if (snap.exists && snap.data().plan) return snap.data().plan;
  } catch (e) {
    console.error("Falha ao ler plano do usuário, usando 'free':", e.message);
  }
  return "free";
}

// Verifica se o usuário ainda tem cota disponível no mês e, se tiver,
// já consome 1 unidade (operação atômica via transação do Firestore).
// Recebe o usuário decodificado (não só o uid) porque também bloqueia
// e-mail não verificado aqui — ver comentário abaixo.
// Retorna { allowed, current, limit, plan, reason? }.
export async function checkAndConsumeUsage(user, bucket = DEFAULT_BUCKET) {
  const uid = user.uid;

  // Bloqueio de e-mail não verificado: sem isso, qualquer pessoa pode criar
  // contas descartáveis pra sempre ter uma cota mensal de IA "nova", sem
  // nunca pagar. `email_verified` já vem no token decodificado pelo
  // Firebase (claim padrão) — não precisa de leitura extra no Firestore.
  // Contas que já existiam antes desta checagem existir também caem aqui
  // até a pessoa verificar o e-mail (ver botão "reenviar e-mail de
  // verificação" no app).
  if (user.email_verified === false) {
    return { allowed: false, current: 0, limit: 0, plan: null, reason: "email_not_verified" };
  }

  const plan = await getUserPlan(uid);
  const limit = planLimit(bucket, plan);
  const db = adminDb();
  const ref = db.collection("ai_usage").doc(usageDocId(uid, bucket));

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data().count || 0 : 0;
    if (current >= limit) {
      return { allowed: false, current, limit, plan, bucket };
    }
    tx.set(ref, { count: current + 1, uid, bucket, updatedAt: Date.now() }, { merge: true });
    return { allowed: true, current: current + 1, limit, plan, bucket };
  });

  return result;
}

// SEGURANÇA/FINANCEIRO (A1-03): checkAndConsumeUsage já consome 1 unidade
// da cota mensal ANTES da chamada à OpenRouter (precisa ser assim — é o
// jeito de garantir atomicidade sem duas transações). Isso significa que
// qualquer falha depois disso (timeout, erro de rede, HTTP não-2xx, JSON
// inválido, ou resposta da IA que não passa na validação do endpoint)
// cobrava da pessoa uma geração que ela nunca recebeu. refundUsage
// devolve exatamente 1 unidade ao contador do mês corrente — chamada por
// cada endpoint de IA em todo caminho de falha após checkAndConsumeUsage
// e antes de uma resposta 200 válida ao cliente. Nunca deixa o contador
// negativo, e nunca lança erro (uma falha ao estornar não deve virar um
// erro 500 pro usuário, que já está lidando com a falha original).
export async function refundUsage(uid, bucket = DEFAULT_BUCKET) {
  if (!uid) return;
  const db = adminDb();
  const ref = db.collection("ai_usage").doc(usageDocId(uid, bucket));
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? snap.data().count || 0 : 0;
      if (current <= 0) return;
      tx.set(ref, { count: current - 1, updatedAt: Date.now() }, { merge: true });
    });
  } catch (e) {
    console.error(`Falha ao estornar cota de IA para uid=${uid} (seguindo em frente):`, e.message);
  }
}

// Chamado no início dos 5 endpoints de IA (avaliar-explicacao, gerar-
// analogia, gerar-modulo, localizar-secao, regenerar-conceito — ver V3-C):
// garante login + cota numa única chamada, e já escreve a resposta de erro
// (401/403/429) se algo bloquear. Retorna o uid se estiver tudo certo, ou
// null se já respondeu com erro (o chamador só precisa checar `if (!uid)
// return;`). Antes desta adoção, cada endpoint duplicava esse bloco quase
// palavra por palavra, chamando verifyUserFromRequest + checkAndConsumeUsage
// separadamente — essa duplicação era o próprio helper, só que sem nunca
// ser usado.
export async function requireUsageQuota(req, res, bucket = DEFAULT_BUCKET) {
  const user = await verifyUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Sessão expirada ou inválida. Faça login novamente e tente de novo." });
    return null;
  }

  const usage = await checkAndConsumeUsage(user, bucket);
  if (!usage.allowed) {
    if (usage.reason === "email_not_verified") {
      res.status(403).json({
        error: "Confirme seu e-mail antes de gerar conteúdo com IA. Reenvie o e-mail de verificação na tela inicial se não o recebeu.",
        code: "email_not_verified"
      });
    } else {
      const what = usage.bucket === "explain" ? "avaliações de explicação" : "gerações de conteúdo";
      res.status(429).json({
        error: `Limite mensal de ${what} atingido (${usage.current}/${usage.limit} no plano ${usage.plan}). O limite é renovado no início do próximo mês.`
      });
    }
    return null;
  }

  return user.uid;
}
