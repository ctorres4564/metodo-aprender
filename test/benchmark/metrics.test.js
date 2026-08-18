/* =====================================================================
   TESTES — test/benchmark/metrics.js
   =====================================================================
   Só matemática pura sobre resultados fabricados — nunca chama a API
   real de IA. O runner (runConstructedEvaluationBenchmark.js) é quem
   chama a API de verdade; aqui testamos apenas se as métricas, dado um
   conjunto conhecido de acertos/erros, calculam os números certos.
   ===================================================================== */
import { describe, expect, it } from "vitest";
import {
  CLASSES,
  aggregateByDomain,
  buildConfusionMatrix,
  classifySeverity,
  computeAccuracy,
  computeAllMetrics,
  computeClassMetrics,
  computeConfidenceStats,
  findFalseCorrect,
  findFalseIncorrect,
  summarizeSeverity
} from "./metrics.js";

function r(expected, actual, extra = {}) {
  return { id: extra.id || `${expected}-${actual}-${Math.random()}`, domain: extra.domain || "Teste", expected, actual, confidence: extra.confidence, reason: extra.reason };
}

describe("CLASSES", () => {
  it("expõe exatamente as 3 classes na ordem incorrect/partial/correct", () => {
    expect(CLASSES).toEqual(["incorrect", "partial", "correct"]);
  });
});

describe("buildConfusionMatrix", () => {
  it("conta expected x actual corretamente", () => {
    const results = [
      r("correct", "correct"), r("correct", "correct"), r("correct", "partial"),
      r("partial", "partial"), r("partial", "incorrect"),
      r("incorrect", "incorrect"), r("incorrect", "correct")
    ];
    const matrix = buildConfusionMatrix(results);
    expect(matrix.correct.correct).toBe(2);
    expect(matrix.correct.partial).toBe(1);
    expect(matrix.correct.incorrect).toBe(0);
    expect(matrix.partial.partial).toBe(1);
    expect(matrix.partial.incorrect).toBe(1);
    expect(matrix.incorrect.incorrect).toBe(1);
    expect(matrix.incorrect.correct).toBe(1);
  });

  it("ignora resultados com actual/expected inválidos (falha de IA)", () => {
    const results = [r("correct", "correct"), r("partial", null), r(null, "correct")];
    const matrix = buildConfusionMatrix(results);
    const totalCounted = CLASSES.reduce((sum, e) => sum + CLASSES.reduce((s, a) => s + matrix[e][a], 0), 0);
    expect(totalCounted).toBe(1);
  });

  it("matriz vazia para lista vazia, sem lançar", () => {
    const matrix = buildConfusionMatrix([]);
    for (const e of CLASSES) for (const a of CLASSES) expect(matrix[e][a]).toBe(0);
  });
});

describe("computeAccuracy", () => {
  it("calcula a fração de acertos sobre os resultados válidos", () => {
    const results = [
      r("correct", "correct"), r("partial", "partial"), r("incorrect", "incorrect"),
      r("correct", "partial")
    ];
    expect(computeAccuracy(results)).toBeCloseTo(3 / 4, 10);
  });

  it("exclui falhas de IA (actual null) do denominador", () => {
    const results = [r("correct", "correct"), r("partial", null), r("incorrect", null)];
    expect(computeAccuracy(results)).toBe(1);
  });

  it("retorna 0 para lista vazia ou só falhas", () => {
    expect(computeAccuracy([])).toBe(0);
    expect(computeAccuracy([r("correct", null)])).toBe(0);
  });
});

