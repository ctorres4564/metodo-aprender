/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — cria uma sessão do Billing Portal da
   Stripe, para a pessoa gerenciar ou cancelar a própria assinatura.
   =====================================================================
   Recebe: nada no corpo (usa o token de login para identificar quem é).
   Retorna: { url } — link do portal hospedado pela Stripe.

   Requer que a pessoa já tenha um stripeCustomerId salvo em
   users/{uid} (gravado por api/stripe-webhook.js no primeiro checkout).
   ===================================================================== */

import { verifyUserFromRequest } from "./_lib/usage.js";
import { getStripe } from "./_lib/stripe.js";
import { adminDb } from "./_lib/firebaseAdmin.js";

const APP_URL = process.env.APP_URL || "https://metodo-aprender-ten.vercel.app";

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

  try {
    const snap = await adminDb().collection("users").doc(user.uid).get();
    const customerId = snap.exists ? snap.data().stripeCustomerId : null;
    if (!customerId) {
      res.status(400).json({ error: "Você ainda não tem uma assinatura. Assine o plano Premium primeiro." });
      return;
    }

    const stripe = getStripe();
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}/index.html`
    });

    res.status(200).json({ url: portalSession.url });
  } catch (e) {
    console.error("Erro ao criar sessão do portal Stripe:", e);
    res.status(500).json({ error: "Não foi possível abrir o gerenciamento de assinatura agora. Tente novamente." });
  }
}
