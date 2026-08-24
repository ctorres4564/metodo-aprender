import { describe, expect, it, vi } from "vitest";
import {
  buildRedditPurchaseEvent,
  buildSyntheticPurchaseEvent,
  canonicalizeEmail,
  canonicalizePhone,
  hasAllowedProduct,
  parseAllowedProductIds,
  purchaseConversionId,
  sendRedditConversion,
  sha256Hex,
} from "./redditConversions.js";

function paidInvoice() {
  return {
    id: "invoice-123",
    status: "paid",
    paidAt: "2026-08-24T12:00:00.000Z",
    paid: { currency: "BRL", value: 47 },
    buyer: {
      id: "buyer-9",
      email: "Al.ice+Livro@Example.com",
      cellphone: "(11) 99999-0000",
      address: { country: "Brasil" },
    },
    items: [{ productId: "book-1", name: "Estudo, mas Esqueço", price: { value: 47 } }],
    totalItems: 1,
    tracker: { code1: "valor-sem-semantica-comprovada" },
  };
}

describe("normalização segura de identificadores Reddit", () => {
  it("normaliza e-mail conforme a orientação do Reddit", () => {
    expect(canonicalizeEmail("Al.ice+Livro@Example.com")).toBe("alice@example.com");
  });

  it("normaliza telefone brasileiro somente quando o país permite inferir +55", () => {
    expect(canonicalizePhone("(11) 99999-0000", "Brasil")).toBe("+5511999990000");
    expect(canonicalizePhone("(11) 99999-0000", "")).toBeNull();
  });
});

describe("buildRedditPurchaseEvent", () => {
  it("mapeia compra paga, aplica hashes e não presume rdt_cid", () => {
    const event = buildRedditPurchaseEvent(paidInvoice());

    expect(event.type.tracking_type).toBe("PURCHASE");
    expect(event.event_at).toBe(Date.parse("2026-08-24T12:00:00.000Z"));
    expect(event.metadata).toMatchObject({
      conversion_id: "eduzz:invoice-123:purchase",
      value: 47,
      currency: "BRL",
      item_count: 1,
    });
    expect(event.user.email).toBe(sha256Hex("alice@example.com"));
    expect(event.user.phone_number).toBe(sha256Hex("+5511999990000"));
    expect(event.user.external_id).toBe(sha256Hex("buyer-9"));
    expect(event).not.toHaveProperty("click_id");
  });

  it("rejeita fatura não paga ou sem dados financeiros válidos", () => {
    expect(() => buildRedditPurchaseEvent({ ...paidInvoice(), status: "open" })).toThrow();
    expect(() => buildRedditPurchaseEvent({ ...paidInvoice(), paid: null })).toThrow();
  });

  it("usa a fatura como conversion_id determinístico", () => {
    expect(purchaseConversionId("abc")).toBe("eduzz:abc:purchase");
  });
});

describe("filtro de produto", () => {
  it("exige allowlist não vazia e item correspondente", () => {
    const allowed = parseAllowedProductIds("book-1, book-2");
    expect(hasAllowedProduct(paidInvoice(), allowed)).toBe(true);
    expect(hasAllowedProduct(paidInvoice(), new Set())).toBe(false);
    expect(hasAllowedProduct(paidInvoice(), new Set(["outro"]))).toBe(false);
  });
});

describe("sendRedditConversion", () => {
  it("envia Bearer, Pixel ID, evento e test_id sem alterar o evento", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { message: "ok" } }),
    });
    const onResponseStatus = vi.fn();
    const event = buildSyntheticPurchaseEvent(1000, "unique");

    await sendRedditConversion({
      accessToken: "token-secreto",
      pixelId: "a2_jilrf2g66w2e",
      testId: "test-id-secreto",
      event,
      fetchImpl,
      onResponseStatus,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toContain("/pixels/a2_jilrf2g66w2e/conversion_events");
    expect(options.headers.authorization).toBe("Bearer token-secreto");
    expect(JSON.parse(options.body)).toEqual({ data: { test_id: "test-id-secreto", events: [event] } });
    expect(onResponseStatus).toHaveBeenCalledWith({ status: 200, ok: true });
  });

  it("omite test_id no modo live", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    await sendRedditConversion({
      accessToken: "token",
      pixelId: "pixel",
      event: buildSyntheticPurchaseEvent(),
      fetchImpl,
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).data).not.toHaveProperty("test_id");
  });

  it("não inclui corpo remoto ou token na mensagem de erro HTTP", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    const onResponseStatus = vi.fn();
    await expect(sendRedditConversion({
      accessToken: "segredo-que-nao-pode-vazar",
      pixelId: "pixel",
      event: buildSyntheticPurchaseEvent(),
      fetchImpl,
      onResponseStatus,
    })).rejects.toMatchObject({ code: "reddit_http_error", status: 401 });
    expect(onResponseStatus).toHaveBeenCalledWith({ status: 401, ok: false });
  });
});
