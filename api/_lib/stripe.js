/* =====================================================================
   Cliente da Stripe (uso exclusivo no servidor).
   =====================================================================
   Requer a variável de ambiente STRIPE_SECRET_KEY na Vercel (chave
   secreta da Stripe — nunca exposta no navegador).
   ===================================================================== */
import Stripe from "stripe";

let _stripe = null;

export function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY não configurada no servidor.");
    _stripe = new Stripe(key);
  }
  return _stripe;
}