describe("computeClassMetrics — precision/recall/F1", () => {
  // Exemplo com números fáceis de verificar à mão:
  // correct:   3 exemplos, 2 acertos, 1 virou partial (recall 2/3)
  // partial:   3 exemplos, 2 acertos, 1 virou incorrect; +1 falso positivo (correct->partial)
  // incorrect: 3 exemplos, 3 acertos; +1 falso positivo (partial->incorrect)
  const results = [
    r("correct", "correct"), r("correct", "correct"), r("correct", "partial"),
    r("partial", "partial"), r("partial", "partial"), r("partial", "incorrect"),
    r("incorrect", "incorrect"), r("incorrect", "incorrect"), r("incorrect", "incorrect")
  ];

  it("recall por classe = TP / (TP + FN)", () => {
    const m = computeClassMetrics(results);
    expect(m.correct.recall).toBeCloseTo(2 / 3, 10);
    expect(m.partial.recall).toBeCloseTo(2 / 3, 10);
    expect(m.incorrect.recall).toBeCloseTo(3 / 3, 10);
  });

  it("precision por classe = TP / (TP + FP)", () => {
    const m = computeClassMetrics(results);
    // partial: TP=2 (partial->partial), FP=1 (correct->partial) => 2/3
    expect(m.partial.precision).toBeCloseTo(2 / 3, 10);
    // incorrect: TP=3, FP=1 (partial->incorrect) => 3/4
    expect(m.incorrect.precision).toBeCloseTo(3 / 4, 10);
    // correct: TP=2, FP=0 => 1
    expect(m.correct.precision).toBe(1);
  });

  it("F1 é a média harmônica de precision e recall", () => {
    const m = computeClassMetrics(results);
    const expectedF1Correct = (2 * 1 * (2 / 3)) / (1 + 2 / 3);
    expect(m.correct.f1).toBeCloseTo(expectedF1Correct, 10);
  });

  it("support conta o total de casos esperados daquela classe", () => {
    const m = computeClassMetrics(results);
    expect(m.correct.support).toBe(3);
    expect(m.partial.support).toBe(3);
    expect(m.incorrect.support).toBe(3);
  });

  it("classe sem nenhuma predição (TP+FP=0) tem precision 0, não NaN", () => {
    const onlyIncorrect = [r("incorrect", "incorrect"), r("incorrect", "incorrect")];
    const m = computeClassMetrics(onlyIncorrect);
    expect(m.correct.precision).toBe(0);
    expect(m.correct.recall).toBe(0);
    expect(m.correct.f1).toBe(0);
    expect(Number.isNaN(m.correct.precision)).toBe(false);
  });
});

describe("findFalseCorrect — métrica de risco principal", () => {
  it("identifica partial->correct e incorrect->correct, e só esses", () => {
    const results = [
      r("partial", "correct", { id: "p1" }),
      r("incorrect", "correct", { id: "i1" }),
      r("correct", "correct", { id: "c1" }),
      r("correct", "partial", { id: "c2" }),
      r("partial", "partial", { id: "p2" }),
      r("incorrect", "incorrect", { id: "i2" })
    ];
    const falseCorrect = findFalseCorrect(results);
    expect(falseCorrect.map((r) => r.id).sort()).toEqual(["i1", "p1"]);
  });

  it("lista vazia quando não há nenhum falso positivo de 'correct'", () => {
    const results = [r("correct", "correct"), r("partial", "partial"), r("incorrect", "incorrect")];
    expect(findFalseCorrect(results)).toEqual([]);
  });
});

describe("findFalseIncorrect", () => {
  it("identifica somente correct->incorrect", () => {
    const results = [
      r("correct", "incorrect", { id: "c1" }),
      r("partial", "incorrect", { id: "p1" }),
      r("correct", "correct", { id: "c2" })
    ];
    const falseIncorrect = findFalseIncorrect(results);
    expect(falseIncorrect.map((r) => r.id)).toEqual(["c1"]);
  });
});

describe("classifySeverity", () => {
  it("acerto é 'none'", () => {
    expect(classifySeverity("correct", "correct")).toBe("none");
  });

  it("classes adjacentes (correct<->partial, partial<->incorrect) são 'mild'", () => {
    expect(classifySeverity("correct", "partial")).toBe("mild");
    expect(classifySeverity("partial", "correct")).toBe("mild");
    expect(classifySeverity("partial", "incorrect")).toBe("mild");
    expect(classifySeverity("incorrect", "partial")).toBe("mild");
  });

  it("extremos (incorrect<->correct) são 'severe'", () => {
    expect(classifySeverity("incorrect", "correct")).toBe("severe");
    expect(classifySeverity("correct", "incorrect")).toBe("severe");
  });

  it("retorna null para entradas inválidas (ex.: falha de IA)", () => {
    expect(classifySeverity("correct", null)).toBeNull();
    expect(classifySeverity(null, "correct")).toBeNull();
    expect(classifySeverity("correct", "quase")).toBeNull();
  });
});

