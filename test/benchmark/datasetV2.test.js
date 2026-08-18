/* =====================================================================
   TESTES — test/benchmark/constructedResponseDatasetV2.js
   =====================================================================
   Espelha dataset.test.js (v1), adaptado para: (a) o caseType
   "partial_split" ter sido dividido em dois na v2, e (b) a metadata de
   comparação v1->v2 (datasetStatus/changeReason). Não roda contra a API
   de IA — só valida forma, distribuição e metadata do dataset.
   ===================================================================== */
import { describe, expect, it } from "vitest";
import { CLASSES } from "./metrics.js";
import { DATASET } from "./constructedResponseDataset.js";
import { DATASET_V2, DATASET_VERSION, PREVIOUS_DATASET_VERSION } from "./constructedResponseDatasetV2.js";

const REQUIRED_STRING_FIELDS = ["id", "domain", "prompt", "referenceAnswer", "studentAnswer", "rationale"];
const DATASET_STATUSES = ["unchanged", "corrected", "new"];

describe("DATASET_VERSION / PREVIOUS_DATASET_VERSION", () => {
  it("v2 tem identificador próprio, diferente da v1", () => {
    expect(DATASET_VERSION).toBe("constructed-eval-benchmark-v2");
    expect(PREVIOUS_DATASET_VERSION).toBe("constructed-eval-benchmark-v1");
    expect(DATASET_VERSION).not.toBe(PREVIOUS_DATASET_VERSION);
  });

  it("o dataset v1 continua existindo e inalterado (comparação futura direta v1 -> v2)", () => {
    expect(DATASET.length).toBeGreaterThanOrEqual(60);
    expect(DATASET.length).toBeLessThanOrEqual(100);
  });
});

