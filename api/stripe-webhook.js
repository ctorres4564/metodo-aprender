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

async function setUserFields(uid, fields) {
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
          await setUserFields(uid, { stripeCustomerId: session.customer });
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
