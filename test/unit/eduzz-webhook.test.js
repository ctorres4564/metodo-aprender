import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEduzzWebhookHandler,
  isValidEduzzSignature,
} from "../../api/eduzz-webhook.js";

const WEBHOOK_SECRET = "segredo-eduzz-apenas-de-teste";

function paidPayload() {
  return {
    id: "webhook-event-1",
    event: "myeduzz.invoice_paid",
    data: {
      id: "invoice-123",
      status: "paid",
      paidAt: "2026-08-24T12:00:00.000Z",
      paid: { currency: "BRL", value: 47 },
      buyer: { id: "buyer-1", email: "buyer@example.com" },
      items: [{ productId: "book-1", name: "Livro", price: { value: 47 } }],
      totalItems: 1,
    },
  };
}

function signature(body, secret = WEBHOOK_SECRET) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function request(payload, { signed = true } = {}) {
  const body = JSON.stringify(payload);
  const req = Readable.from([Buffer.from(body)]);
  req.method = "POST";
  req.headers = signed ? { "x-signature": signature(body) } : {};
  return req;
}

function response() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

function testLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
  };
}

function logEntries(logger) {
  return ["info", "warn", "error", "log"].flatMap((level) =>
    logger[level].mock.calls.map(([message]) => JSON.parse(message)),
  );
}

