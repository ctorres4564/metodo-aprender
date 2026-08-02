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

const APP_URL = process.env.APP_URL || "https://metodo-aprender-ten.vercel.app";
const TRIAL_DAYS = 7;

export default async function handler(req, res) {
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

  try {
    const stripe = getStripe();

    // Reaproveita o customer da Stripe se a pessoa já tiver assinado antes
    // (evita criar clientes duplicados a cada tentativa de assinatura).
    const snap = await adminDb().collection("users").doc(user.uid).get();
    const existingCustomerId = snap.exists ? snap.data().stripeCustomerId : null;

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
    });

    res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("Erro ao criar checkout Stripe:", e);
    res.status(500).json({ error: "Não foi possível iniciar o checkout agora. Tente novamente." });
  }
}
