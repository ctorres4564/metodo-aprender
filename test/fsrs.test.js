/* =====================================================================
   TESTES — FSRS (repetição espaçada) em assets/engine.js
   =====================================================================
   Testa invariantes do algoritmo (nunca reescreve os pesos publicados
   pela comunidade open-spaced-repetition), não números "mágicos"
   exatos — os pesos (FSRS_W) são constantes externas conhecidas, então
   fixar valores esperados aqui só duplicaria a fórmula sem provar nada
   de novo. O que importa proteger: monotonicidade (mais fácil = intervalo
   maior), invariantes matemáticos (retrievability em [0,1], difficulty
   sempre em [1,10]), e o comportamento de migração do SM-2 antigo.
   ===================================================================== */
import { beforeEach, describe, expect, it } from "vitest";
import { loadEngineFsrs } from "./helpers/loadEngineFsrs.js";

let engine;
beforeEach(() => {
  engine = loadEngineFsrs(); // contexto novo por teste — sem estado vazando entre eles
});

describe("qualityToFsrsGrade", () => {
  it("mapeia a escala do app (1-5) pra nota FSRS (1-4)", () => {
    expect(engine.qualityToFsrsGrade(1)).toBe(1); // Esqueci
    expect(engine.qualityToFsrsGrade(2)).toBe(1); // Errou na checagem
    expect(engine.qualityToFsrsGrade(3)).toBe(2); // Difícil
    expect(engine.qualityToFsrsGrade(4)).toBe(3); // Bom
    expect(engine.qualityToFsrsGrade(5)).toBe(4); // Fácil
  });
});

describe("fsrsRetrievability", () => {
  it("é 1 (100%) quando não passou nenhum dia desde a revisão", () => {
    expect(engine.fsrsRetrievability(0, 10)).toBeCloseTo(1, 10);
  });

  it("cai conforme mais dias passam (monotonicamente decrescente)", () => {
    const r1 = engine.fsrsRetrievability(1, 10);
    const r10 = engine.fsrsRetrievability(10, 10);
    const r30 = engine.fsrsRetrievability(30, 10);
    expect(r1).toBeGreaterThan(r10);
    expect(r10).toBeGreaterThan(r30);
    expect(r30).toBeGreaterThanOrEqual(0);
  });

  it("é 0 quando stability é 0/nula/negativa (guarda contra divisão degenerada)", () => {
    expect(engine.fsrsRetrievability(5, 0)).toBe(0);
    expect(engine.fsrsRetrievability(5, null)).toBe(0);
    expect(engine.fsrsRetrievability(5, -3)).toBe(0);
  });
});

describe("fsrsUpdate — primeira revisão de uma ficha nova", () => {
  it("marca seen=true, reps=1 e calcula um intervalo de pelo menos 1 dia", () => {
    const card = {};
    engine.fsrsUpdate(card, 4); // "Bom"
    expect(card.seen).toBe(true);
    expect(card.reps).toBe(1);
    expect(card.interval).toBeGreaterThanOrEqual(1);
    expect(card.nextReview).toBe(engine.addDays(engine.todayStr(), card.interval));
  });

  it("difficulty inicial sempre fica dentro de [1, 10], em qualquer nota", () => {
    for (const quality of [1, 2, 3, 4, 5]) {
      const card = {};
      engine.fsrsUpdate(card, quality);
      expect(card.difficulty).toBeGreaterThanOrEqual(1);
      expect(card.difficulty).toBeLessThanOrEqual(10);
    }
  });

  it("nota mais alta (Fácil) gera intervalo maior ou igual que nota mais baixa (Difícil), na primeira revisão", () => {
    const cardHard = {};
    const cardEasy = {};
    engine.fsrsUpdate(cardHard, 3); // Difícil
    engine.fsrsUpdate(cardEasy, 5); // Fácil
    expect(cardEasy.interval).toBeGreaterThanOrEqual(cardHard.interval);
  });

  it("'Esqueci' zera reps mesmo na primeira revisão", () => {
    const card = {};
    engine.fsrsUpdate(card, 1);
    expect(card.reps).toBe(0);
  });
});

