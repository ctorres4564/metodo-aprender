/* =====================================================================
   TESTES — api/_lib/openrouter.js (callOpenRouter, statusForOpenRouterError)
   =====================================================================
   Camada compartilhada por todos os 5 endpoints de IA: monta a chamada,
   normaliza qualquer tipo de falha (timeout/rede/HTTP/JSON inválido) num
   erro com ".code" — é esse código que decide se a cota consumida é
   estornada (ver refundUsage em usage.js) e qual status HTTP responder.
   fetch é mockado (nenhuma chamada de rede real).
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callOpenRouter, statusForOpenRouterError } from "./openrouter.js";

function okResponse(content) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] })
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseArgs = { apiKey: "sk-test", model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "oi" }], maxTokens: 100 };

describe("callOpenRouter — caminho de sucesso", () => {
  it("devolve o JSON já parseado do content da mensagem", async () => {
    fetch.mockResolvedValue(okResponse('{"result":"ok"}'));
    const result = await callOpenRouter(baseArgs);
    expect(result).toEqual({ result: "ok" });
  });

  it("monta a requisição com a URL, modelo e mensagens corretos", async () => {
    fetch.mockResolvedValue(okResponse('{"ok":true}'));
    await callOpenRouter(baseArgs);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(options.method).toBe("POST");
    expect(options.headers.authorization).toBe("Bearer sk-test");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("openai/gpt-4o-mini");
    expect(body.messages).toEqual(baseArgs.messages);
    expect(body.max_tokens).toBe(100);
  });

  it("aceita conteúdo cercado por ```json ``` (via extractJson)", async () => {
    fetch.mockResolvedValue(okResponse('```json\n{"a":1}\n```'));
    const result = await callOpenRouter(baseArgs);
    expect(result).toEqual({ a: 1 });
  });
});

describe("callOpenRouter — normalização de erros (code)", () => {
  it("HTTP não-2xx → code 'http'", async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, text: async () => "erro interno" });
    await expect(callOpenRouter(baseArgs)).rejects.toMatchObject({ code: "http" });
  });

  it("falha de rede (fetch rejeita) → code 'network'", async () => {
    fetch.mockRejectedValue(new Error("ECONNRESET"));
    await expect(callOpenRouter(baseArgs)).rejects.toMatchObject({ code: "network" });
  });

  it("abort/timeout (AbortError) → code 'timeout'", async () => {
    const abortErr = new Error("The operation was aborted.");
    abortErr.name = "AbortError";
    fetch.mockRejectedValue(abortErr);
    await expect(callOpenRouter(baseArgs)).rejects.toMatchObject({ code: "timeout" });
  });

  it("corpo da resposta não é JSON válido → code 'parse'", async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => { throw new Error("corpo truncado"); } });
    await expect(callOpenRouter(baseArgs)).rejects.toMatchObject({ code: "parse" });
  });

  it("content da mensagem não é JSON extraível → code 'parse' (nunca finge sucesso)", async () => {
    fetch.mockResolvedValue(okResponse("Desculpe, não posso ajudar com isso."));
    await expect(callOpenRouter(baseArgs)).rejects.toMatchObject({ code: "parse" });
  });
});

describe("statusForOpenRouterError", () => {
  it("timeout vira 504", () => {
    expect(statusForOpenRouterError({ code: "timeout" })).toBe(504);
  });

  it("network, http e parse viram 502", () => {
    expect(statusForOpenRouterError({ code: "network" })).toBe(502);
    expect(statusForOpenRouterError({ code: "http" })).toBe(502);
    expect(statusForOpenRouterError({ code: "parse" })).toBe(502);
  });
});
