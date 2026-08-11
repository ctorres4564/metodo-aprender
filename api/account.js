/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — exclusão de conta.
   =====================================================================
   Bloqueador de monetização: a LGPD garante à pessoa titular dos dados o
   direito de solicitar a eliminação deles a qualquer momento. Até agora
   não existia nenhum jeito de excluir a própria conta — só materiais e
   módulos individualmente.

   Recebe: { action: "delete" }
   Retorna: { ok: true }

   Ordem da exclusão (importante): todos os DADOS primeiro, a conta de
   login (Firebase Authentication) por último. Se algo falhar no meio do
   caminho, é melhor a pessoa ainda conseguir logar e tentar de novo do
   que perder o acesso à própria conta com dados órfãos ainda salvos.

   Usa o Admin SDK (contorna as regras do Firestore, que não permitem ao
   cliente apagar em massa os dados de outras coleções) — só pode ser
   chamado pela própria pessoa dona da conta, dona do token de login
   verificado em verifyUserFromRequest. Não recebe nenhum id de usuário
   no corpo da requisição de propósito — sempre age sobre quem está
   logado(a), nunca sobre um uid arbitrário informado pelo cliente.
   ===================================================================== */

import { verifyUserFromRequest } from "./_lib/usage.js";
import { adminDb, adminAuth, adminStorage } from "./_lib/firebaseAdmin.js";
import { getStripe } from "./_lib/stripe.js";
import { FieldPath } from "firebase-admin/firestore";
import { withSentry } from "./_lib/sentry.js";

const BATCH_SIZE = 400; // margem de segurança abaixo do limite de 500 por batch do Firestore

// Apaga todos os documentos que batem com "queryRef", em lotes, repetindo
// até a consulta voltar vazia — funciona tanto pra poucas dezenas quanto
// pra milhares de documentos (ex.: páginas de um livro grande).
async function deleteQueryInBatches(queryRef) {
  const db = adminDb();
  while (true) {
    const snap = await queryRef.limit(BATCH_SIZE).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < BATCH_SIZE) break;
  }
}

async function deleteMaterialSubcollections(materialRef) {
  await deleteQueryInBatches(materialRef.collection("pages"));
  await deleteQueryInBatches(materialRef.collection("highlights"));
  await deleteQueryInBatches(materialRef.collection("notes"));
  await deleteQueryInBatches(materialRef.collection("generatedModules"));
}

// SEGURANÇA/FINANCEIRO (A1-01): sem isso, excluir a conta apagava todos os
// dados no Firestore mas deixava a assinatura ativa na Stripe rodando —
// a pessoa continuaria sendo cobrada todo mês por uma conta que não existe
// mais e não tem como cancelar sozinha (o Billing Portal exige login).
// Roda ANTES de qualquer exclusão de dados: se falhar, é melhor abortar
// cedo (a pessoa ainda loga e tenta de novo) do que apagar tudo e deixar
// uma cobrança órfã rodando pra sempre.
//
// Os customers são localizados por DUAS fontes (V1-B): o stripeCustomerId
// gravado em users/{uid} E uma busca por e-mail na Stripe — essa segunda
// cobre o caso em que o evento checkout.session.completed se perdeu e o
// campo nunca foi gravado no documento (assinatura órfã continuaria
// cobrando sem essa busca).
const CANCELABLE_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "unpaid", "incomplete"];

async function findStripeCustomerIds(uid, email) {
  const ids = new Set();
  const userSnap = await adminDb().collection("users").doc(uid).get();
  const fromDoc = userSnap.exists ? userSnap.data().stripeCustomerId : null;
  if (fromDoc) ids.add(fromDoc);

  if (email) {
    const stripe = getStripe();
    const customers = await stripe.customers.list({ email, limit: 100 });
    for (const c of customers.data) ids.add(c.id);
  }
  return [...ids];
}

// Melhor esforço (V1-A): sessões de checkout ABERTAS ficam válidas por
// ~24h — se a pessoa exclui a conta com uma sessão aberta numa aba e
// conclui o pagamento depois, uma assinatura nova nasceria pra uma conta
// morta (a segunda linha de defesa é a guarda em stripe-webhook.js).
// Sessões criadas com customer_email (sem customer vinculado ainda) não
// aparecem nessa listagem — por isso o webhook mantém a guarda própria.
// Falhas aqui NÃO abortam a exclusão: no pior caso o webhook cancela a
// assinatura órfã quando o checkout completar.
async function expireOpenCheckoutSessions(stripe, customerId) {
  try {
    const sessions = await stripe.checkout.sessions.list({ customer: customerId, limit: 100 });
    for (const s of sessions.data) {
      if (s.status !== "open") continue;
      try {
        await stripe.checkout.sessions.expire(s.id);
      } catch (e) {
        console.error(`Falha ao expirar sessão de checkout ${s.id} (seguindo em frente):`, e.message);
      }
    }
  } catch (e) {
    console.error(`Falha ao listar sessões de checkout abertas do customer ${customerId} (seguindo em frente):`, e.message);
  }
}

