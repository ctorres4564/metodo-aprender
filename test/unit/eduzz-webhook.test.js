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

function dependencies(overrides = {}) {
  return {
    getDb: vi.fn(() => ({ name: "db" })),
    claim: vi.fn(async () => ({ status: "claimed", ref: { path: "event/1" } })),
    markSent: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    sendConversion: vi.fn(async () => ({ data: { message: "ok" } })),
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
  });

  it("permanece inerte por padrão no modo off", async () => {
    const deps = dependencies();
    const res = response();
    await createEduzzWebhookHandler(deps)(request(paidPayload()), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.reason).toBe("purchase_disabled");
    expect(deps.getDb).not.toHaveBeenCalled();
    expect(deps.sendConversion).not.toHaveBeenCalled();
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
  });

  it("marca falha retryable e devolve erro para permitir reenvio da Eduzz", async () => {
    vi.stubEnv("REDDIT_PURCHASE_MODE", "test");
    const error = Object.assign(new Error("falha"), { code: "reddit_timeout" });
    const deps = dependencies({ sendConversion: vi.fn(async () => { throw error; }) });
    const res = response();
    await createEduzzWebhookHandler(deps)(request(paidPayload()), res);
    expect(res.statusCode).toBe(502);
    expect(deps.markFailed).toHaveBeenCalledWith({ path: "event/1" }, "reddit_timeout");
  });
});
