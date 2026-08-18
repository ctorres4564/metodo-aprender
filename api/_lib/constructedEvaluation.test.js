/* =====================================================================
   TESTES — api/_lib/constructedEvaluation.js
   =====================================================================
   evaluateConstructedResponse chama callOpenRouter (já testado
   isoladamente em openrouter.test.js) e valida a saída contra o schema
   { classification, confidence, reason }. Aqui mockamos fetch (a mesma
   camada que openrouter.test.js mocka) para cobrir os casos de
   classificação, saída inválida, timeout e falha do provedor sem bater
   em rede real.
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_CLASSIFICATIONS, evaluateConstructedResponse, validateAiEvaluationOutput } from "./constructedEvaluation.js";

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

const baseArgs = {
  apiKey: "sk-test",
  model: "openai/gpt-4o-mini",
  conceptTitle: "Seleção natural",
  referenceText: "Variação, hereditariedade e reprodução diferencial.",
  responseText: "Existe variação entre indivíduos, ela é herdável, e uns reproduzem mais que outros."
};

describe("validateAiEvaluationOutput — schema", () => {
  it("aceita saída bem formada e clampa confidence em [0,1]", () => {
    const result = validateAiEvaluationOutput({ classification: "correct", confidence: 1.4, reason: "ok" });
    expect(result).toEqual({ classification: "correct", confidence: 1, reason: "ok" });
  });

  it("rejeita classification fora do enum", () => {
    expect(() => validateAiEvaluationOutput({ classification: "quase", confidence: 0.5, reason: "x" }))
      .toThrow(/formato inesperado/);
  });

  it("rejeita confidence não numérico", () => {
    expect(() => validateAiEvaluationOutput({ classification: "correct", confidence: "alta", reason: "x" }))
      .toThrow(/formato inesperado/);
  });

  it("rejeita payload que não é objeto", () => {
    expect(() => validateAiEvaluationOutput(null)).toThrow(/formato inesperado/);
    expect(() => validateAiEvaluationOutput("correct")).toThrow(/formato inesperado/);
  });

  it("trunca reason em até 400 caracteres via cleanStr", () => {
    const long = "x".repeat(500);
    const result = validateAiEvaluationOutput({ classification: "partial", confidence: 0.5, reason: long });
    expect(result.reason.length).toBe(400);
  });

  it("AI_CLASSIFICATIONS expõe exatamente os 3 valores do enum", () => {
    expect(AI_CLASSIFICATIONS).toEqual(["incorrect", "partial", "correct"]);
  });
});

describe("evaluateConstructedResponse — classificação", () => {
  it("resposta correta com palavras diferentes → classification 'correct'", async () => {
    fetch.mockResolvedValue(okResponse(JSON.stringify({
      classification: "correct", confidence: 0.9, reason: "Cobre variação, herança e reprodução diferencial."
    })));
    const result = await evaluateConstructedResponse(baseArgs);
    expect(result).toEqual({ classification: "correct", confidence: 0.9, reason: "Cobre variação, herança e reprodução diferencial.", model: "openai/gpt-4o-mini" });
  });

  it("persiste o modelo requisitado (baseArgs.model) no resultado, mesmo sem o modelo aparecer na saída da IA", async () => {
    fetch.mockResolvedValue(okResponse(JSON.stringify({
      classification: "correct", confidence: 0.9, reason: "ok"
    })));
    const result = await evaluateConstructedResponse({ ...baseArgs, model: "anthropic/claude-3-haiku" });
    expect(result.model).toBe("anthropic/claude-3-haiku");
  });

  it("usa DEFAULT_MODEL quando nenhum model é passado", async () => {
    fetch.mockResolvedValue(okResponse(JSON.stringify({
      classification: "partial", confidence: 0.5, reason: "ok"
    })));
    const { model, ...rest } = baseArgs;
    const result = await evaluateConstructedResponse(rest);
    expect(result.model).toBe("openai/gpt-4o-mini");
  });

  it("resposta parcialmente correta → classification 'partial'", async () => {
    fetch.mockResolvedValue(okResponse(JSON.stringify({
      classification: "partial", confidence: 0.6, reason: "Cita variação e herança, mas não a reprodução diferencial."
    })));
    const result = await evaluateConstructedResponse(baseArgs);
    expect(result.classification).toBe("partial");
  });

  it("resposta incorreta → classification 'incorrect'", async () => {
    fetch.mockResolvedValue(okResponse(JSON.stringify({
      classification: "incorrect", confidence: 0.8, reason: "Não menciona nenhum dos três princípios."
    })));
    const result = await evaluateConstructedResponse(baseArgs);
    expect(result.classification).toBe("incorrect");
  });
});

describe("evaluateConstructedResponse — falhas", () => {
  it("saída da IA fora do schema → rejeita com code 'parse'", async () => {
    fetch.mockResolvedValue(okResponse(JSON.stringify({ nota: 10 })));
    await expect(evaluateConstructedResponse(baseArgs)).rejects.toMatchObject({ code: "parse" });
  });

  it("conteúdo não é JSON extraível → rejeita com code 'parse'", async () => {
    fetch.mockResolvedValue(okResponse("Desculpe, não posso ajudar com isso."));
    await expect(evaluateConstructedResponse(baseArgs)).rejects.toMatchObject({ code: "parse" });
  });

  it("timeout (AbortError) → rejeita com code 'timeout'", async () => {
    const abortErr = new Error("The operation was aborted.");
    abortErr.name = "AbortError";
    fetch.mockRejectedValue(abortErr);
    await expect(evaluateConstructedResponse(baseArgs)).rejects.toMatchObject({ code: "timeout" });
  });

  it("falha do provedor (HTTP não-2xx) → rejeita com code 'http'", async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, text: async () => "erro interno" });
    await expect(evaluateConstructedResponse(baseArgs)).rejects.toMatchObject({ code: "http" });
  });

  it("falha de rede → rejeita com code 'network'", async () => {
    fetch.mockRejectedValue(new Error("ECONNRESET"));
    await expect(evaluateConstructedResponse(baseArgs)).rejects.toMatchObject({ code: "network" });
  });
});