async function cancelStripeSubscriptions(uid, email) {
  const customerIds = await findStripeCustomerIds(uid, email);
  if (customerIds.length === 0) return; // pessoa nunca assinou — nada a cancelar.

  const stripe = getStripe();
  for (const customerId of customerIds) {
    await expireOpenCheckoutSessions(stripe, customerId);
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
    for (const sub of subs.data) {
      if (!CANCELABLE_SUBSCRIPTION_STATUSES.includes(sub.status)) continue;
      await stripe.subscriptions.cancel(sub.id);
    }
  }
}

// progress/{uid}_{storageKey} e ai_usage/{uid}_{ano-mes} usam o uid como
// prefixo determinístico do id do documento (ver firebase-init.js e
// api/_lib/usage.js) — em vez de depender de um campo "uid" gravado
// dentro do documento (que poderia faltar em algum registro antigo), a
// consulta abaixo busca por INTERVALO DE ID diretamente, o que é sempre
// correto e não exige nenhum índice composto no Firestore.
function byIdPrefix(collectionRef, uid) {
  return collectionRef
    .where(FieldPath.documentId(), ">=", `${uid}_`)
    .where(FieldPath.documentId(), "<", `${uid}_`);
}

async function handleDeleteAccount(req, res, user) {
  const uid = user.uid;
  const db = adminDb();

  try {
    // 0. Cancela qualquer assinatura Stripe ativa ANTES de apagar qualquer
    //    dado (ver comentário em cancelStripeSubscriptions). Se isso falhar,
    //    o catch abaixo aborta a exclusão inteira — a pessoa ainda consegue
    //    logar e tentar de novo, em vez de ficar com dados apagados e uma
    //    cobrança que ninguém mais consegue cancelar.
    await cancelStripeSubscriptions(uid, user.email);

    // 1. Materiais: Storage (PDF original) + subcoleções (pages/highlights/
    //    notes) + o documento do material em si.
    const materialsSnap = await db.collection("materials").where("ownerId", "==", uid).get();
    for (const materialDoc of materialsSnap.docs) {
      const data = materialDoc.data();
      await deleteMaterialSubcollections(materialDoc.ref);
      if (data.storagePath) {
        try {
          await adminStorage().file(data.storagePath).delete({ ignoreNotFound: true });
        } catch (e) {
          console.error(`Falha ao excluir arquivo do Storage (${data.storagePath}), continuando:`, e.message);
        }
      }
      await materialDoc.ref.delete();
    }

    // 2. Rede de segurança: qualquer arquivo que tenha sobrado na pasta
    //    desta pessoa no Storage (ex.: upload que falhou antes do material
    //    ser registrado no Firestore) — nunca deve travar o resto da
    //    exclusão se falhar.
    try {
      await adminStorage().deleteFiles({ prefix: `users/${uid}/`, force: true });
    } catch (e) {
      console.error("Falha ao limpar pasta do usuário no Storage (continuando mesmo assim):", e.message);
    }

    // 3. Módulos criados/gerados pela pessoa.
    await deleteQueryInBatches(db.collection("modules").where("ownerId", "==", uid));

    // 4. Progresso de estudo (uma "ficha" de conteúdo por módulo estudado).
    await deleteQueryInBatches(byIdPrefix(db.collection("progress"), uid));

    // 5. Contador mensal de uso de IA.
    await deleteQueryInBatches(byIdPrefix(db.collection("ai_usage"), uid));

    // 6. Perfil (plano, preferência de lembrete por e-mail, id de cliente
    //    da Stripe).
    await db.collection("users").doc(uid).delete();

    // 7. Por último, a conta em si no Firebase Authentication — depois
    //    disso a pessoa não consegue mais logar com este e-mail.
    try {
      await adminAuth().deleteUser(uid);
    } catch (e) {
      console.error("Falha ao excluir usuário do Firebase Auth (os dados já foram apagados):", e.message);
      res.status(500).json({
        error: "Seus dados foram apagados, mas houve um problema ao remover o acesso de login em si. Tente sair e entrar de novo, ou entre em contato pra confirmarmos a exclusão."
      });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("Erro ao excluir conta:", e);
    res.status(500).json({ error: "Não foi possível excluir sua conta agora. Tente novamente em alguns minutos." });
  }
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const user = await verifyUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Sessão expirada ou inválida. Faça login novamente e tente de novo." });
    return;
  }

  const { action } = req.body || {};

  switch (action) {
    case "delete":
      return handleDeleteAccount(req, res, user);
    default:
      res.status(400).json({ error: "action inválida (use 'delete')." });
  }
}

export default withSentry(handler);
