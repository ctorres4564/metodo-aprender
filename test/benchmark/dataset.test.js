/* =====================================================================
   TESTES — test/benchmark/constructedResponseDataset.js
   =====================================================================
   Valida a FORMA e a distribuição do dataset em si (não a qualidade do
   classificador de IA — isso é papel do runner real, que não roda em
   `npm test`). Determinístico, sem rede.
   ===================================================================== */
import { describe, expect, it } from "vitest";
import { CLASSES } from "./metrics.js";
import { DATASET, DATASET_VERSION } from "./constructedResponseDataset.js";

const REQUIRED_STRING_FIELDS = ["id", "domain", "prompt", "referenceAnswer", "studentAnswer", "rationale"];

describe("DATASET_VERSION", () => {
  it("é uma string não vazia", () => {
    expect(typeof DATASET_VERSION).toBe("string");
    expect(DATASET_VERSION.length).toBeGreaterThan(0);
  });
});

describe("DATASET — tamanho e forma básica", () => {
  it("tem entre 60 e 100 casos", () => {
    expect(DATASET.length).toBeGreaterThanOrEqual(60);
    expect(DATASET.length).toBeLessThanOrEqual(100);
  });

  it("cada caso tem os campos obrigatórios como string não vazia", () => {
    for (const c of DATASET) {
      for (const field of REQUIRED_STRING_FIELDS) {
        expect(typeof c[field], `${c.id || "?"}.${field}`).toBe("string");
        expect(c[field].trim().length, `${c.id || "?"}.${field} vazio`).toBeGreaterThan(0);
      }
    }
  });

  it("todo id é único", () => {
    const ids = DATASET.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("expectedClassification é sempre uma das 3 classes válidas", () => {
    for (const c of DATASET) {
      expect(CLASSES, `${c.id}: ${c.expectedClassification}`).toContain(c.expectedClassification);
    }
  });

  it("referenceAnswer e studentAnswer nunca são idênticos ao prompt (evita casos triviais/mal formados)", () => {
    for (const c of DATASET) {
      expect(c.referenceAnswer).not.toBe(c.prompt);
      expect(c.studentAnswer).not.toBe(c.prompt);
    }
  });
});

describe("DATASET — diversidade de domínio", () => {
  it("usa pelo menos 5 domínios diferentes", () => {
    const domains = new Set(DATASET.map((c) => c.domain));
    expect(domains.size).toBeGreaterThanOrEqual(5);
  });

  it("nenhum domínio concentra sozinho mais da metade dos casos", () => {
    const counts = {};
    for (const c of DATASET) counts[c.domain] = (counts[c.domain] || 0) + 1;
    for (const [domain, count] of Object.entries(counts)) {
      expect(count, domain).toBeLessThanOrEqual(Math.ceil(DATASET.length / 2));
    }
  });
});

describe("DATASET — distribuição por classe (~1/3 cada)", () => {
  it("cada classe representa entre 20% e 45% do total (não é dataset só de casos fáceis/unilateral)", () => {
    const counts = { incorrect: 0, partial: 0, correct: 0 };
    for (const c of DATASET) counts[c.expectedClassification] += 1;
    const total = DATASET.length;
    for (const cls of CLASSES) {
      const ratio = counts[cls] / total;
      expect(ratio, `${cls}: ${counts[cls]}/${total}`).toBeGreaterThanOrEqual(0.2);
      expect(ratio, `${cls}: ${counts[cls]}/${total}`).toBeLessThanOrEqual(0.45);
    }
  });

  it("nenhuma classe está ausente ou quase ausente", () => {
    const counts = { incorrect: 0, partial: 0, correct: 0 };
    for (const c of DATASET) counts[c.expectedClassification] += 1;
    for (const cls of CLASSES) expect(counts[cls]).toBeGreaterThan(10);
  });
});

describe("DATASET — cobertura dos tipos de caso obrigatórios", () => {
  // Cada caseType abaixo precisa aparecer em ao menos 1 caso — mapeia os
  // 18 tipos exigidos na especificação do benchmark para os prefixos/
  // valores usados em constructedResponseDataset.js.
  const REQUIRED_CASE_TYPE_PATTERNS = [
    /^correct_literal$/,                     // 1. resposta correta quase literal
    /^correct_paraphrase$/,                  // 2. paráfrase correta
    /^correct_short$/,                       // 3. resposta correta muito curta
    /^correct_extra_info$/,                  // 4. resposta correta com informação irrelevante
    /^partial_omission$/,                    // 5. parcialmente correta por omissão
    /^partial_imprecision$/,                 // 6. parcialmente correta com pequena imprecisão
    /^partial_split$/,                       // 7. acerta uma parte e erra outra
    /^incorrect_conceptual$/,                // 8. conceitualmente incorreta
    /^incorrect_keyword_wrong_relation$/,    // 9. palavras-chave corretas, relação errada
    /^incorrect_sophisticated$/,             // 10. longa e sofisticada, porém incorreta
    /^incorrect_cause_effect_inversion$/,    // 11. inversão de causa e efeito
    /^incorrect_confusion_close_concepts$/,  // 12. confusão entre conceitos próximos
    /^partial_overgeneralization$/,          // 13. generalização excessiva
    /^partial_example_without_explanation$/, // 14. exemplo correto sem explicação suficiente
    /^incorrect_vague$/,                     // 15. resposta vaga
    /^incorrect_almost_empty$/,              // 16. praticamente vazia, acima do mínimo técnico
    /^incorrect_negation$/,                  // 17. negação incorreta de um conceito
    /^incorrect_subtle_false_positive_trap$/ // 18. erro sutil que pode induzir falso positivo
  ];

  it.each(REQUIRED_CASE_TYPE_PATTERNS)("existe ao menos 1 caso do tipo %s", (pattern) => {
    const matches = DATASET.filter((c) => pattern.test(c.caseType));
    expect(matches.length, `nenhum caso casa com ${pattern}`).toBeGreaterThanOrEqual(1);
  });

  it("casos difíceis (boundary correct_partial ou partial_incorrect) existem em quantidade relevante", () => {
    const boundaryCases = DATASET.filter((c) => c.boundary === "correct_partial" || c.boundary === "partial_incorrect");
    expect(boundaryCases.length).toBeGreaterThanOrEqual(10);
  });
});

describe("DATASET — rationale não vaza para além da auditoria", () => {
  it("rationale existe em todo caso, mas não é usada como parte de prompt/referenceAnswer/studentAnswer", () => {
    for (const c of DATASET) {
      expect(c.prompt.includes(c.rationale)).toBe(false);
      expect(c.referenceAnswer.includes(c.rationale)).toBe(false);
      expect(c.studentAnswer.includes(c.rationale)).toBe(false);
    }
  });
});