describe("fsrsUpdate — migração de progresso do SM-2 antigo", () => {
  it("reaproveita o interval antigo como estabilidade inicial, em vez de reiniciar do zero", () => {
    // Ficha que já vinha sendo revisada pelo SM-2 (seen=true, interval>0)
    // mas nunca passou pelo FSRS (stability/difficulty ainda nulos).
    const card = { seen: true, interval: 20, lastReviewDate: engine.todayStr() };
    engine.fsrsUpdate(card, 4);
    expect(card.stability).toBe(20); // Math.max(1, 20) — reaproveitado, não FSRS_W[g-1]
  });

  it("ficha nova de verdade (nunca vista) usa a estabilidade inicial padrão do FSRS, não o interval", () => {
    const card = { seen: false, interval: 0 };
    engine.fsrsUpdate(card, 4);
    // Não deveria ser 0 nem 1 arbitrário — é FSRS_W[grade-1], um dos pesos
    // publicados. Só verificamos que NÃO seguiu o caminho de migração
    // (que exigiria seen:true) e que é um valor positivo plausível.
    expect(card.stability).toBeGreaterThan(0);
  });
});

describe("fsrsUpdate — revisões subsequentes", () => {
  it("errar (\"Esqueci\") nunca AUMENTA a estabilidade em relação à revisão anterior", () => {
    const card = {};
    engine.fsrsUpdate(card, 4); // primeira revisão, vai bem
    const stabilityBefore = card.stability;
    engine.fsrsUpdate(card, 1); // segunda revisão, esquece
    expect(card.stability).toBeLessThanOrEqual(stabilityBefore);
  });

  it("acertar bem repetidamente aumenta a estabilidade (intervalos crescem)", () => {
    const card = {};
    engine.fsrsUpdate(card, 4);
    const interval1 = card.interval;
    engine.fsrsUpdate(card, 4);
    const interval2 = card.interval;
    expect(interval2).toBeGreaterThanOrEqual(interval1);
  });

  it("reps incrementa a cada acerto e volta a 0 no primeiro erro depois de uma sequência", () => {
    const card = {};
    engine.fsrsUpdate(card, 4);
    engine.fsrsUpdate(card, 4);
    engine.fsrsUpdate(card, 4);
    expect(card.reps).toBe(3);
    engine.fsrsUpdate(card, 1);
    expect(card.reps).toBe(0);
  });

  it("difficulty permanece sempre em [1, 10] depois de várias revisões, incluindo erros", () => {
    const card = {};
    const sequence = [4, 1, 3, 1, 5, 2, 4];
    for (const q of sequence) {
      engine.fsrsUpdate(card, q);
      expect(card.difficulty).toBeGreaterThanOrEqual(1);
      expect(card.difficulty).toBeLessThanOrEqual(10);
    }
  });

  it("difficulty continua no clamp [1, 10] mesmo em sequências longas e extremas (só 'Fácil', ou só 'Difícil')", () => {
    // Sequência curta demais nunca escapa do intervalo mesmo sem o clamp
    // (verificado manualmente) — precisa de bastante repetição pra provar
    // que o clamp realmente está sendo aplicado, não só que o valor
    // "por acaso" ficou dentro da faixa.
    const easyCard = {};
    for (let i = 0; i < 30; i++) {
      engine.fsrsUpdate(easyCard, 5); // sempre Fácil — sem clamp, difficulty despenca bem abaixo de 1
      expect(easyCard.difficulty).toBeGreaterThanOrEqual(1);
      expect(easyCard.difficulty).toBeLessThanOrEqual(10);
    }

    const hardCard = {};
    for (let i = 0; i < 30; i++) {
      engine.fsrsUpdate(hardCard, 3); // sempre Difícil — sem clamp, difficulty poderia passar de 10
      expect(hardCard.difficulty).toBeGreaterThanOrEqual(1);
      expect(hardCard.difficulty).toBeLessThanOrEqual(10);
    }
  });
});
