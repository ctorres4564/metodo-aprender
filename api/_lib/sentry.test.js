/* =====================================================================
   TESTES — api/_lib/sentry.js
   =====================================================================
   Sentry SDK real é mockado (vi.mock) — nenhuma chamada de rede de
   verdade. Cada teste importa o módulo do zero (vi.resetModules() +
   import dinâmico) porque initSentry() só roda uma vez por módulo
   carregado (a flag "initialized" é module-level) — sem isso, o teste
   que roda primeiro decidiria o comportamento dos que rodam depois.
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentryMock = {
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  flush: vi.fn().mockResolvedValue(true)
};
vi.mock("@sentry/node", () => sentryMock);

const originalConsoleError = console.error;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  sentryMock.flush.mockResolvedValue(true);
  console.error = originalConsoleError;
  delete process.env.SENTRY_DSN;
});

afterEach(() => {
  console.error = originalConsoleError;
  delete process.env.SENTRY_DSN;
});

describe("api/_lib/sentry.js — sem SENTRY_DSN configurada", () => {
  it("withSentry executa o handler normalmente, sem tocar no SDK", async () => {
    const { withSentry } = await import("./sentry.js");
    const handler = vi.fn().mockResolvedValue("ok");
    const wrapped = withSentry(handler);

    const result = await wrapped("req", "res");

    expect(result).toBe("ok");
    expect(handler).toHaveBeenCalledWith("req", "res");
    expect(sentryMock.init).not.toHaveBeenCalled();
    expect(sentryMock.captureException).not.toHaveBeenCalled();
    expect(sentryMock.flush).not.toHaveBeenCalled();
  });

  it("um erro do handler ainda propaga normalmente (comportamento inalterado)", async () => {
    const { withSentry } = await import("./sentry.js");
    const boom = new Error("falhou");
    const handler = vi.fn().mockRejectedValue(boom);
    const wrapped = withSentry(handler);

    await expect(wrapped("req", "res")).rejects.toBe(boom);
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });

  it("console.error continua funcionando exatamente como antes (sem interceptação)", async () => {
    const { initSentry } = await import("./sentry.js");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    initSentry();
    console.error("algo deu errado", new Error("x"));
    expect(sentryMock.captureException).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith("algo deu errado", expect.any(Error));
  });
});

describe("api/_lib/sentry.js — com SENTRY_DSN configurada", () => {
  beforeEach(() => {
    process.env.SENTRY_DSN = "https://fake@sentry.example/1";
  });

  it("initSentry inicializa o SDK uma única vez, mesmo chamada várias vezes", async () => {
    const { initSentry } = await import("./sentry.js");
    initSentry();
    initSentry();
    initSentry();
    expect(sentryMock.init).toHaveBeenCalledTimes(1);
    expect(sentryMock.init).toHaveBeenCalledWith(expect.objectContaining({ dsn: process.env.SENTRY_DSN }));
  });

  it("withSentry captura e relança o erro do handler, e sempre dá flush antes de terminar", async () => {
    const { withSentry } = await import("./sentry.js");
    const boom = new Error("falhou de verdade");
    const handler = vi.fn().mockRejectedValue(boom);
    const wrapped = withSentry(handler);

    await expect(wrapped("req", "res")).rejects.toBe(boom);
    expect(sentryMock.captureException).toHaveBeenCalledWith(boom);
    expect(sentryMock.flush).toHaveBeenCalled();
  });

  it("no caminho de sucesso, dá flush mas nunca captura exceção", async () => {
    const { withSentry } = await import("./sentry.js");
    const handler = vi.fn().mockResolvedValue("ok");
    const wrapped = withSentry(handler);

    const result = await wrapped("req", "res");

    expect(result).toBe("ok");
    expect(sentryMock.flush).toHaveBeenCalled();
    expect(sentryMock.captureException).not.toHaveBeenCalled();
  });

  it("console.error com um Error entre os argumentos captura como exceção, sem perder o log original", async () => {
    const { initSentry } = await import("./sentry.js");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    initSentry();

    const err = new Error("erro tratado internamente");
    console.error("Falha ao processar:", err);

    expect(sentryMock.captureException).toHaveBeenCalledWith(err);
    expect(spy).toHaveBeenCalledWith("Falha ao processar:", err);
  });

  it("console.error só com strings (sem objeto Error) vira captureMessage, não captureException", async () => {
    const { initSentry } = await import("./sentry.js");
    vi.spyOn(console, "error").mockImplementation(() => {});
    initSentry();

    console.error("Falha ao liberar lock de checkout (expira sozinho pelo TTL):", "mensagem simples");

    expect(sentryMock.captureException).not.toHaveBeenCalled();
    expect(sentryMock.captureMessage).toHaveBeenCalledWith(
      "Falha ao liberar lock de checkout (expira sozinho pelo TTL): mensagem simples",
      "error"
    );
  });

  it("console.error com um objeto circular nunca lança — loga normalmente e o handler continua", async () => {
    const { initSentry, withSentry } = await import("./sentry.js");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    initSentry();

    const circular = { nome: "obj" };
    circular.self = circular; // JSON.stringify(circular) lançaria TypeError

    // 1) console.error("erro", objetoCircular) não lança.
    expect(() => console.error("erro", circular)).not.toThrow();
    // 2) o log original continua ocorrendo, com o objeto intacto.
    expect(spy).toHaveBeenCalledWith("erro", circular);

    // 3) usado dentro de um handler envolvido por withSentry, o fluxo
    // segue normal até o fim — a falha de serialização não vaza como
    // exceção não tratada.
    const handler = vi.fn(async (req, res) => {
      console.error("erro", circular);
      return "ok";
    });
    const wrapped = withSentry(handler);
    await expect(wrapped("req", "res")).resolves.toBe("ok");
  });

  it("withSentry engole falha do próprio flush (não deve derrubar a resposta já enviada)", async () => {
    const { withSentry } = await import("./sentry.js");
    sentryMock.flush.mockRejectedValue(new Error("Sentry indisponível"));
    const handler = vi.fn().mockResolvedValue("ok");
    const wrapped = withSentry(handler);

    await expect(wrapped("req", "res")).resolves.toBe("ok");
  });
});
