import { createHmac, timingSafeEqual } from "node:crypto";
import { adminDb } from "./_lib/firebaseAdmin.js";
import { withSentry } from "./_lib/sentry.js";
import {
  buildRedditPurchaseEvent,
  hasAllowedProduct,
  parseAllowedProductIds,
  sendRedditConversion,
} from "./_lib/redditConversions.js";
import {
  claimPurchaseEvent,
  markPurchaseFailed,
  markPurchaseSent,
} from "./_lib/redditPurchaseStore.js";

export const config = { api: { bodyParser: false } };

async function readRawBody(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export function isValidEduzzSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || !signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = String(signature).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
}

function purchaseMode() {
  const mode = String(process.env.REDDIT_PURCHASE_MODE || "off").toLowerCase();
  return ["off", "test", "live"].includes(mode) ? mode : "off";
}

export function createEduzzWebhookHandler(deps = {}) {
  const getDb = deps.getDb || adminDb;
  const claim = deps.claim || claimPurchaseEvent;
  const markSent = deps.markSent || markPurchaseSent;
  const markFailed = deps.markFailed || markPurchaseFailed;
  const sendConversion = deps.sendConversion || sendRedditConversion;

  return async function handler(req, res) {
    if (req.method !== "POST") {
      res.status(405).end();
      return;
    }

    let rawBody;
    let payload;
    try {
      rawBody = await readRawBody(req);
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).json({ error: "Payload inválido." });
      return;
    }

    if (payload?.event === "ping") {
      res.status(200).json({ received: true, ping: true });
      return;
    }

    const webhookSecret = process.env.EDUZZ_WEBHOOK_SECRET;
    const signature = req.headers?.["x-signature"];
    if (!webhookSecret) {
      console.error("EDUZZ_WEBHOOK_SECRET não configurada.");
      res.status(500).json({ error: "Webhook indisponível." });
      return;
    }
    if (!isValidEduzzSignature(rawBody, signature, webhookSecret)) {
      res.status(401).json({ error: "Assinatura inválida." });
      return;
    }

    if (payload?.event !== "myeduzz.invoice_paid" || payload?.data?.status !== "paid") {
      res.status(200).json({ received: true, processed: false, reason: "ignored_event" });
      return;
    }

    const allowedProductIds = parseAllowedProductIds(process.env.EDUZZ_PRODUCT_IDS);
    if (!hasAllowedProduct(payload.data, allowedProductIds)) {
      res.status(200).json({ received: true, processed: false, reason: "product_not_allowed" });
      return;
    }

    const mode = purchaseMode();
    if (mode === "off") {
      res.status(200).json({ received: true, processed: false, reason: "purchase_disabled" });
      return;
    }

    const testId = process.env.REDDIT_CAPI_TEST_ID;
    if (mode === "test" && !testId) {
      console.error("REDDIT_PURCHASE_MODE=test exige REDDIT_CAPI_TEST_ID.");
      res.status(500).json({ error: "Modo de teste incompleto." });
      return;
    }

    let event;
    try {
      event = buildRedditPurchaseEvent(payload.data);
    } catch (error) {
      console.error("Evento pago da Eduzz com campos obrigatórios inválidos.");
      res.status(400).json({ error: error.message });
      return;
    }

    let claimResult;
    try {
      claimResult = await claim(getDb(), event.metadata.conversion_id);
    } catch {
      console.error("Falha ao adquirir idempotência do Purchase Reddit.");
      res.status(500).json({ error: "Falha temporária de idempotência." });
      return;
    }

    if (claimResult.status === "duplicate") {
      res.status(200).json({ received: true, processed: false, duplicate: true });
      return;
    }
    if (claimResult.status === "in_progress") {
      res.status(503).json({ error: "Evento já está em processamento." });
      return;
    }

    try {
      await sendConversion({
        accessToken: process.env.REDDIT_CAPI_ACCESS_TOKEN,
        pixelId: process.env.REDDIT_PIXEL_ID,
        event,
        testId: mode === "test" ? testId : undefined,
      });
      await markSent(claimResult.ref);
      res.status(200).json({ received: true, processed: true });
    } catch (error) {
      await markFailed(claimResult.ref, error?.code).catch(() => {});
      console.error("Falha temporária ao enviar Purchase para Reddit CAPI.");
      res.status(502).json({ error: "Falha temporária ao registrar conversão." });
    }
  };
}

export default withSentry(createEduzzWebhookHandler());