describe("summarizeSeverity", () => {
  it("conta mild/severe e destaca incorrect->correct e correct->incorrect separadamente", () => {
    const results = [
      r("correct", "partial"),   // mild
      r("partial", "incorrect"), // mild
      r("incorrect", "correct"), // severe, incorrectToCorrect
      r("incorrect", "correct"), // severe, incorrectToCorrect
      r("correct", "incorrect"), // severe, correctToIncorrect
      r("correct", "correct")    // none
    ];
    const summary = summarizeSeverity(results);
    expect(summary.mild).toBe(2);
    expect(summary.severe).toBe(3);
    expect(summary.severeIncorrectToCorrect).toBe(2);
    expect(summary.severeCorrectToIncorrect).toBe(1);
  });
});

describe("aggregateByDomain", () => {
  it("agrupa total e accuracy por domínio", () => {
    const results = [
      r("correct", "correct", { domain: "Biologia" }),
      r("correct", "partial", { domain: "Biologia" }),
      r("partial", "partial", { domain: "Física" }),
      r("incorrect", "incorrect", { domain: "Física" }),
      r("incorrect", "incorrect", { domain: "Física" })
    ];
    const byDomain = aggregateByDomain(results);
    expect(byDomain["Biologia"]).toEqual({ total: 2, accuracy: 0.5 });
    expect(byDomain["Física"]).toEqual({ total: 3, accuracy: 1 });
  });
});

describe("computeConfidenceStats", () => {
  it("calcula confidence média de acertos, erros e falsos positivos de 'correct'", () => {
    const results = [
      r("correct", "correct", { confidence: 0.9 }),
      r("correct", "correct", { confidence: 0.7 }),
      r("partial", "correct", { confidence: 0.85 }), // falso positivo, alta confiança
      r("incorrect", "correct", { confidence: 0.6 }), // falso positivo, confiança < 0.8
      r("partial", "incorrect", { confidence: 0.4 })  // erro, não é falso "correct"
    ];
    const stats = computeConfidenceStats(results);
    expect(stats.avgConfidenceCorrectPredictions).toBeCloseTo(0.8, 10);
    expect(stats.avgConfidenceFalseCorrect).toBeCloseTo((0.85 + 0.6) / 2, 10);
    expect(stats.highConfidenceFalseCorrectCount).toBe(1);
    expect(stats.highConfidenceFalseCorrectCases[0].confidence).toBe(0.85);
  });

  it("retorna null para médias sem nenhum caso na categoria (não NaN, não erro)", () => {
    const stats = computeConfidenceStats([r("correct", "correct", { confidence: 0.9 })]);
    expect(stats.avgConfidenceWrongPredictions).toBeNull();
    expect(stats.avgConfidenceFalseCorrect).toBeNull();
  });

  it("ignora resultados sem confidence numérico", () => {
    const stats = computeConfidenceStats([r("correct", "correct", { confidence: undefined })]);
    expect(stats.avgConfidenceCorrectPredictions).toBeNull();
  });
});

describe("computeAllMetrics — agregação completa", () => {
  it("monta o pacote com todas as seções esperadas pelo relatório", () => {
    const results = [
      r("correct", "correct", { domain: "Biologia", confidence: 0.9 }),
      r("partial", "correct", { domain: "Física", confidence: 0.8 }),
      r("incorrect", "incorrect", { domain: "Física", confidence: 0.95 })
    ];
    const all = computeAllMetrics(results);
    expect(all.total).toBe(3);
    expect(all.accuracy).toBeCloseTo(2 / 3, 10);
    expect(all.falseCorrect).toHaveLength(1);
    expect(all.falseIncorrect).toHaveLength(0);
    expect(all.severity.mild).toBe(1);
    expect(Object.keys(all.byDomain).sort()).toEqual(["Biologia", "Física"]);
    expect(all.classMetrics.correct).toBeDefined();
    expect(all.confusionMatrix.partial.correct).toBe(1);
    expect(all.confidence.highConfidenceFalseCorrectCount).toBe(1);
  });
});
