import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock da função de verificação do usuário
let mockUser = null;
vi.mock("../../api/_lib/usage.js", () => ({
  verifyUserFromRequest: async () => mockUser
}));

// Mock do sentry
vi.mock("../../api/_lib/sentry.js", () => ({
  withSentry: (handler) => handler
}));

const { default: handler } = await import("../../api/suporte.js");

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

describe("api/suporte.js", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, RESEND_API_KEY: "fake_resend_key" };
    mockUser = null;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "ok"
    }));
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.unstubAllGlobals();
  });

  it("rejeita métodos diferentes de POST", async () => {
    const res = makeRes();
    await handler({ method: "GET" }, res);
    expect(res.statusCode).toBe(405);
    expect(res.body.error).toBe("Método não permitido.");
  });

  it("rejeita usuários não autenticados", async () => {
    mockUser = null;
    const res = makeRes();
    await handler({ method: "POST", body: { subject: "Teste", message: "Mensagem longa de teste" } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Não autenticado.");
  });

  it("rejeita assunto muito curto", async () => {
    mockUser = { uid: "user-123", email: "user@example.com" };
    const res = makeRes();
    await handler({ method: "POST", body: { subject: "Oi", message: "Mensagem longa de teste" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Assunto inválido");
  });

  it("rejeita mensagem muito curta", async () => {
    mockUser = { uid: "user-123", email: "user@example.com" };
    const res = makeRes();
    await handler({ method: "POST", body: { subject: "Assunto Válido", message: "Curta" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("Mensagem muito curta");
  });

  it("retorna 500 se RESEND_API_KEY não estiver configurada", async () => {
    delete process.env.RESEND_API_KEY;
    mockUser = { uid: "user-123", email: "user@example.com" };
    const res = makeRes();
    await handler({ method: "POST", body: { subject: "Assunto Válido", message: "Esta é uma mensagem longa válida" } }, res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toContain("RESEND_API_KEY ausente");
  });

  it("envia e-mail de suporte com sucesso via Resend", async () => {
    mockUser = { uid: "user-123", email: "user@example.com" };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "ok"
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = makeRes();
    await handler({ method: "POST", body: { subject: "Erro no PWA", message: "O aplicativo não instala no iOS 17." } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.headers["Authorization"]).toBe("Bearer fake_resend_key");

    const payload = JSON.parse(options.body);
    expect(payload.to).toBe("ctorres4564@gmail.com");
    expect(payload.subject).toContain("Erro no PWA");
    expect(payload.reply_to).toBe("user@example.com");
    expect(payload.html).toContain("user-123");
    expect(payload.html).toContain("O aplicativo não instala no iOS 17.");
  });

  it("retorna 502 se a chamada à Resend falhar", async () => {
    mockUser = { uid: "user-123", email: "user@example.com" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad Request de teste"
    }));

    const res = makeRes();
    await handler({ method: "POST", body: { subject: "Assunto Válido", message: "Mensagem de teste longa válida" } }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toContain("Não foi possível enviar a mensagem de suporte agora");
  });
});
