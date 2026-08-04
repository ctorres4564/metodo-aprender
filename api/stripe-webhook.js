/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — recebe eventos da Stripe sobre assinaturas
   e mantém users/{uid}.plan sincronizado ("free" ou "premium").
   =====================================================================
   Esta função NÃO é chamada pelo navegador — é a Stripe quem chama,
   direto no servidor, sempre que algo muda numa assinatura (criada,
   renovada, cancelada, pagamento falhou etc).

   Importante: a verificação de assinatura da Stripe exige o corpo BRUTO
   da requisição (não o JSON já interpretado) — por isso o bodyParser
   automático da Vercel é desligado abaixo (`config.api.bodyParser`) e o
   corpo é lido manualmente como buffer.

   Como o uid chega até aqui: ao criar o checkout (api/criar-checkout.js),
   o uid é gravado em subscription_data.metadata.uid — então todo evento
   de assinatura já carrega o uid junto, sem precisar consultar nada.

   Variáveis de ambiente necessárias:
   - STRIPE_SECRET_KEY      chave secreta da Stripe.
   - STRIPE_WEBHOOK_SECRET  segredo de assinatura do endpoint (gerado ao
                             criar o webhook no painel da Stripe).
   ===================================================================== */

import { getStripe } from "./_lib/stripe.js";
import { adminDb } from "./_lib/firebaseAdmin.js";

export const config = {
  api: { bodyParser: false }
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// DADOS (A1-01): um "set(..., {merge:true})" incondicional recria o
// documento users/{uid} do zero se ele não existir — o que acontece
// sempre que um evento de ASSINATURA (subscription.created/updated/
// deleted) chega DEPOIS de a pessoa já ter excluído a conta (ver
// api/account.js: cancelamos a assinatura na Stripe como parte da
// exclusão, e a Stripe manda esses eventos de volta de forma assíncrona,
// já sem o documento correspondente no Firestore). Sem checar existência
// antes, a conta "ressuscitava" com só os campos daquele evento (plan,
// stripeSubscriptionStatus), sem o resto do perfil, e sem que a pessoa
// tenha pedido isso.
//
// "checkout.session.completed" é diferente E NÃO usa esta guarda (ver
// createUserFields abaixo): esse evento só existe porque uma pessoa está,
// nesse exato momento, terminando um checkout ativo no navegador — é o
// próprio momento legítimo de primeira criação do documento users/{uid}
// (que não é criado em nenhum outro lugar antes da primeira assinatura;
// ver assets/firebase-init.js saveUserProfile, só chamado ao mexer no
// toggle de lembretes). Bloquear esse evento quebraria a ativação do
// plano Premium para qualquer pessoa que assine sem nunca ter mexido
// nesse toggle.
async function setUserFields(uid, fields) {
  if (!uid) {
    console.error("Evento da Stripe sem uid em metadata — ignorado.");
    return;
  }
  const ref = adminDb().collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    console.warn(`Evento de assinatura da Stripe para uid=${uid}, mas a conta já foi excluída — ignorado.`);
    return;
  }
  await ref.set(fields, { merge: true });
}

async function createUserFields(uid, fields) {
  if (!uid) {
    console.error("Evento da Stripe sem uid em metadata — ignorado.");
    return;
  }
  await adminDb().collection("users").doc(uid).set(fields, { merge: true });
}

const ACTIVE_STATUSES = ["trialing", "active"];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET não configurada no servidor.");
    res.status(500).end();
    return;
  }

  let event;
  try {
    const sig = req.headers["stripe-signature"];
    const rawBody = await buffer(req);
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error("Assinatura do webhook Stripe inválida:", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      // Checkout concluído: grava o customerId da Stripe no perfil da pessoa,
      // pra poder abrir o Billing Portal depois (api/stripe-portal.js).
      case "checkout.session.completed": {
        const session = event.data.object;
        const uid = session.client_reference_id || (session.metadata && session.metadata.uid);
        if (uid && session.customer) {
          await createUserFields(uid, { stripeCustomerId: session.customer });
        }
        break;
      }

      // Assinatura criada/alterada: reflete o status atual (trial, ativa,
      // atrasada, cancelada...) no campo "plan" usado por api/_lib/usage.js.
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const uid = subscription.metadata && subscription.metadata.uid;
        const isActive = ACTIVE_STATUSES.includes(subscription.status);
        await setUserFields(uid, {
          plan: isActive ? "premium" : "free",
          stripeSubscriptionStatus: subscription.status
        });
        break;
      }

      // Assinatura cancelada/expirada de vez: volta pro plano free.
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const uid = subscription.metadata && subscription.metadata.uid;
        await setUserFields(uid, { plan: "free", stripeSubscriptionStatus: "canceled" });
        break;
      }

      default:
        // Outros eventos (fatura gerada, pagamento etc.) não afetam o plano — ignorados.
        break;
    }

    res.status(200).json({ received: true });
  } catch (e) {
    console.error("Erro ao processar evento da Stripe:", e);
    // Responde 500 pra Stripe tentar reenviar o evento depois.
    res.status(500).json({ error: "Falha ao processar evento." });
  }
}
