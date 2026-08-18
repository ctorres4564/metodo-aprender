/* =====================================================================
   TESTES — test/benchmark/runConstructedEvaluationBenchmark.js
   =====================================================================
   Só as partes puras (buildEvaluationArgs, formatReport, constantes).
   runBenchmark() em si chama a API real e não é testado aqui — ver
   "como executar" no próprio runner para a execução manual real.
   Importar este módulo NÃO dispara a CLI (guardada por
   `process.argv[1] === este arquivo`, que nunca é verdade sob vitest).
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DATASET, DATASET_VERSION } from "./constructedResponseDataset.js";
import { DATASET_V2, DATASET_VERSION as DATASET_VERSION_V2 } from "./constructedResponseDatasetV2.js";
import { computeAllMetrics } from "./metrics.js";
import { QUALITY_REFERENCE, buildEvaluationArgs, formatReport, runBenchmark } from "./runConstructedEvaluationBenchmark.js";

describe("buildEvaluationArgs — isolamento do ground truth", () => {
  const testCase = DATASET[0];

  it("extrai exatamente prompt/referenceAnswer/studentAnswer para conceptTitle/referenceText/responseText", () => {
    const args = buildEvaluationArgs(testCase, { apiKey: "sk-test", model: "modelo/x" });
    expect(args).toEqual({
      apiKey: "sk-test",
      model: "modelo/x",
      conceptTitle: testCase.prompt,
      referenceText: testCase.referenceAnswer,
      responseText: testCase.studentAnswer
    });
  });

  it("NUNCA inclui rationale, expectedClassification, id, domain ou caseType (nunca vaza o ground truth pra IA)", () => {
    const args = buildEvaluationArgs(testCase, { apiKey: "sk-test", model: "modelo/x" });
    const serialized = JSON.stringify(args);
    expect(args).not.toHaveProperty("rationale");
    expect(args).not.toHaveProperty("expectedClassification");
    expect(args).not.toHaveProperty("id");
    expect(args).not.toHaveProperty("domain");
    expect(args).not.toHaveProperty("caseType");
    expect(args).not.toHaveProperty("boundary");
    // reforço: a rationale (auditoria) não aparece nem embutida em outro campo
    expect(serialized.includes(testCase.rationale)).toBe(false);
  });

  it("funciona para todo caso do dataset v1 e v2, sem lançar", () => {
    for (const c of [...DATASET, ...DATASET_V2]) {
      expect(() => buildEvaluationArgs(c, { apiKey: "sk-test", model: "modelo/x" })).not.toThrow();
    }
  });
});

describe("runBenchmark — resolução de datasetVersion (fetch mockado, sem custo real)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ classification: "correct", confidence: 0.9, reason: "ok" }) } }] })
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("usa DATASET_VERSION (v1) por padrão quando nenhum datasetVersion é passado", async () => {
    const { meta } = await runBenchmark({ apiKey: "sk-test", dataset: DATASET.slice(0, 1), delayMs: 0 });
    expect(meta.datasetVersion).toBe(DATASET_VERSION);
  });

  it("usa DATASET_VERSION_V2 quando datasetVersion é passado explicitamente junto com o dataset v2 (é assim que a CLI seleciona a versão)", async () => {
    const { meta } = await runBenchmark({ apiKey: "sk-test", dataset: DATASET_V2.slice(0, 1), datasetVersion: DATASET_VERSION_V2, delayMs: 0 });
    expect(meta.datasetVersion).toBe(DATASET_VERSION_V2);
  });

  it("respeita datasetVersion explícito, mesmo com um dataset arbitrário", async () => {
    const { meta } = await runBenchmark({ apiKey: "sk-test", dataset: DATASET.slice(0, 1), datasetVersion: "versao-customizada", delayMs: 0 });
    expect(meta.datasetVersion).toBe("versao-customizada");
  });
});

describe("QUALITY_REFERENCE — critérios exploratórios (não regras de produção)", () => {
  it("accuracy mínima é 85% e false_correct máximo é 5% (preferencial 2%)", () => {
    expect(QUALITY_REFERENCE.minAccuracy).toBe(0.85);
    expect(QUALITY_REFERENCE.maxFalseCorrectRate).toBe(0.05);
    expect(QUALITY_REFERENCE.preferredMaxFalseCorrectRate).toBe(0.02);
  });
});

describe("formatReport — montagem do relatório (dados fabricados, sem rede)", () => {
  const fakeResults = [
    { id: "a", domain: "Biologia", caseType: "correct_literal", boundary: null, expected: "correct", actual: "correct", confidence: 0.9, reason: "ok", referenceAnswer: "ref A", studentAnswer: "resp A" },
    { id: "b", domain: "Biologia", caseType: "incorrect_subtle_false_positive_trap", boundary: "partial_incorrect", expected: "incorrect", actual: "correct", confidence: 0.85, reason: "confundiu", referenceAnswer: "ref B", studentAnswer: "resp B" },
    { id: "c", domain: "Física", caseType: "partial_omission", boundary: null, expected: "partial", actual: "incorrect", confidence: 0.6, reason: "raso", referenceAnswer: "ref C", studentAnswer: "resp C" }
  ];
  const meta = {
    datasetVersion: "v-teste", caseCount: 3, failureCount: 0, modelRequested: "modelo/x",
    executedAt: "2026-01-01T00:00:00.000Z", config: { maxTokens: 300, delayMsBetweenCalls: 250, execution: "sequential" }
  };
  const metrics = computeAllMetrics(fakeResults);
  const report = formatReport({ results: fakeResults, metrics, meta });

  it("inclui metadados de reprodutibilidade", () => {
    expect(report).toContain("v-teste");
    expect(report).toContain("modelo/x");
    expect(report).toContain("2026-01-01T00:00:00.000Z");
  });

  it("lista o caso de risco (incorrect->correct) com os campos pedidos", () => {
    expect(report).toContain("### b (Biologia)");
    expect(report).toContain("ref B");
    expect(report).toContain("resp B");
    expect(report).toContain("confundiu");
  });

  it("reporta se atingiu ou não os critérios exploratórios de qualidade", () => {
    expect(report).toMatch(/accuracy >= 85\.0%: (ATINGIU|NÃO ATINGIU)/);
    expect(report).toMatch(/false_correct <= 5\.0%: (ATINGIU|NÃO ATINGIU)/);
  });

  it("lista o caso divergente leve (partial->incorrect) na seção de casos difíceis", () => {
    expect(report).toContain("`c` (Física, partial_omission)");
  });
});
