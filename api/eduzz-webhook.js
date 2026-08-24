import { createHmac, timingSafeEqual } from "node:crypto";
import { adminDb } from "./_lib/firebaseAdmin.js";
import { withSentry } from "./_lib/sentry.js";
import {
  buildRedditPurchaseEvent,
  hasAllowedProduct,
  parseAllowedProductIds,
  sendRedditConversion,
  sha256Hex,
} from "./_lib/redditConversions.js";
import {
  claimPurchaseEvent,
  markPurchaseFailed,
  markPurchaseSent,
} from "./_lib/redditPurchaseStore.js";

export const config = { api: { bodyParser: false } };

const LOG_SCOPE = "eduzz_reddit_capi";
const SAFE_LOG_FIELDS = new Set([
  "correlation_id",
  "error_code",
  "http_status",
  "mode",
  "reason",
]);
const SAFE_REDDIT_ERROR_CODES = new Set(["reddit_http_error", "reddit_timeout"]);

function correlationId(invoiceId) {
  if (typeof invoiceId !== "string" && typeof invoiceId !== "number") return undefined;
  const normalized = String(invoiceId).trim();
  return normalized ? sha256Hex(normalized).slice(0, 24) : undefined;
}

function auditLog(logger, level, stage, fields = {}) {
  const entry = { scope: LOG_SCOPE, stage };
  for (const [key, value] of Object.entries(fields)) {
    if (SAFE_LOG_FIELDS.has(key) && value !== undefined && value !== null && value !== "") {
      entry[key] = value;
    }
  }
  const write = typeof logger?.[level] === "function" ? logger[level] : logger?.log;
  if (typeof write === "function") write.call(logger, JSON.stringify(entry));
}

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
  const logger = deps.logger || console;

  return async function handler(req, res) {
    auditLog(logger, "info", "webhook_received");
    if (req.method !== "POST") {
      auditLog(logger, "warn", "event_ignored", { reason: "method_not_allowed" });
      res.status(405).end();
      return;
    }

    let rawBody;
    let payload;
    try {
      rawBody = await readRawBody(req);
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      auditLog(logger, "warn", "event_ignored", { reason: "invalid_json" });
      res.status(400).json({ error: "Payload inválido." });
      return;
    }

    if (payload?.event === "ping") {
      auditLog(logger, "info", "ping_received");
      res.status(200).json({ received: true, ping: true });
      return;
    }

    const logContext = { correlation_id: correlationId(payload?.data?.id) };

    const webhookSecret = process.env.EDUZZ_WEBHOOK_SECRET;
    const signature = req.headers?.["x-signature"];
    if (!webhookSecret) {
      auditLog(logger, "error", "configuration_error", {
        ...logContext,
        error_code: "missing_webhook_secret",
      });
      res.status(500).json({ error: "Webhook indisponível." });
      return;
    }
    if (!isValidEduzzSignature(rawBody, signature, webhookSecret)) {
      auditLog(logger, "warn", "signature_invalid", logContext);
      res.status(401).json({ error: "Assinatura inválida." });
      return;
    }
    auditLog(logger, "info", "signature_validated", logContext);

    if (payload?.event !== "myeduzz.invoice_paid") {
      auditLog(logger, "info", "event_ignored", { ...logContext, reason: "unsupported_event" });
      res.status(200).json({ received: true, processed: false, reason: "ignored_event" });
      return;
    }
    if (payload?.data?.status !== "paid") {
      auditLog(logger, "info", "event_ignored", { ...logContext, reason: "status_not_paid" });
      res.status(200).json({ received: true, processed: false, reason: "ignored_event" });
      return;
    }

    const allowedProductIds = parseAllowedProductIds(process.env.EDUZZ_PRODUCT_IDS);
    if (!hasAllowedProduct(payload.data, allowedProductIds)) {
      auditLog(logger, "info", "product_rejected", { ...logContext, reason: "not_allowlisted" });
      res.status(200).json({ received: true, processed: false, reason: "product_not_allowed" });
      return;
    }
    auditLog(logger, "info", "product_allowed", logContext);

    const mode = purchaseMode();
    auditLog(logger, "info", "purchase_mode_identified", { ...logContext, mode });
    if (mode === "off") {
      auditLog(logger, "info", "event_ignored", { ...logContext, reason: "purchase_disabled" });
      res.status(200).json({ received: true, processed: false, reason: "purchase_disabled" });
      return;
    }

    const testId = process.env.REDDIT_CAPI_TEST_ID;
    if (mode === "test" && !testId) {
      auditLog(logger, "error", "configuration_error", {
        ...logContext,
        error_code: "missing_test_id",
      });
      res.status(500).json({ error: "Modo de teste incompleto." });
      return;
    }

    let event;
    try {
      event = buildRedditPurchaseEvent(payload.data);
    } catch (error) {
      auditLog(logger, "warn", "event_ignored", {
        ...logContext,
        reason: "invalid_purchase_fields",
      });
      res.status(400).json({ error: error.message });
      return;
    }
    auditLog(logger, "info", "purchase_prepared", logContext);

    let claimResult;
    try {
      claimResult = await claim(getDb(), event.metadata.conversion_id);
    } catch {
      auditLog(logger, "error", "idempotency_failed", {
        ...logContext,
        error_code: "firestore_claim_failed",
      });
      res.status(500).json({ error: "Falha temporária de idempotência." });
      return;
    }

    if (claimResult.status === "duplicate") {
      auditLog(logger, "info", "event_duplicate", logContext);
      res.status(200).json({ received: true, processed: false, duplicate: true });
      return;
    }
    if (claimResult.status === "in_progress") {
      auditLog(logger, "warn", "event_in_progress", logContext);
      res.status(503).json({ error: "Evento já está em processamento." });
      return;
    }

    try {
      auditLog(logger, "info", "reddit_send_attempt", logContext);
      await sendConversion({
        accessToken: process.env.REDDIT_CAPI_ACCESS_TOKEN,
        pixelId: process.env.REDDIT_PIXEL_ID,
        event,
        testId: mode === "test" ? testId : undefined,
        onResponseStatus: ({ status }) => {
          auditLog(logger, "info", "reddit_response", {
            ...logContext,
            http_status: status,
          });
        },
      });
      await markSent(claimResult.ref);
      auditLog(logger, "info", "reddit_send_completed", logContext);
      res.status(200).json({ received: true, processed: true });
    } catch (error) {
      await markFailed(claimResult.ref, error?.code).catch(() => {});
      auditLog(logger, "error", "reddit_send_failed", {
        ...logContext,
        error_code: SAFE_REDDIT_ERROR_CODES.has(error?.code) ? error.code : "unknown",
      });
      res.status(502).json({ error: "Falha temporária ao registrar conversão." });
    }
  };
}

export default withSentry(createEduzzWebhookHandler());