function dependencies(overrides = {}) {
  return {
    getDb: vi.fn(() => ({ name: "db" })),
    claim: vi.fn(async () => ({ status: "claimed", ref: { path: "event/1" } })),
    markSent: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    sendConversion: vi.fn(async ({ onResponseStatus }) => {
      onResponseStatus?.({ status: 200, ok: true });
      return { data: { message: "ok" } };
    }),
    logger: testLogger(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("EDUZZ_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("EDUZZ_PRODUCT_IDS", "book-1");
  vi.stubEnv("REDDIT_PIXEL_ID", "a2_jilrf2g66w2e");
  vi.stubEnv("REDDIT_CAPI_ACCESS_TOKEN", "token-reddit-apenas-de-teste");
  vi.stubEnv("REDDIT_CAPI_TEST_ID", "test-id-apenas-de-teste");
  vi.stubEnv("REDDIT_PURCHASE_MODE", "off");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assinatura Eduzz", () => {
  it("aceita HMAC-SHA256 correto e rejeita assinatura diferente", () => {
    const body = Buffer.from('{"event":"test"}');
    expect(isValidEduzzSignature(body, signature(body), WEBHOOK_SECRET)).toBe(true);
    expect(isValidEduzzSignature(body, "0".repeat(64), WEBHOOK_SECRET)).toBe(false);
  });
});

describe("POST /api/eduzz-webhook", () => {
  it("responde ping sem produzir efeito colateral", async () => {
    const deps = dependencies();
    const res = response();
    await createEduzzWebhookHandler(deps)(request({ event: "ping", data: { message: "ping" } }, { signed: false }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, ping: true });
    expect(deps.sendConversion).not.toHaveBeenCalled();
    expect(logEntries(deps.logger).map((entry) => entry.stage)).toEqual([
      "webhook_received",
      "ping_received",
    ]);
  });

  it("rejeita assinatura inválida antes de acessar banco ou Reddit", async () => {
    const deps = dependencies();
    const req = request(paidPayload(), { signed: false });
    req.headers["x-signature"] = "0".repeat(64);
    const res = response();
    await createEduzzWebhookHandler(deps)(req, res);
    expect(res.statusCode).toBe(401);
    expect(deps.getDb).not.toHaveBeenCalled();
    expect(deps.sendConversion).not.toHaveBeenCalled();
    expect(logEntries(deps.logger).some((entry) => entry.stage === "signature_invalid")).toBe(true);
  });

  it("ignora evento diferente após validar a assinatura", async () => {
    const deps = dependencies();
    const payload = paidPayload();
    payload.event = "myeduzz.invoice_refunded";
    const res = response();
    await createEduzzWebhookHandler(deps)(request(payload), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.reason).toBe("ignored_event");
    expect(deps.sendConversion).not.toHaveBeenCalled();
    expect(logEntries(deps.logger)).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "signature_validated" }),
      expect.objectContaining({ stage: "event_ignored", reason: "unsupported_event" }),
    ]));
  });

  it("permanece inerte por padrão no modo off", async () => {
    const deps = dependencies();
    const res = response();
    await createEduzzWebhookHandler(deps)(request(paidPayload()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.reason).toBe("purchase_disabled");
    expect(deps.getDb).not.toHaveBeenCalled();
    expect(deps.sendConversion).not.toHaveBeenCalled();
    expect(logEntries(deps.logger)).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "product_allowed" }),
      expect.objectContaining({ stage: "purchase_mode_identified", mode: "off" }),
      expect.objectContaining({ stage: "event_ignored", reason: "purchase_disabled" }),
    ]));
  });

  it("ignora produto fora da allowlist", async () => {
    vi.stubEnv("REDDIT_PURCHASE_MODE", "test");
    vi.stubEnv("EDUZZ_PRODUCT_IDS", "outro-produto");
    const deps = dependencies();
    const res = response();
    await createEduzzWebhookHandler(deps)(request(paidPayload()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.reason).toBe("product_not_allowed");
    expect(deps.sendConversion).not.toHaveBeenCalled();
    expect(logEntries(deps.logger)).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "product_rejected", reason: "not_allowlisted" }),
    ]));
  });

  it("no modo test envia Purchase com Test ID e marca idempotência", async () => {
    vi.stubEnv("REDDIT_PURCHASE_MODE", "test");
    const deps = dependencies();
    const res = response();
    await createEduzzWebhookHandler(deps)(request(paidPayload()), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, processed: true });
    expect(deps.sendConversion).toHaveBeenCalledTimes(1);
    expect(deps.sendConversion.mock.calls[0][0]).toMatchObject({
      accessToken: "token-reddit-apenas-de-teste",
      pixelId: "a2_jilrf2g66w2e",
      testId: "test-id-apenas-de-teste",
    });
    expect(deps.sendConversion.mock.calls[0][0].event.type.tracking_type).toBe("PURCHASE");
    expect(deps.claim).toHaveBeenCalledWith({ name: "db" }, "eduzz:invoice-123:purchase");
    expect(deps.markSent).toHaveBeenCalledWith({ path: "event/1" });
    expect(logEntries(deps.logger)).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "purchase_prepared" }),
      expect.objectContaining({ stage: "reddit_send_attempt" }),
      expect.objectContaining({ stage: "reddit_response", http_status: 200 }),
      expect.objectContaining({ stage: "reddit_send_completed" }),
    ]));
  });

  it("envia click_id e registra somente sua presença quando data.utm.term existe", async () => {
    vi.stubEnv("REDDIT_PURCHASE_MODE", "test");
    const deps = dependencies();
    const payload = paidPayload();
    payload.data.utm = { term: "click-id-secreto" };
    const res = response();
    await createEduzzWebhookHandler(deps)(request(payload), res);

    expect(deps.sendConversion.mock.calls[0][0].event.click_id).toBe("click-id-secreto");
    expect(logEntries(deps.logger)).toContainEqual(expect.objectContaining({
      stage: "purchase_prepared",
      reddit_click_id_sent: true,
    }));
    expect(JSON.stringify(logEntries(deps.logger))).not.toContain("click-id-secreto");
  });

  it("omite click_id e registra ausência quando data.utm.term não existe", async () => {
    vi.stubEnv("REDDIT_PURCHASE_MODE", "test");
    const deps = dependencies();
    const res = response();
    await createEduzzWebhookHandler(deps)(request(paidPayload()), res);

    expect(deps.sendConversion.mock.calls[0][0].event).not.toHaveProperty("click_id");
    expect(logEntries(deps.logger)).toContainEqual(expect.objectContaining({
      stage: "purchase_prepared",
      reddit_click_id_sent: false,
    }));
  });

  it("modo test sem Test ID falha fechado", async () => {
    vi.stubEnv("REDDIT_PURCHASE_MODE", "test");
    vi.stubEnv("REDDIT_CAPI_TEST_ID", "");
    const deps = dependencies();
    const res = response();
    await createEduzzWebhookHandler(deps)(request(paidPayload()), res);
    expect(res.statusCode).toBe(500);
    expect(deps.sendConversion).not.toHaveBeenCalled();
  });

  it("não reenvia evento que o store identifica como duplicado", async () => {
    vi.stubEnv("REDDIT_PURCHASE_MODE", "test");
    const deps = dependencies({ claim: vi.fn(async () => ({ status: "duplicate" })) });
    const res = response();
    await createEduzzWebhookHandler(deps)(request(paidPayload()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(deps.sendConversion).not.toHaveBeenCalled();
    expect(logEntries(deps.logger).some((entry) => entry.stage === "event_duplicate")).toBe(true);
  });

  it("marca falha retryable e devolve erro para permitir reenvio da Eduzz", async () => {
    vi.stubEnv("REDDIT_PURCHASE_MODE", "test");
    const error = Object.assign(new Error("falha"), { code: "reddit_timeout" });
    const deps = dependencies({ sendConversion: vi.fn(async () => { throw error; }) });
    const res = response();
    await createEduzzWebhookHandler(deps)(request(paidPayload()), res);
    expect(res.statusCode).toBe(502);
    expect(deps.markFailed).toHaveBeenCalledWith({ path: "event/1" }, "reddit_timeout");
    expect(logEntries(deps.logger)).toEqual(expect.arrayContaining([
      expect.objectContaining({ stage: "reddit_send_attempt" }),
      expect.objectContaining({ stage: "reddit_send_failed", error_code: "reddit_timeout" }),
    ]));
  });

  it("não registra PII, segredos, payload ou invoiceId original", async () => {
    vi.stubEnv("REDDIT_PURCHASE_MODE", "test");
    const deps = dependencies();
    const payload = paidPayload();
    payload.data.buyer = {
      id: "buyer-sensitive-id",
      email: "pessoa.secreta@example.com",
      cellphone: "+5511999999999",
      name: "Nome Muito Sensível",
      document: "12345678900",
      address: { street: "Rua Particular", country: "BR" },
    };
    const rawPayload = JSON.stringify(payload);
    const res = response();
    await createEduzzWebhookHandler(deps)(request(payload), res);

    const serializedLogs = JSON.stringify(logEntries(deps.logger));
    for (const sensitiveValue of [
      WEBHOOK_SECRET,
      "token-reddit-apenas-de-teste",
      "test-id-apenas-de-teste",
      "invoice-123",
      "buyer-sensitive-id",
      "pessoa.secreta@example.com",
      "+5511999999999",
      "Nome Muito Sensível",
      "12345678900",
      "Rua Particular",
      rawPayload,
    ]) {
      expect(serializedLogs).not.toContain(sensitiveValue);
    }
    expect(logEntries(deps.logger).every((entry) =>
      Object.keys(entry).every((key) => [
        "scope",
        "stage",
        "correlation_id",
        "error_code",
        "http_status",
        "mode",
        "reason",
        "reddit_click_id_sent",
      ].includes(key)),
    )).toBe(true);
  });
});
