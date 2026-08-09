/* =====================================================================
   TESTES — api/_lib/usage.js (cotas de IA por plano e por balde)
   =====================================================================
   Escopo desta primeira rodada (Fase 1 do plano de testes): só a lógica
   de consumo/estorno de cota, com um mock em memória do Firestore (ver
   test/mocks/firestoreMock.js) — sem tocar em comportamento de produção,
   sem Firebase Emulator, sem Playwright.
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "../../test/mocks/firestoreMock.js";

let mockDb;

vi.mock("./firebaseAdmin.js", () => ({
  adminDb: () => mockDb,
  adminAuth: () => ({})
}));

const { checkAndConsumeUsage, refundUsage } = await import("./usage.js");

function makeUser(overrides = {}) {
  return { uid: "user-1", email_verified: true, ...overrides };
}

function setPlan(uid, plan) {
  mockDb._set(`users/${uid}`, { plan });
}

describe("usage.js — cotas de IA", () => {
  beforeEach(() => {
    mockDb = createMockDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("limites por plano e por balde", () => {
    it("usa o limite 'free' quando o usuário não tem plano definido", async () => {
      const result = await checkAndConsumeUsage(makeUser(), "explain");
      expect(result.allowed).toBe(true);
      expect(result.plan).toBe("free");
      expect(result.limit).toBe(300);
    });

    it("usa o limite 'premium' quando users/{uid}.plan === 'premium'", async () => {
      setPlan("user-1", "premium");
      const result = await checkAndConsumeUsage(makeUser(), "explain");
      expect(result.limit).toBe(3000);
    });

    it("bucket 'generate' tem limites bem menores que 'explain', nos dois planos", async () => {
      const free = await checkAndConsumeUsage(makeUser({ uid: "user-free" }), "generate");
      expect(free.limit).toBe(60);

      setPlan("user-premium", "premium");
      const premium = await checkAndConsumeUsage(makeUser({ uid: "user-premium" }), "generate");
      expect(premium.limit).toBe(600);
    });

    it("consumir 'explain' não afeta a cota de 'generate' e vice-versa (mesmo usuário)", async () => {
      const user = makeUser();
      await checkAndConsumeUsage(user, "explain");
      await checkAndConsumeUsage(user, "explain");
      const generateResult = await checkAndConsumeUsage(user, "generate");
      expect(generateResult.current).toBe(1);
    });
  });

  describe("limite exato", () => {
    it("permite exatamente até o limite (60 no plano free/generate) e bloqueia a próxima chamada", async () => {
      const user = makeUser({ uid: "user-limit" });
      for (let i = 0; i < 60; i++) {
        const r = await checkAndConsumeUsage(user, "generate");
        expect(r.allowed).toBe(true);
      }
      const blocked = await checkAndConsumeUsage(user, "generate");
      expect(blocked.allowed).toBe(false);
      expect(blocked.current).toBe(60);
      expect(blocked.limit).toBe(60);
    });
  });

  describe("e-mail não verificado", () => {
    it("bloqueia sem consumir cota nenhuma", async () => {
      const user = makeUser({ email_verified: false });
      const result = await checkAndConsumeUsage(user, "explain");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("email_not_verified");
      expect(mockDb._get("ai_usage/user-1_2026-08_explain")).toBeUndefined();
    });
  });

  describe("concorrência", () => {
    it("nunca deixa passar mais consumos do que o limite, mesmo com chamadas em paralelo", async () => {
      const user = makeUser({ uid: "user-race" });
      const results = await Promise.all(
        Array.from({ length: 65 }, () => checkAndConsumeUsage(user, "generate"))
      );
      const allowed = results.filter(r => r.allowed);
      expect(allowed.length).toBe(60);

      const doc = mockDb._get("ai_usage/user-race_2026-08");
      expect(doc.count).toBe(60);
    });
  });

  describe("refundUsage", () => {
    it("devolve exatamente 1 unidade ao contador do balde certo", async () => {
      const user = makeUser({ uid: "user-refund" });
      await checkAndConsumeUsage(user, "explain");
      await checkAndConsumeUsage(user, "explain");
      await refundUsage("user-refund", "explain");
      expect(mockDb._get("ai_usage/user-refund_2026-08_explain").count).toBe(1);
    });

    it("nunca deixa o contador negativo quando não há nada a estornar", async () => {
      await refundUsage("user-empty", "explain");
      // current já era 0 e refundUsage não escreve nada nesse caso —
      // o importante é que não vira -1.
      const doc = mockDb._get("ai_usage/user-empty_2026-08_explain");
      expect(doc === undefined || doc.count >= 0).toBe(true);
    });

    it("não lança erro mesmo sem uid (chamada defensiva)", async () => {
      await expect(refundUsage(undefined, "explain")).resolves.toBeUndefined();
    });
  });

  describe("compatibilidade do id do documento", () => {
    it("bucket 'generate' usa o id antigo uid_AAAA-MM, sem sufixo", async () => {
      await checkAndConsumeUsage(makeUser({ uid: "user-legacy" }), "generate");
      expect(mockDb._get("ai_usage/user-legacy_2026-08")).toBeDefined();
    });

    it("bucket 'explain' usa sufixo próprio uid_AAAA-MM_explain", async () => {
      await checkAndConsumeUsage(makeUser({ uid: "user-legacy2" }), "explain");
      expect(mockDb._get("ai_usage/user-legacy2_2026-08_explain")).toBeDefined();
      expect(mockDb._get("ai_usage/user-legacy2_2026-08")).toBeUndefined();
    });
  });

  describe("troca de mês", () => {
    it("reseta a contagem no mês seguinte", async () => {
      const user = makeUser({ uid: "user-month" });
      await checkAndConsumeUsage(user, "explain");
      await checkAndConsumeUsage(user, "explain");

      vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
      const result = await checkAndConsumeUsage(user, "explain");
      expect(result.current).toBe(1);
    });
  });
});
