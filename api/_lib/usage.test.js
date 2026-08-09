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
// Usuário "decodificado" que adminAuth().verifyIdToken() devolve — só usado
// pelos testes de requireUsageQuota (que passam por verifyUserFromRequest).
// null por padrão: qualquer teste que não configurar isso e tentar validar
// um token recebe um erro, como um token inválido de verdade.
let mockAuthUser = null;

vi.mock("./firebaseAdmin.js", () => ({
  adminDb: () => mockDb,
  adminAuth: () => ({
    async verifyIdToken() {
      if (!mockAuthUser) throw new Error("Token de teste não configurado (mockAuthUser).");
      return mockAuthUser;
    }
  })
}));

const { checkAndConsumeUsage, refundUsage, requireUsageQuota } = await import("./usage.js");

function makeUser(overrides = {}) {
  return { uid: "user-1", email_verified: true, ...overrides };
}

function setPlan(uid, plan) {
  mockDb._set(`users/${uid}`, { plan });
}

// Mock mínimo de req/res no estilo Vercel/Express — só o que
// requireUsageQuota usa (req.headers, res.status().json()).
function makeReq(bearerToken = "token-valido") {
  return { headers: { authorization: `Bearer ${bearerToken}` } };
}
function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

describe("usage.js — cotas de IA", () => {
  beforeEach(() => {
    mockDb = createMockDb();
    mockAuthUser = null;
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

  describe("retry em erro ABORTED do Firestore", () => {
    // Precisa de timers de verdade: o retry usa setTimeout() pra esperar
    // entre tentativas (backoff curto), e o resto do arquivo usa
    // vi.useFakeTimers() (pro teste de troca de mês) — sem isso, o
    // await sleep(...) dentro do retry nunca resolveria sozinho.
    beforeEach(() => {
      vi.useRealTimers();
    });

    function currentMonthKeyReal() {
      const d = new Date();
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    }

    it("se recupera de falhas ABORTED isoladas (menos que o limite de tentativas) sem contar 2x", async () => {
      mockDb._setFailCount(2); // as 2 primeiras tentativas abortam, a 3ª (de 4 possíveis) passa
      const result = await checkAndConsumeUsage(makeUser({ uid: "user-retry-ok" }), "explain");
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(1);
      expect(mockDb._get(`ai_usage/user-retry-ok_${currentMonthKeyReal()}_explain`).count).toBe(1);
    });

    it("desiste depois de esgotar as tentativas SEM lançar exceção — retorna resultado controlado", async () => {
      mockDb._setFailCount(10); // sempre aborta — mais que TRANSACTION_MAX_ATTEMPTS
      // Antes desta correção, isto relançava a exceção (mesmo caminho pro
      // 500 genérico que motivou o retry). Agora precisa resolver, não
      // rejeitar — e sem consumir cota nem fingir que foi "limite atingido".
      const result = await checkAndConsumeUsage(makeUser({ uid: "user-retry-fail" }), "explain");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("transient_error");
      expect(result.reason).not.toBe("email_not_verified");
      // Nenhuma escrita deve ter "vazado" apesar das tentativas.
      expect(mockDb._get(`ai_usage/user-retry-fail_${currentMonthKeyReal()}_explain`)).toBeUndefined();
    });
  });

  describe("requireUsageQuota — resposta HTTP (transient_error não pode virar 'limite atingido')", () => {
    beforeEach(() => {
      vi.useRealTimers(); // mesmo motivo do describe acima: o retry usa setTimeout de verdade
    });

    it("responde 503 (não 429, não 500) quando os retries de ABORTED se esgotam", async () => {
      mockAuthUser = { uid: "user-http-abort", email_verified: true };
      mockDb._setFailCount(10); // sempre aborta
      const req = makeReq();
      const res = makeRes();

      const uid = await requireUsageQuota(req, res, "explain");

      expect(uid).toBeNull(); // mesmo contrato de qualquer bloqueio: null = "já respondi com erro"
      expect(res.statusCode).toBe(503);
      expect(res.body.code).toBe("transient_error");
      expect(res.body.error.toLowerCase()).not.toMatch(/limite/); // não pode parecer "limite atingido"

      // E, claro, continua sem ter consumido cota nenhuma.
      expect(mockDb._get("ai_usage/user-http-abort_2026-08_explain")).toBeUndefined();
    });

    it("continua respondendo 429 normalmente quando é mesmo o limite (não confunde os dois casos)", async () => {
      mockAuthUser = { uid: "user-http-limit", email_verified: true };
      const user = makeUser({ uid: "user-http-limit" });
      for (let i = 0; i < 60; i++) {
        await checkAndConsumeUsage(user, "generate");
      }

      const res = makeRes();
      const uid = await requireUsageQuota(makeReq(), res, "generate");
      expect(uid).toBeNull();
      expect(res.statusCode).toBe(429);
      expect(res.body.code).not.toBe("transient_error");
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