describe("DATASET_V2 — tamanho e forma básica", () => {
  it("tem entre 70 e 90 casos (faixa combinada com a pequena alteração de quantidade documentada)", () => {
    expect(DATASET_V2.length).toBeGreaterThanOrEqual(70);
    expect(DATASET_V2.length).toBeLessThanOrEqual(90);
  });

  it("cada caso tem os campos obrigatórios como string não vazia", () => {
    for (const c of DATASET_V2) {
      for (const field of REQUIRED_STRING_FIELDS) {
        expect(typeof c[field], `${c.id || "?"}.${field}`).toBe("string");
        expect(c[field].trim().length, `${c.id || "?"}.${field} vazio`).toBeGreaterThan(0);
      }
    }
  });

  it("todo id é único", () => {
    const ids = DATASET_V2.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("expectedClassification é sempre uma das 3 classes válidas", () => {
    for (const c of DATASET_V2) {
      expect(CLASSES, `${c.id}: ${c.expectedClassification}`).toContain(c.expectedClassification);
    }
  });
});

describe("DATASET_V2 — metadata de comparação v1 -> v2", () => {
  it("datasetStatus é sempre 'unchanged', 'corrected' ou 'new'", () => {
    for (const c of DATASET_V2) {
      expect(DATASET_STATUSES, c.id).toContain(c.datasetStatus);
    }
  });

  it("changeReason é obrigatória (string não vazia) quando datasetStatus é 'corrected' ou 'new'", () => {
    for (const c of DATASET_V2) {
      if (c.datasetStatus === "corrected" || c.datasetStatus === "new") {
        expect(typeof c.changeReason, c.id).toBe("string");
        expect(c.changeReason.trim().length, c.id).toBeGreaterThan(0);
      }
    }
  });

  it("changeReason é null quando datasetStatus é 'unchanged'", () => {
    for (const c of DATASET_V2) {
      if (c.datasetStatus === "unchanged") {
        expect(c.changeReason, c.id).toBeNull();
      }
    }
  });

  it("todo caso 'corrected' preserva um id que já existia na v1 (nunca reaproveita id para caso diferente)", () => {
    const v1Ids = new Set(DATASET.map((c) => c.id));
    for (const c of DATASET_V2) {
      if (c.datasetStatus === "corrected") {
        expect(v1Ids.has(c.id), `${c.id} deveria existir também na v1`).toBe(true);
      }
    }
  });

  it("todo caso 'new' usa um id que NÃO existia na v1 (evita colisão semântica)", () => {
    const v1Ids = new Set(DATASET.map((c) => c.id));
    for (const c of DATASET_V2) {
      if (c.datasetStatus === "new") {
        expect(v1Ids.has(c.id), `${c.id} não deveria existir na v1`).toBe(false);
      }
    }
  });

  it("todo caso 'unchanged' tem exatamente o mesmo prompt/referenceAnswer/studentAnswer/expectedClassification da v1 (garante comparação justa v1 -> v2)", () => {
    const v1ById = new Map(DATASET.map((c) => [c.id, c]));
    for (const c of DATASET_V2) {
      if (c.datasetStatus !== "unchanged") continue;
      const v1Case = v1ById.get(c.id);
      expect(v1Case, `${c.id} deveria existir na v1`).toBeDefined();
      expect(c.prompt).toBe(v1Case.prompt);
      expect(c.referenceAnswer).toBe(v1Case.referenceAnswer);
      expect(c.studentAnswer).toBe(v1Case.studentAnswer);
      expect(c.expectedClassification).toBe(v1Case.expectedClassification);
    }
  });

  it("nenhum caso 'corrected' repete prompt+referenceAnswer+studentAnswer+expectedClassification idênticos à v1 (senão não seria uma correção real)", () => {
    const v1ById = new Map(DATASET.map((c) => [c.id, c]));
    for (const c of DATASET_V2) {
      if (c.datasetStatus !== "corrected") continue;
      const v1Case = v1ById.get(c.id);
      const identical =
        c.prompt === v1Case.prompt &&
        c.referenceAnswer === v1Case.referenceAnswer &&
        c.studentAnswer === v1Case.studentAnswer &&
        c.expectedClassification === v1Case.expectedClassification &&
        c.caseType === v1Case.caseType &&
        c.rationale === v1Case.rationale;
      expect(identical, `${c.id} está marcado 'corrected' mas é idêntico à v1`).toBe(false);
    }
  });

  it("os 4 casos específicos exigidos pela auditoria do Benchmark v1 foram corrigidos", () => {
    const corrected = new Set(DATASET_V2.filter((c) => c.datasetStatus === "corrected").map((c) => c.id));
    for (const id of ["feyn-06", "spac-07", "bio-07", "fis-07", "hist-06", "bio-12"]) {
      expect(corrected.has(id), id).toBe(true);
    }
  });

  it("bio-12 preserva expectedClassification 'partial' (caso difícil não simplificado)", () => {
    const c = DATASET_V2.find((x) => x.id === "bio-12");
    expect(c.expectedClassification).toBe("partial");
  });

  it("feyn-06: o studentAnswer corrigido sustenta a rationale (menciona a inspiração/filosofia, não só a autoria)", () => {
    const c = DATASET_V2.find((x) => x.id === "feyn-06");
    expect(c.studentAnswer.toLowerCase()).toMatch(/jargão|simples/);
  });
});

describe("DATASET_V2 — divisão do antigo caseType partial_split", () => {
  it("partial_split não existe mais na v2", () => {
    expect(DATASET_V2.some((c) => c.caseType === "partial_split")).toBe(false);
  });

  it("partial_true_but_incomplete existe e todo caso é expectedClassification partial", () => {
    const cases = DATASET_V2.filter((c) => c.caseType === "partial_true_but_incomplete");
    expect(cases.length).toBeGreaterThanOrEqual(1);
    for (const c of cases) expect(c.expectedClassification, c.id).toBe("partial");
  });

  it("incorrect_wrong_process_or_mechanism existe e todo caso é expectedClassification incorrect", () => {
    const cases = DATASET_V2.filter((c) => c.caseType === "incorrect_wrong_process_or_mechanism");
    expect(cases.length).toBeGreaterThanOrEqual(1);
    for (const c of cases) expect(c.expectedClassification, c.id).toBe("incorrect");
  });
});

describe("DATASET_V2 — diversidade de domínio", () => {
  it("usa pelo menos 5 domínios diferentes", () => {
    const domains = new Set(DATASET_V2.map((c) => c.domain));
    expect(domains.size).toBeGreaterThanOrEqual(5);
  });

  it("nenhum domínio concentra sozinho mais da metade dos casos", () => {
    const counts = {};
    for (const c of DATASET_V2) counts[c.domain] = (counts[c.domain] || 0) + 1;
    for (const [domain, count] of Object.entries(counts)) {
      expect(count, domain).toBeLessThanOrEqual(Math.ceil(DATASET_V2.length / 2));
    }
  });
});

describe("DATASET_V2 — distribuição por classe (próxima de equilíbrio)", () => {
  it("cada classe representa entre 20% e 45% do total", () => {
    const counts = { incorrect: 0, partial: 0, correct: 0 };
    for (const c of DATASET_V2) counts[c.expectedClassification] += 1;
    const total = DATASET_V2.length;
    for (const cls of CLASSES) {
      const ratio = counts[cls] / total;
      expect(ratio, `${cls}: ${counts[cls]}/${total}`).toBeGreaterThanOrEqual(0.2);
      expect(ratio, `${cls}: ${counts[cls]}/${total}`).toBeLessThanOrEqual(0.45);
    }
  });

  it("nenhuma classe está ausente ou quase ausente", () => {
    const counts = { incorrect: 0, partial: 0, correct: 0 };
    for (const c of DATASET_V2) counts[c.expectedClassification] += 1;
    for (const cls of CLASSES) expect(counts[cls]).toBeGreaterThan(10);
  });
});

describe("DATASET_V2 — cobertura dos tipos de caso obrigatórios (18 originais + divisão do partial_split)", () => {
  const REQUIRED_CASE_TYPE_PATTERNS = [
    /^correct_literal$/,
    /^correct_paraphrase$/,
    /^correct_short$/,
    /^correct_extra_info$/,
    /^partial_omission$/,
    /^partial_imprecision$/,
    // requisito "acerta uma parte e erra outra": agora coberto por QUALQUER
    // um dos dois caseTypes que substituíram partial_split na v2.
    /^(partial_true_but_incomplete|incorrect_wrong_process_or_mechanism)$/,
    /^incorrect_conceptual$/,
    /^incorrect_keyword_wrong_relation$/,
    /^incorrect_sophisticated$/,
    /^incorrect_cause_effect_inversion$/,
    /^incorrect_confusion_close_concepts$/,
    /^partial_overgeneralization$/,
    /^partial_example_without_explanation$/,
    /^incorrect_vague$/,
    /^incorrect_almost_empty$/,
    /^incorrect_negation$/,
    /^incorrect_subtle_false_positive_trap$/
  ];

  it.each(REQUIRED_CASE_TYPE_PATTERNS)("existe ao menos 1 caso do tipo %s", (pattern) => {
    const matches = DATASET_V2.filter((c) => pattern.test(c.caseType));
    expect(matches.length, `nenhum caso casa com ${pattern}`).toBeGreaterThanOrEqual(1);
  });

  it("as duas novas subdivisões existem simultaneamente (não é só um caseType renomeado)", () => {
    const trueButIncomplete = DATASET_V2.filter((c) => c.caseType === "partial_true_but_incomplete").length;
    const wrongMechanism = DATASET_V2.filter((c) => c.caseType === "incorrect_wrong_process_or_mechanism").length;
    expect(trueButIncomplete).toBeGreaterThanOrEqual(3);
    expect(wrongMechanism).toBeGreaterThanOrEqual(3);
  });

  it("casos difíceis (boundary correct_partial ou partial_incorrect) continuam em quantidade relevante — não foram removidos para facilitar accuracy", () => {
    const boundaryCases = DATASET_V2.filter((c) => c.boundary === "correct_partial" || c.boundary === "partial_incorrect");
    expect(boundaryCases.length).toBeGreaterThanOrEqual(10);
    // não pode ter DIMINUÍDO em relação à v1 — a correção reclassificou/
    // renomeou casos difíceis, não os removeu.
    const v1BoundaryCases = DATASET.filter((c) => c.boundary === "correct_partial" || c.boundary === "partial_incorrect");
    expect(boundaryCases.length).toBeGreaterThanOrEqual(v1BoundaryCases.length);
  });
});

describe("DATASET_V2 — rationale não vaza para além da auditoria", () => {
  it("rationale existe em todo caso, mas não é usada como parte de prompt/referenceAnswer/studentAnswer", () => {
    for (const c of DATASET_V2) {
      expect(c.prompt.includes(c.rationale)).toBe(false);
      expect(c.referenceAnswer.includes(c.rationale)).toBe(false);
      expect(c.studentAnswer.includes(c.rationale)).toBe(false);
    }
  });
});
