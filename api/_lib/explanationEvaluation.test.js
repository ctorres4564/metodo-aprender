/* =====================================================================
   TESTES — api/_lib/explanationEvaluation.js
   =====================================================================
   Cobre a lacuna apontada na auditoria da Prioridade 3: até aqui não
   havia nenhum teste para api/avaliar-explicacao.js. Cobre o teto de
   nota sem mecanismo central, o cálculo de qualidadeSM2, o novo campo
   imprecisoes e a derivação de decisaoPedagogica — tudo sem rede real
   (fetch mockado, mesmo padrão de openrouter.test.js/
   constructedEvaluation.test.js).
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MODEL,
  EXPLANATION_PASS_SCORE,
  FOLLOW_UP_MAX_LENGTH,
  FOLLOW_UP_MIN_LENGTH,
  PEDAGOGICAL_DECISIONS,
  buildExplanationEvaluationResult,
  buildFallbackFollowUpQuestion,
  derivePedagogicalDecision,
  evaluateExplanation,
  isValidFollowUpQuestion
} from "./explanationEvaluation.js";

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
  title: "Efeito de espaçamento",
  referenceText: "Estudar em sessões espaçadas produz memórias mais duradouras do que concentrar tudo numa sessão só.",
  studentText: "Espaçar as revisões ao longo do tempo faz a memória durar mais do que estudar tudo de uma vez."
};

describe("EXPLANATION_PASS_SCORE / PEDAGOGICAL_DECISIONS", () => {
  it("limiar de aprovação é 70, inalterado", () => {
    expect(EXPLANATION_PASS_SCORE).toBe(70);
  });

  it("taxonomia tem exatamente os 3 valores que o endpoint pode decidir (pending_evaluation é estado de attempt, não decisão da IA)", () => {
    expect(PEDAGOGICAL_DECISIONS).toEqual(["passed", "retry_recommended", "return_to_comprehension"]);
  });
});

describe("derivePedagogicalDecision — critérios objetivos (nota + erros conceituais)", () => {
  it("nota >= 70 -> passed, independentemente de equívocos", () => {
    expect(derivePedagogicalDecision(70, [])).toBe("passed");
    expect(derivePedagogicalDecision(100, [])).toBe("passed");
  });

  it("nota < 70 com equívoco conceitual -> return_to_comprehension", () => {
    expect(derivePedagogicalDecision(50, ["afirma o oposto do mecanismo real"])).toBe("return_to_comprehension");
  });

  it("nota < 70 sem equívoco conceitual -> retry_recommended", () => {
    expect(derivePedagogicalDecision(50, [])).toBe("retry_recommended");
    expect(derivePedagogicalDecision(0, undefined)).toBe("retry_recommended");
  });
});

describe("buildExplanationEvaluationResult — teto de nota sem mecanismo central", () => {
  it("mecanismoNoTexto ausente/NAO_ENCONTRADO limita a nota a 45, mesmo se o modelo mandou nota alta", () => {
    const result = buildExplanationEvaluationResult({ nota: 92, mecanismoNoTexto: "NAO_ENCONTRADO", qualidadeSM2: 5 });
    expect(result.nota).toBe(45);
    expect(result.mecanismoNoTexto).toBe("");
  });

  it("mecanismoNoTexto vazio/string em branco também limita a 45", () => {
    const result = buildExplanationEvaluationResult({ nota: 80, mecanismoNoTexto: "   ", qualidadeSM2: 4 });
    expect(result.nota).toBe(45);
  });

  it("mecanismoNoTexto presente não é limitado a 45 (nota do modelo é respeitada, dentro de 0-100)", () => {
    const result = buildExplanationEvaluationResult({ nota: 92, mecanismoNoTexto: "Porque revisar perto do esquecimento reforça a memória.", qualidadeSM2: 5 });
    expect(result.nota).toBe(92);
    expect(result.mecanismoNoTexto).toBe("Porque revisar perto do esquecimento reforça a memória.");
  });

  it("nota fora de [0,100] ou não numérica é normalizada", () => {
    expect(buildExplanationEvaluationResult({ nota: 150, mecanismoNoTexto: "x" }).nota).toBe(100);
    expect(buildExplanationEvaluationResult({ nota: -10, mecanismoNoTexto: "x" }).nota).toBe(0);
    expect(buildExplanationEvaluationResult({ nota: "abc", mecanismoNoTexto: "x" }).nota).toBe(0);
    expect(buildExplanationEvaluationResult({ mecanismoNoTexto: "x" }).nota).toBe(0);
  });
});

describe("buildExplanationEvaluationResult — cálculo de qualidadeSM2", () => {
  it("deriva qualidade da nota final (pós-teto) quando o modelo não manda um valor válido", () => {
    expect(buildExplanationEvaluationResult({ nota: 95, mecanismoNoTexto: "x" }).qualidadeSM2).toBe(5);
    expect(buildExplanationEvaluationResult({ nota: 75, mecanismoNoTexto: "x" }).qualidadeSM2).toBe(4);
    expect(buildExplanationEvaluationResult({ nota: 50, mecanismoNoTexto: "x" }).qualidadeSM2).toBe(3);
    expect(buildExplanationEvaluationResult({ nota: 20, mecanismoNoTexto: "x" }).qualidadeSM2).toBe(1);
  });

  it("nunca aceita qualidadeSM2 do modelo MAIOR do que a nota (pós-teto) permitiria — usa o mínimo", () => {
    // nota 92 sem mecanismo -> teto 45 -> qualidadePelaNota=3; modelo mandou 5 -> deve prevalecer o menor (3)
    const result = buildExplanationEvaluationResult({ nota: 92, mecanismoNoTexto: "NAO_ENCONTRADO", qualidadeSM2: 5 });
    expect(result.qualidadeSM2).toBe(3);
  });

  it("aceita qualidadeSM2 do modelo quando é MENOR ou igual ao que a nota permitiria", () => {
    const result = buildExplanationEvaluationResult({ nota: 95, mecanismoNoTexto: "x", qualidadeSM2: 1 });
    expect(result.qualidadeSM2).toBe(1);
  });

  it("qualidadeSM2 do modelo fora do enum {1,3,4,5} é ignorado, usa o derivado da nota", () => {
    const result = buildExplanationEvaluationResult({ nota: 95, mecanismoNoTexto: "x", qualidadeSM2: 2 });
    expect(result.qualidadeSM2).toBe(5);
  });
});

describe("buildExplanationEvaluationResult — novo schema (imprecisoes, decisaoPedagogica)", () => {
  it("inclui imprecisoes como lista separada de equivocos", () => {
    const result = buildExplanationEvaluationResult({
      nota: 60, mecanismoNoTexto: "x",
      equivocos: ["diz que o efeito é o oposto do real"],
      imprecisoes: ["usa 'memória' de forma vaga, sem dizer qual tipo"]
    });
    expect(result.equivocos).toEqual(["diz que o efeito é o oposto do real"]);
    expect(result.imprecisoes).toEqual(["usa 'memória' de forma vaga, sem dizer qual tipo"]);
    expect(result.equivocos).not.toEqual(result.imprecisoes);
  });

  it("imprecisoes ausente na saída do modelo vira lista vazia, não erro", () => {
    const result = buildExplanationEvaluationResult({ nota: 80, mecanismoNoTexto: "x" });
    expect(result.imprecisoes).toEqual([]);
  });

  it("decisaoPedagogica é sempre derivada em código (nunca aceita direto do modelo)", () => {
    const result = buildExplanationEvaluationResult({
      nota: 80, mecanismoNoTexto: "x", decisaoPedagogica: "valor-inventado-pelo-modelo"
    });
    expect(PEDAGOGICAL_DECISIONS).toContain(result.decisaoPedagogica);
    expect(result.decisaoPedagogica).toBe("passed");
  });

  it("decisaoPedagogica reflete nota + equívocos coerentemente", () => {
    expect(buildExplanationEvaluationResult({ nota: 80, mecanismoNoTexto: "x" }).decisaoPedagogica).toBe("passed");
    expect(buildExplanationEvaluationResult({ nota: 50, mecanismoNoTexto: "x", equivocos: ["erro real"] }).decisaoPedagogica).toBe("return_to_comprehension");
    expect(buildExplanationEvaluationResult({ nota: 50, mecanismoNoTexto: "x" }).decisaoPedagogica).toBe("retry_recommended");
  });

  it("payload vazio/undefined não lança — devolve um resultado válido com valores neutros", () => {
    expect(() => buildExplanationEvaluationResult(undefined)).not.toThrow();
    const result = buildExplanationEvaluationResult(undefined);
    expect(result.nota).toBe(0);
    expect(result.equivocos).toEqual([]);
    expect(result.imprecisoes).toEqual([]);
    expect(PEDAGOGICAL_DECISIONS).toContain(result.decisaoPedagogica);
  });
});

describe("evaluateExplanation — integração com callOpenRouter (fetch mockado)", () => {
  it("devolve o resultado já com tetos aplicados, a partir da resposta da IA", async () => {
    fetch.mockResolvedValue(okResponse(JSON.stringify({
      mecanismoCentral: "Revisar perto do momento de esquecer reforça a trilha de memória.",
      mecanismoNoTexto: "Espaçar as revisões ao longo do tempo faz a memória durar mais.",
      nota: 88,
      pontosCobertos: ["menciona sessões espaçadas"],
      pontosFaltando: [],
      equivocos: [],
      imprecisoes: ["não especifica o que conta como 'sessão'"],
      feedback: "Boa explicação, só falta um detalhe.",
      qualidadeSM2: 4
    })));
    const result = await evaluateExplanation(baseArgs);
    expect(result.nota).toBe(88);
    expect(result.qualidadeSM2).toBe(4);
    expect(result.imprecisoes).toEqual(["não especifica o que conta como 'sessão'"]);
    expect(result.decisaoPedagogica).toBe("passed");
  });

  it("usa DEFAULT_MODEL quando nenhum model é passado", async () => {
    fetch.mockResolvedValue(okResponse(JSON.stringify({ nota: 50, mecanismoNoTexto: "x" })));
    const { model, ...rest } = baseArgs;
    await evaluateExplanation(rest);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.model).toBe(DEFAULT_MODEL);
  });

  it("timeout (AbortError) -> rejeita com code 'timeout', sem devolver resultado parcial", async () => {
    const abortErr = new Error("The operation was aborted.");
    abortErr.name = "AbortError";
    fetch.mockRejectedValue(abortErr);
    await expect(evaluateExplanation(baseArgs)).rejects.toMatchObject({ code: "timeout" });
  });

  it("falha do provedor (HTTP não-2xx) -> rejeita com code 'http'", async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, text: async () => "erro interno" });
    await expect(evaluateExplanation(baseArgs)).rejects.toMatchObject({ code: "http" });
  });

  it("saída da IA não é JSON extraível -> rejeita com code 'parse'", async () => {
    fetch.mockResolvedValue(okResponse("Desculpe, não posso ajudar com isso."));
    await expect(evaluateExplanation(baseArgs)).rejects.toMatchObject({ code: "parse" });
  });
});

describe("isValidFollowUpQuestion — validação da pergunta de aprofundamento", () => {
  it("aceita uma pergunta de tamanho razoável, que exige elaboração", () => {
    expect(isValidFollowUpQuestion("O que aconteceria se as revisões fossem feitas todas no mesmo dia?", "Efeito de espaçamento")).toBe(true);
  });

  it("rejeita valores que não são string", () => {
    expect(isValidFollowUpQuestion(undefined, "x")).toBe(false);
    expect(isValidFollowUpQuestion(null, "x")).toBe(false);
    expect(isValidFollowUpQuestion(42, "x")).toBe(false);
  });

  it(`rejeita string curta demais (< ${FOLLOW_UP_MIN_LENGTH} caracteres)`, () => {
    expect(isValidFollowUpQuestion("Por quê?", "x")).toBe(false);
  });

  it(`rejeita string longa demais (> ${FOLLOW_UP_MAX_LENGTH} caracteres)`, () => {
    expect(isValidFollowUpQuestion("x".repeat(FOLLOW_UP_MAX_LENGTH + 1), "y")).toBe(false);
  });

  it("rejeita quando a pergunta duplica literalmente o título do conceito (case-insensitive)", () => {
    expect(isValidFollowUpQuestion("Efeito de espaçamento", "Efeito de espaçamento")).toBe(false);
    expect(isValidFollowUpQuestion("  EFEITO DE ESPAÇAMENTO  ", "Efeito de espaçamento")).toBe(false);
  });

  it("aceita quando não há título para comparar", () => {
    expect(isValidFollowUpQuestion("Uma pergunta razoavelmente longa sobre o conceito.", undefined)).toBe(true);
  });
});

describe("buildFallbackFollowUpQuestion — garantia de 'pelo menos uma' pergunta", () => {
  it("devolve uma pergunta não vazia para cada decisão pedagógica", () => {
    for (const decision of PEDAGOGICAL_DECISIONS) {
      const question = buildFallbackFollowUpQuestion(decision);
      expect(typeof question).toBe("string");
      expect(question.trim().length).toBeGreaterThan(FOLLOW_UP_MIN_LENGTH);
    }
  });

  it("perguntas diferentes por decisão (calibradas ao diagnóstico)", () => {
    const passed = buildFallbackFollowUpQuestion("passed");
    const retry = buildFallbackFollowUpQuestion("retry_recommended");
    const returnToComprehension = buildFallbackFollowUpQuestion("return_to_comprehension");
    expect(new Set([passed, retry, returnToComprehension]).size).toBe(3);
  });
});

describe("buildExplanationEvaluationResult — followUpQuestion (perguntaAprofundamento)", () => {
  it("aceita a pergunta do modelo quando é válida", () => {
    const result = buildExplanationEvaluationResult(
      { nota: 80, mecanismoNoTexto: "x", perguntaAprofundamento: "O que mudaria se o intervalo entre revisões fosse fixo em vez de crescente?" },
      { title: "Efeito de espaçamento" }
    );
    expect(result.perguntaAprofundamento).toBe("O que mudaria se o intervalo entre revisões fosse fixo em vez de crescente?");
  });

  it("usa o fallback determinístico quando o modelo não manda perguntaAprofundamento", () => {
    const result = buildExplanationEvaluationResult({ nota: 80, mecanismoNoTexto: "x" }, { title: "Efeito de espaçamento" });
    expect(result.perguntaAprofundamento.length).toBeGreaterThan(0);
    expect(result.perguntaAprofundamento).toBe(buildFallbackFollowUpQuestion(result.decisaoPedagogica));
  });

  it("usa o fallback quando a pergunta do modelo duplica o título do conceito", () => {
    const result = buildExplanationEvaluationResult(
      { nota: 80, mecanismoNoTexto: "x", perguntaAprofundamento: "Efeito de espaçamento" },
      { title: "Efeito de espaçamento" }
    );
    expect(result.perguntaAprofundamento).toBe(buildFallbackFollowUpQuestion(result.decisaoPedagogica));
  });

  it("usa o fallback quando a pergunta do modelo é curta demais", () => {
    const result = buildExplanationEvaluationResult(
      { nota: 80, mecanismoNoTexto: "x", perguntaAprofundamento: "E aí?" },
      { title: "Efeito de espaçamento" }
    );
    expect(result.perguntaAprofundamento).toBe(buildFallbackFollowUpQuestion(result.decisaoPedagogica));
  });

  it("SEMPRE devolve uma perguntaAprofundamento não vazia, mesmo sem título nem payload", () => {
    const result = buildExplanationEvaluationResult(undefined);
    expect(typeof result.perguntaAprofundamento).toBe("string");
    expect(result.perguntaAprofundamento.length).toBeGreaterThan(0);
  });
});

describe("evaluateExplanation — followUpQuestion ponta a ponta (fetch mockado)", () => {
  it("propaga a pergunta de aprofundamento válida da IA no resultado final", async () => {
    fetch.mockResolvedValue(okResponse(JSON.stringify({
      nota: 85, mecanismoNoTexto: "x", qualidadeSM2: 4,
      perguntaAprofundamento: "Por que o intervalo cresce especificamente a cada acerto, e não de forma fixa?"
    })));
    const result = await evaluateExplanation(baseArgs);
    expect(result.perguntaAprofundamento).toBe("Por que o intervalo cresce especificamente a cada acerto, e não de forma fixa?");
  });
});
