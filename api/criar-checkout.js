/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — cria uma sessão de Checkout da Stripe
   para a pessoa logada assinar o plano Premium.
   =====================================================================
   Recebe: nada no corpo (usa o token de login para identificar quem é).
   Retorna: { url } — link da página de pagamento hospedada pela Stripe,
   para onde o navegador deve ser redirecionado.

   Variáveis de ambiente necessárias:
   - STRIPE_SECRET_KEY  chave secreta da Stripe.
   - STRIPE_PRICE_ID    id do preço recorrente do plano Premium (criado
                         no painel da Stripe: Produtos → criar produto
                         com preço mensal recorrente).
   - APP_URL            opcional, base para os links de volta após o
                         checkout (padrão: metodo-aprender-ten.vercel.app).
   ===================================================================== */

import { verifyUserFromRequest } from "./_lib/usage.js";
import { getStripe } from "./_lib/stripe.js";
import { adminDb } from "./_lib/firebaseAdmin.js";
import { FieldValue } from "firebase-admin/firestore";
import { withSentry } from "./_lib/sentry.js";

const APP_URL = process.env.APP_URL || "https://metodo-aprender-ten.vercel.app";
const TRIAL_DAYS = 7;

// FINANCEIRO (V4-A): lock anti-corrida. Duas chamadas simultâneas (duplo
// clique, duas abas, retry de rede) passavam juntas pela checagem de
// assinatura (nenhuma subscription existia ainda) e criavam DUAS sessões —
// pra primeiro assinante, isso criava também DOIS customers na Stripe, e o
// webhook só grava um stripeCustomerId no perfil: a assinatura do outro
// customer ficava invisível até pra exclusão de conta. O lock é um
// timestamp em users/{uid} gravado em transação: só uma chamada por vez
// avança. O TTL cobre crashes — um lock esquecido expira sozinho.
const CHECKOUT_LOCK_TTL_MS = 5 * 60 * 1000;

// V4-B: uma subscription "incomplete" é um pagamento que falhou ou foi
// abandonado no checkout — a Stripe a expira sozinha em ~23-24h. Bloquear
// por ela impedia a pessoa de tentar pagar de novo. Regra: incomplete
// RECENTE bloqueia (pagamento pode estar em andamento neste momento);
// incomplete antiga é cancelada aqui (antecipando a expiração automática)
// e o novo checkout segue normalmente.
const INCOMPLETE_RECENT_MS = 60 * 60 * 1000;

// Assinaturas nesses status representam cobrança vigente ou iminente —
// nunca se cria outra enquanto uma dessas existir.
const BLOCKING_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "unpaid"];

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

  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    res.status(500).json({ error: "STRIPE_PRICE_ID não configurada no servidor." });
    return;
  }

  const db = adminDb();
  const userRef = db.collection("users").doc(user.uid);

  // Adquire o lock de checkout (transação). Efeito colateral proposital:
  // o set merge CRIA o documento users/{uid} para quem nunca teve um —
  // é isso que permite ao webhook (stripe-webhook.js) distinguir um
  // checkout legítimo de um checkout concluído após exclusão de conta.
  let lockTs = null;
  try {
    lockTs = await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const currentLock = snap.exists ? snap.data().checkoutInProgress : null;
      if (typeof currentLock === "number" && Date.now() - currentLock < CHECKOUT_LOCK_TTL_MS) {
        return null; // outra criação de checkout em andamento
      }
      const ts = Date.now();
      tx.set(userRef, { checkoutInProgress: ts }, { merge: true });
      return ts;
    });
  } catch (e) {
    console.error("Erro ao adquirir lock de checkout:", e);
    res.status(500).json({ error: "Não foi possível iniciar o checkout agora. Tente novamente." });
    return;
  }
  if (lockTs === null) {
    res.status(409).json({
      error: "Já existe uma criação de checkout em andamento. Aguarde alguns instantes e tente de novo.",
      code: "checkout_in_progress"
    });
    return;
  }

  try {
    const stripe = getStripe();

    // Reaproveita o customer da Stripe se a pessoa já tiver assinado antes
    // (evita criar clientes duplicados a cada tentativa de assinatura).
    const snap = await userRef.get();
    const existingCustomerId = snap.exists ? snap.data().stripeCustomerId : null;

    // FINANCEIRO (A2-05): sem esta checagem, era possível abrir um novo
    // checkout (e cobrar uma segunda assinatura) mesmo já tendo uma ativa.
    // Verifica na própria Stripe (fonte da verdade, não o "plan" do
    // Firestore, que só é atualizado pelo webhook e pode atrasar alguns
    // segundos) se já existe assinatura em andamento pra este customer.
    if (existingCustomerId) {
      const existingSubs = await stripe.subscriptions.list({
        customer: existingCustomerId,
        status: "all",
        limit: 20
      });

      const hasOngoing = existingSubs.data.some((s) => BLOCKING_SUBSCRIPTION_STATUSES.includes(s.status));
      if (hasOngoing) {
        res.status(409).json({
          error: "Você já tem uma assinatura em andamento. Gerencie-a no painel do plano.",
          code: "already_subscribed"
        });
        return;
      }

      const nowMs = Date.now();
      const recentIncomplete = existingSubs.data.find(
        (s) => s.status === "incomplete" && nowMs - s.created * 1000 < INCOMPLETE_RECENT_MS
      );
      if (recentIncomplete) {
        res.status(409).json({
          error: "Existe um pagamento em andamento. Se você abandonou o checkout sem concluir, aguarde alguns minutos e tente de novo.",
          code: "already_subscribed"
        });
        return;
      }

      // Incompletas antigas (pagamento abandonado): cancela pra limpar —
      // a Stripe expiraria sozinha em ~24h, isso só antecipa e destrava
      // uma nova tentativa de assinatura agora.
      for (const s of existingSubs.data) {
        if (s.status !== "incomplete") continue;
        try {
          await stripe.subscriptions.cancel(s.id);
        } catch (e) {
          console.error(`Falha ao cancelar subscription incompleta antiga ${s.id} (seguindo em frente):`, e.message);
        }
      }
    }

    // A idempotency key amarrada ao lock faz um retry de rede da MESMA
    // tentativa reutilizar a sessão já criada em vez de criar outra.
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer: existingCustomerId || undefined,
      customer_email: existingCustomerId ? undefined : (user.email || undefined),
      client_reference_id: user.uid,
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { uid: user.uid }
      },
      allow_promotion_codes: true,
      success_url: `${APP_URL}/index.html?assinatura=sucesso`,
      cancel_url: `${APP_URL}/index.html?assinatura=cancelada`
    }, {
      idempotencyKey: `checkout-${user.uid}-${lockTs}`
    });

    res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("Erro ao criar checkout Stripe:", e);
    res.status(500).json({ error: "Não foi possível iniciar o checkout agora. Tente novamente." });
  } finally {
    // Libera o lock em qualquer desfecho (sucesso, 409, erro). Se falhar
    // — ex.: conta excluída no meio do caminho — o TTL expira sozinho.
    try {
      await userRef.update({ checkoutInProgress: FieldValue.delete() });
    } catch (e) {
      console.error("Falha ao liberar lock de checkout (expira sozinho pelo TTL):", e.message);
    }
  }
}

export default withSentry(handler);
