import { createHash } from "node:crypto";

export const REDDIT_CAPI_BASE_URL = "https://ads-api.reddit.com/api/v3";
export const SALES_PAGE_URL = "https://metodoaprender.com/livro";

function cleanString(value, maxLength = 256) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function sha256Hex(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function canonicalizeEmail(value) {
  const email = cleanString(value, 320).toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;

  const domain = email.slice(at + 1);
  let local = email.slice(0, at);
  local = local.split("+", 1)[0].replaceAll(".", "");
  if (!local || !domain.includes(".")) return null;
  return `${local}@${domain}`;
}

export function canonicalizePhone(value, country) {
  const raw = cleanString(value, 64);
  if (!raw) return null;

  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (raw.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;

  const normalizedCountry = cleanString(country, 32).toLowerCase();
  const isBrazil = ["br", "bra", "brasil", "brazil"].includes(normalizedCountry);
  if (isBrazil && (digits.length === 10 || digits.length === 11)) return `+55${digits}`;
  if (isBrazil && digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) return `+${digits}`;
  return null;
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function parseAllowedProductIds(raw) {
  return new Set(
    cleanString(raw, 2000)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function hasAllowedProduct(invoice, allowedProductIds) {
  if (!(allowedProductIds instanceof Set) || allowedProductIds.size === 0) return false;
  const items = Array.isArray(invoice?.items) ? invoice.items : [];
  return items.some((item) => allowedProductIds.has(String(item?.productId ?? "")));
}

export function purchaseConversionId(invoiceId) {
  const id = cleanString(invoiceId, 200);
  if (!id) throw new Error("Fatura Eduzz sem identificador.");
  return `eduzz:${id}:purchase`;
}

export function buildRedditPurchaseEvent(invoice) {
  if (!invoice || invoice.status !== "paid") throw new Error("A fatura não está paga.");

  const eventAt = Date.parse(invoice.paidAt);
  if (!Number.isFinite(eventAt)) throw new Error("Fatura Eduzz sem paidAt válido.");

  const value = finiteNonNegative(invoice.paid?.value);
  const currency = cleanString(invoice.paid?.currency, 3).toUpperCase();
  if (value === null || !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Fatura Eduzz sem valor pago ou moeda válida.");
  }

  const conversionId = purchaseConversionId(invoice.id);
  const buyer = invoice.buyer || {};
  const email = canonicalizeEmail(buyer.email);
  const phone = canonicalizePhone(
    buyer.cellphone || buyer.phone || buyer.phone2,
    buyer.address?.country,
  );
  const externalId = cleanString(buyer.id, 200);
  const clickId = cleanString(invoice.utm?.term, 256);

  const user = {};
  if (email) user.email = sha256Hex(email);
  if (phone) user.phone_number = sha256Hex(phone);
  if (externalId) user.external_id = sha256Hex(externalId);

  const rawItems = Array.isArray(invoice.items) ? invoice.items : [];
  const products = rawItems.slice(0, 100).flatMap((item) => {
    const id = cleanString(item?.productId, 200);
    const name = cleanString(item?.name, 256);
    const itemPrice = finiteNonNegative(item?.price?.value);
    if (!id || itemPrice === null) return [];
    return [{
      id,
      name: name || id,
      category: "digital_product",
      quantity: 1,
      item_price: itemPrice,
    }];
  });

  const metadata = {
    conversion_id: conversionId,
    currency,
    value,
    item_count: Number.isInteger(invoice.totalItems) && invoice.totalItems >= 0
      ? invoice.totalItems
      : products.length,
  };
  if (products.length) metadata.products = products;

  const event = {
    event_at: eventAt,
    action_source: "WEBSITE",
    event_source_url: SALES_PAGE_URL,
    type: { tracking_type: "PURCHASE" },
    metadata,
  };
  if (Object.keys(user).length) event.user = user;
  if (clickId) event.click_id = clickId;
  return event;
}

export function buildSyntheticPurchaseEvent(now = Date.now(), uniqueId = String(now)) {
  return {
    event_at: now,
    action_source: "WEBSITE",
    event_source_url: SALES_PAGE_URL,
    type: { tracking_type: "PURCHASE" },
    metadata: {
      conversion_id: `reddit-capi-test:${uniqueId}`,
      currency: "BRL",
      value: 47,
      item_count: 1,
      products: [{
        id: "synthetic-test-product",
        name: "Synthetic Reddit CAPI Test",
        category: "digital_product",
        quantity: 1,
        item_price: 47,
      }],
    },
    user: { external_id: sha256Hex("synthetic-reddit-capi-test-user") },
  };
}

export async function sendRedditConversion({
  accessToken,
  pixelId,
  event,
  testId,
  onResponseStatus,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
}) {
  if (!accessToken) throw new Error("REDDIT_CAPI_ACCESS_TOKEN não configurada.");
  if (!pixelId) throw new Error("REDDIT_PIXEL_ID não configurada.");
  if (!event) throw new Error("Evento Reddit ausente.");
  if (typeof fetchImpl !== "function") throw new Error("fetch indisponível.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const data = { events: [event] };
  if (testId) data.test_id = testId;

  try {
    const response = await fetchImpl(
      `${REDDIT_CAPI_BASE_URL}/pixels/${encodeURIComponent(pixelId)}/conversion_events`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ data }),
        signal: controller.signal,
      },
    );
    if (typeof onResponseStatus === "function") {
      onResponseStatus({ status: response.status, ok: response.ok });
    }

    if (!response.ok) {
      const error = new Error(`Reddit CAPI respondeu HTTP ${response.status}.`);
      error.code = "reddit_http_error";
      error.status = response.status;
      throw error;
    }

    return await response.json().catch(() => ({ ok: true }));
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("Timeout ao chamar Reddit CAPI.");
      timeoutError.code = "reddit_timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
