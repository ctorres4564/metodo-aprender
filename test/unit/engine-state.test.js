/* =====================================================================
   TESTES — funções de estado do engine.js (engine-state)
   =====================================================================
   Testa funções puras e semi-puras do motor: datas, estado,
   amostragem, streak, progresso diário, e a lógica de priorização
   de conceitos para o modo Feynman.

   Usa loadEngineFsrsAndSetConcepts(): roda o engine.js REAL num
   contexto isolado do Node, sem tocar em DOM.
   ===================================================================== */

import { beforeEach, describe, expect, it } from "vitest";
import { loadEngineFsrsAndSetConcepts } from "../helpers/loadEngineFsrs.js";

let engine;

beforeEach(() => {
  engine = loadEngineFsrsAndSetConcepts([
    { id: "c1", tag: "Fundamentos", title: "Conceito 1", text: "Explicação 1", q: "Pergunta?", options: ["a", "b", "c"], correct: 0 },
    { id: "c2", tag: "Fundamentos", title: "Conceito 2", text: "Explicação 2", q: "Pergunta?", options: ["a", "b", "c"], correct: 1 },
    { id: "c3", tag: "Avançado",   title: "Conceito 3", text: "Explicação 3", q: "Pergunta?", options: ["a", "b", "c"], correct: 2 },
  ]);
});

// Cria cards para os 3 conceitos injetados no beforeEach. Como várias
// funções iteram sobre CONCEPTS (c1, c2, c3), um STATE.cards incompleto
// faz elas lerem `undefined.seen` e estourarem. Este helper garante que
// todo teste que monta STATE.cards manualmente parta de uma base completa.
function cardsWith(overrides = {}) {
  return {
    c1: { seen: false, reps: 0, nextReview: null, explainCount: 0, lastExplainScore: null, lastQuality: null, retrievalPassedAt: null, explanationPassedAt: null, applicationPassedAt: null },
    c2: { seen: false, reps: 0, nextReview: null, explainCount: 0, lastExplainScore: null, lastQuality: null, retrievalPassedAt: null, explanationPassedAt: null, applicationPassedAt: null },
    c3: { seen: false, reps: 0, nextReview: null, explainCount: 0, lastExplainScore: null, lastQuality: null, retrievalPassedAt: null, explanationPassedAt: null, applicationPassedAt: null },
    ...overrides,
  };
}

// ---- Datas ----

describe("todayStr", () => {
  it("retorna ISO 8601 YYYY-MM-DD", () => {
    expect(engine.todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("addDays", () => {
  it("adiciona dias corretamente", () => {
    expect(engine.addDays("2025-01-10", 5)).toBe("2025-01-15");
    expect(engine.addDays("2025-01-31", 1)).toBe("2025-02-01");
  });

  it("subtrai dias com valor negativo", () => {
    expect(engine.addDays("2025-01-10", -3)).toBe("2025-01-07");
  });

  it("cruza ano corretamente", () => {
    expect(engine.addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(engine.addDays("2025-01-01", -1)).toBe("2024-12-31");
  });
});

describe("daysBetween", () => {
  it("calcula diferença positiva", () => {
    expect(engine.daysBetween("2025-01-01", "2025-01-10")).toBe(9);
  });

  it("calcula diferença negativa quando invertido", () => {
    expect(engine.daysBetween("2025-01-10", "2025-01-01")).toBe(-9);
  });

  it("mesmo dia retorna 0", () => {
    expect(engine.daysBetween("2025-06-15", "2025-06-15")).toBe(0);
  });
});

// ---- Estado ----

describe("defaultState", () => {
  it("cria cards para todos os conceitos com campos FSRS nulos", () => {
    const state = engine.defaultState();
    expect(Object.keys(state.cards)).toHaveLength(3);

    for (const id of ["c1", "c2", "c3"]) {
      const card = state.cards[id];
      expect(card.seen).toBe(false);
      expect(card.reps).toBe(0);
      expect(card.stability).toBeNull();
      expect(card.difficulty).toBeNull();
      expect(card.nextReview).toBeNull();
      expect(card.explainCount).toBe(0);
      expect(card.lastExplainScore).toBeNull();
      expect(card.retrievalPassedAt).toBeNull();
      expect(card.explanationPassedAt).toBeNull();
      expect(card.applicationPassedAt).toBeNull();
      expect(card.pedagogyVersion).toBe(1);
      expect(card.presentedAt).toBeNull();
      expect(card.comprehensionStatus).toBe("not_assessed");
      expect(card.comprehensionIssue).toBeNull();
      expect(card.retrievalAttempts).toEqual([]);
      expect(card.applicationLevel).toBe(0);
      expect(card.applicationAttempts).toEqual([]);
      expect(card.calibrationStatus).toBe("insufficient_data");
      expect(card.lastErrorType).toBeNull();
      expect(card.errorHistory).toEqual([]);
      expect(card.contentQuality).toEqual({ status: "ok", reason: null, reportedAt: null });
    }
  });

  it("inicializa campos de gamificação zerados", () => {
    const state = engine.defaultState();
    expect(state.xp).toBe(0);
    expect(state.streak).toBe(0);
    expect(state.badges).toEqual([]);
    expect(state.reviewSessions).toBe(0);
    expect(state.quiz.played).toBe(0);
    expect(state.quiz.best).toBe(0);
    expect(state.calibration.aligned).toBe(0);
    expect(state.calibration.overconfident).toBe(0);
    expect(state.calibration.underconfident).toBe(0);
    expect(state.schemaVersion).toBe(1);
  });

  it("inicializa configurações padrão", () => {
    const state = engine.defaultState();
    expect(state.settings.dailyNewLimit).toBe(5);
    expect(state.settings.dailyReviewLimit).toBe(0);
  });
});

// ---- Streak ----

describe("touchStreak", () => {
  it("primeiro acesso: streak = 1", () => {
    engine.STATE = { lastStudyDate: null, streak: 0 };
    engine.touchStreak();
    expect(engine.STATE.streak).toBe(1);
    expect(engine.STATE.lastStudyDate).toBe(engine.todayStr());
  });

  it("mesmo dia: mantém streak", () => {
    const today = engine.todayStr();
    engine.STATE = { lastStudyDate: today, streak: 5 };
    engine.touchStreak();
    expect(engine.STATE.streak).toBe(5);
  });

  it("dia consecutivo: incrementa streak", () => {
    const yesterday = engine.addDays(engine.todayStr(), -1);
    engine.STATE = { lastStudyDate: yesterday, streak: 3 };
    engine.touchStreak();
    expect(engine.STATE.streak).toBe(4);
  });

  it("pulou um dia: streak volta a 1", () => {
    const twoDaysAgo = engine.addDays(engine.todayStr(), -2);
    engine.STATE = { lastStudyDate: twoDaysAgo, streak: 7 };
    engine.touchStreak();
    expect(engine.STATE.streak).toBe(1);
  });
});

// ---- Progresso diário ----

describe("resetDailyProgressIfNeeded", () => {
  it("reseta quando a data mudou", () => {
    engine.STATE = { dailyProgress: { date: "2025-01-01", newCount: 10, reviewCount: 5 } };
    engine.resetDailyProgressIfNeeded();
    expect(engine.STATE.dailyProgress.date).toBe(engine.todayStr());
    expect(engine.STATE.dailyProgress.newCount).toBe(0);
    expect(engine.STATE.dailyProgress.reviewCount).toBe(0);
  });

  it("mantém quando é o mesmo dia", () => {
    const today = engine.todayStr();
    engine.STATE = { dailyProgress: { date: today, newCount: 3, reviewCount: 2 } };
    engine.resetDailyProgressIfNeeded();
    expect(engine.STATE.dailyProgress.newCount).toBe(3);
    expect(engine.STATE.dailyProgress.reviewCount).toBe(2);
  });
});

// ---- Status de conceito ----

describe("conceptStatus", () => {
  it("não visto → Novo", () => {
    engine.STATE = { cards: cardsWith({ c1: { seen: false, reps: 0 } }) };
    expect(engine.conceptStatus({ id: "c1" }).label).toBe("Novo");
    expect(engine.conceptStatus({ id: "c1" }).cls).toBe("chip-new");
  });

  it("qualquer quantidade de reps sem evidências → Apresentado", () => {
    for (const reps of [0, 3, 100]) {
      engine.STATE = { cards: cardsWith({ c1: { seen: true, reps } }) };
      expect(engine.conceptStatus({ id: "c1" }).label).toBe("Apresentado");
      expect(engine.conceptStatus({ id: "c1" }).cls).toBe("chip-presented");
    }
  });

  it("somente recuperação ou somente explicação → Em prática", () => {
    engine.STATE = { cards: cardsWith({ c1: { seen: true, retrievalPassedAt: "2026-08-17" } }) };
    expect(engine.conceptStatus({ id: "c1" }).label).toBe("Em prática");
    engine.STATE = { cards: cardsWith({ c1: { seen: true, explanationPassedAt: "2026-08-17" } }) };
    expect(engine.conceptStatus({ id: "c1" }).label).toBe("Em prática");
  });

  it("recuperação + explicação → Retido — transferência não verificada", () => {
    engine.STATE = { cards: cardsWith({ c1: { seen: true, retrievalPassedAt: "2026-08-17", explanationPassedAt: "2026-08-17" } }) };
    expect(engine.conceptStatus({ id: "c1" }).label).toBe("Retido — transferência não verificada");
    expect(engine.conceptStatus({ id: "c1" }).cls).toBe("chip-retained");
  });

  it("não emite rótulos proibidos em nenhuma combinação de evidências", () => {
    const combinations = [
      { seen: false },
      { seen: true },
      { seen: true, reps: 100 },
      { seen: true, retrievalPassedAt: "2026-08-17" },
      { seen: true, explanationPassedAt: "2026-08-17" },
      { seen: true, retrievalPassedAt: "2026-08-17", explanationPassedAt: "2026-08-17", applicationPassedAt: "2026-08-17" },
    ];
    for (const card of combinations) {
      engine.STATE = { cards: cardsWith({ c1: card }) };
      expect(engine.conceptStatus({ id: "c1" }).label).not.toMatch(/aprendido|dominado|consolidado/i);
    }
  });
});

describe("evidências de conceito", () => {
  it("tentativas reprovadas não criam evidência positiva", () => {
    const card = {};
    expect(engine.recordRetrievalEvidence(card, false, "review", 1)).toBe(false);
    expect(engine.recordExplanationEvidence(card, 69)).toBe(false);
    expect(card.retrievalPassedAt).toBeUndefined();
    expect(card.explanationPassedAt).toBeUndefined();
  });

  it("registra separadamente recuperação e explicação aprovadas", () => {
    const card = {};
    expect(engine.recordRetrievalEvidence(card, true, "quiz", 5)).toBe(true);
    expect(engine.recordExplanationEvidence(card, 70)).toBe(true);
    expect(engine.evaluateConceptEvidence(card).retentionVerified).toBe(true);
    expect(engine.evaluateConceptEvidence(card).applicationVerified).toBe(false);
  });

  it("reps não participa da avaliação de retenção", () => {
    expect(engine.evaluateConceptEvidence({ reps: 999 }).retentionVerified).toBe(false);
  });

  it("percentual não muda quando apenas reps aumenta", () => {
    const cards = cardsWith({ c1: { seen: true, reps: 999 } });
    expect(engine.retentionEvidencePercentage(cards, 3)).toBe(0);
  });

  it("percentual considera somente recuperação + explicação", () => {
    const cards = cardsWith({
      c1: { seen: true, retrievalPassedAt: "2026-08-17", explanationPassedAt: "2026-08-17" },
      c2: { seen: true, retrievalPassedAt: "2026-08-17" },
    });
    expect(engine.retentionEvidencePercentage(cards, 3)).toBe(33);
  });
});

describe("apresentação e compreensão", () => {
  it("primeira apresentação define seen/presentedAt sem inferir compreensão", () => {
    const card = engine.defaultCardState();
    expect(engine.markConceptPresented(card)).toBe(true);
    expect(card.seen).toBe(true);
    expect(card.presentedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(card.comprehensionStatus).toBe("not_assessed");
    expect(card.comprehensionIssue).toBeNull();
  });

  it("apresentações posteriores preservam a data original", () => {
    const card = engine.defaultCardState();
    engine.markConceptPresented(card);
    const first = card.presentedAt;
    expect(engine.markConceptPresented(card)).toBe(false);
    expect(card.presentedAt).toBe(first);
  });
});

describe("histórico de recuperação", () => {
  it("registra aprovação e reprovação, confiança e intervalo", () => {
    const card = engine.defaultCardState();
    engine.recordRetrievalEvidence(card, true, "review", 4, 3, 10);
    engine.recordRetrievalEvidence(card, false, "quiz", 2, null, 1);
    expect(card.retrievalAttempts).toHaveLength(2);
    expect(card.retrievalAttempts[0]).toMatchObject({ source:"review", passed:true, quality:4, confidence:3, intervalDays:10 });
    expect(card.retrievalAttempts[1]).toMatchObject({ source:"quiz", passed:false, quality:2, confidence:null, intervalDays:1 });
    expect(card.retrievalPassedAt).not.toBeNull();
  });

  it("falha posterior não apaga evidência positiva", () => {
    const card = engine.defaultCardState();
    engine.recordRetrievalEvidence(card, true, "quiz", 5, null, 30);
    const passedAt = card.retrievalPassedAt;
    engine.recordRetrievalEvidence(card, false, "review", 1, 3, 1);
    expect(card.retrievalPassedAt).toBe(passedAt);
  });

  it("mantém somente as 50 tentativas mais recentes", () => {
    const card = engine.defaultCardState();
    for(let i=0;i<55;i++) engine.recordRetrievalEvidence(card, i%2===0, "quiz", i, null, i);
    expect(card.retrievalAttempts).toHaveLength(50);
    expect(card.retrievalAttempts[0].quality).toBe(5);
  });

  it("aceita fonte futura construída e rejeita fontes não controladas", () => {
    const card = engine.defaultCardState();
    expect(()=>engine.recordRetrievalEvidence(card, true, "constructed_response", 4, 2, 3)).not.toThrow();
    expect(()=>engine.recordRetrievalEvidence(card, true, "qualquer_coisa", 4, 2, 3)).toThrow(/Fonte de recuperação inválida/);
  });
});

describe("calibração por conceito", () => {
  const status = rows => engine.calculateCalibrationStatus(rows.map(([confidence, passed])=>({ confidence, passed })));
  it("menos de 3 tentativas → insufficient_data", () => expect(status([[3,true],[3,false]])).toBe("insufficient_data"));
  it("predomínio de excesso → overconfident", () => expect(status([[3,false],[3,false],[3,false],[1,false]])).toBe("overconfident"));
  it("predomínio de subconfiança → underconfident", () => expect(status([[1,true],[1,true],[1,true],[3,true]])).toBe("underconfident"));
  it("predomínio alinhado → calibrated", () => expect(status([[3,true],[1,false],[2,true],[3,true]])).toBe("calibrated"));
  it("sem predomínio → mixed", () => expect(status([[3,false],[1,true],[3,true]])).toBe("mixed"));
});

describe("erros pedagógicos", () => {
  it("falha de recuperação registra retrieval_failure", () => {
    const card = engine.defaultCardState();
    engine.recordRetrievalEvidence(card, false, "quiz", 2, null, 1);
    expect(card.lastErrorType).toBe("retrieval_failure");
  });

  it("explicação incompleta e erro conceitual são distintos", () => {
    const incomplete = engine.defaultCardState();
    engine.recordExplanationOutcome(incomplete, 40, { pontosFaltando:["mecanismo"] });
    expect(incomplete.lastErrorType).toBe("incomplete_explanation");
    const conceptual = engine.defaultCardState();
    engine.recordExplanationOutcome(conceptual, 30, { equivocos:["causa invertida"] });
    expect(conceptual.lastErrorType).toBe("conceptual_error");
  });

  it("não cria erro conceitual sem equívoco explícito", () => {
    const card = engine.defaultCardState();
    engine.recordExplanationOutcome(card, 90, { equivocos:[] });
    expect(card.lastErrorType).toBeNull();
  });

  it("histórico respeita o limite de 50", () => {
    const card = engine.defaultCardState();
    for(let i=0;i<55;i++) engine.recordError(card, "execution_error", "test", String(i));
    expect(card.errorHistory).toHaveLength(50);
    expect(card.errorHistory[0].detail).toBe("5");
  });
});

describe("conteúdo problemático", () => {
  it("marca conteúdo sem alterar evidências nem FSRS", () => {
    const card = Object.assign(engine.defaultCardState(), { retrievalPassedAt:"2026-08-17", stability:12, difficulty:4, reps:8 });
    const before = { retrievalPassedAt:card.retrievalPassedAt, stability:card.stability, difficulty:card.difficulty, reps:card.reps };
    engine.reportContentProblem(card, "Pergunta ambígua");
    expect(card.contentQuality).toMatchObject({ status:"reported", reason:"Pergunta ambígua" });
    expect({ retrievalPassedAt:card.retrievalPassedAt, stability:card.stability, difficulty:card.difficulty, reps:card.reps }).toEqual(before);
  });
});

describe("migração de evidências legadas", () => {
  it("não fabrica recuperação/aplicação a partir de reps e lastQuality", async () => {
    engine.CONFIG = { storageKey: "test" };
    engine.StorageAdapter = {
      load: async () => ({
        cards: { c1: { seen: true, reps: 50, lastQuality: 5, lastExplainScore: null } },
        badges: ["mastered5", "mastered_all"],
      }),
    };
    const state = await engine.loadState();
    expect(state.cards.c1.retrievalPassedAt).toBeNull();
    expect(state.cards.c1.explanationPassedAt).toBeNull();
    expect(state.cards.c1.applicationPassedAt).toBeNull();
    expect(state.badges).toEqual([]);
  });

  it("migra apenas explicação antiga aprovada, sem inferir recuperação", async () => {
    engine.CONFIG = { storageKey: "test" };
    engine.StorageAdapter = {
      load: async () => ({ cards: { c1: { seen: true, reps: 8, lastExplainScore: 85 } } }),
    };
    const state = await engine.loadState();
    expect(state.cards.c1.explanationPassedAt).toBe("legacy");
    expect(state.cards.c1.retrievalPassedAt).toBeNull();
    expect(engine.evaluateConceptEvidence(state.cards.c1).retentionVerified).toBe(false);
  });

  it("preserva FSRS e é idempotente sem fabricar históricos", () => {
    const legacy = { schemaVersion:0, cards:{ c1:{ seen:true, stability:18, difficulty:6, reps:9, nextReview:"2026-09-01", lastConfidence:3 } } };
    const once = engine.migrateState(legacy);
    const twice = engine.migrateState(once);
    expect(twice.cards.c1).toEqual(once.cards.c1);
    expect(once.cards.c1).toMatchObject({ stability:18, difficulty:6, reps:9, nextReview:"2026-09-01", lastConfidence:3 });
    expect(once.cards.c1.retrievalAttempts).toEqual([]);
    expect(once.cards.c1.applicationAttempts).toEqual([]);
    expect(once.cards.c1.comprehensionStatus).toBe("not_assessed");
    expect(once.cards.c1.applicationPassedAt).toBeNull();
  });
});

// ---- Cartas vencidas ----

describe("dueCards", () => {
  it("retorna apenas cartões com nextReview <= today", () => {
    const today = engine.todayStr();
    const future = engine.addDays(today, 5);
    engine.STATE = {
      cards: cardsWith({
        c1: { seen: true, nextReview: today, reps: 1 },
        c2: { seen: true, nextReview: future, reps: 1 },
        c3: { seen: false, nextReview: null, reps: 0 },
      }),
    };
    const due = engine.dueCards();
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe("c1");
  });

  it("cartão vencido ontem também aparece", () => {
    const yesterday = engine.addDays(engine.todayStr(), -1);
    const future = engine.addDays(engine.todayStr(), 5);
    engine.STATE = {
      cards: cardsWith({
        c1: { seen: true, nextReview: yesterday, reps: 2 },
        c2: { seen: true, nextReview: future, reps: 1 },
        c3: { seen: false, nextReview: null, reps: 0 },
      }),
    };
    expect(engine.dueCards()).toHaveLength(1);
  });

  it("retorna [] quando todos estão em dia", () => {
    const future = engine.addDays(engine.todayStr(), 10);
    engine.STATE = {
      cards: cardsWith({
        c1: { seen: true, nextReview: future, reps: 1 },
        c2: { seen: true, nextReview: future, reps: 1 },
        c3: { seen: false, nextReview: null, reps: 0 },
      }),
    };
    expect(engine.dueCards()).toHaveLength(0);
  });
});

// ---- Amostragem ponderada ----

describe("weightedSample", () => {
  it("retorna exatamente n itens", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = engine.weightedSample(items, () => 1, 2);
    expect(result).toHaveLength(2);
  });

  it("não estoura se pool menor que n", () => {
    const items = [{ id: "a" }];
    const result = engine.weightedSample(items, () => 1, 5);
    expect(result).toHaveLength(1);
  });

  it("itens com peso maior aparecem primeiro (probabilístico)", () => {
    const items = [{ id: "heavy" }, { id: "light" }];
    // Peso 1000x maior → deve ser o primeiro SEMPRE
    const result = engine.weightedSample(items, (it) => it.id === "heavy" ? 1000 : 1, 2);
    expect(result[0].id).toBe("heavy");
  });

  it("não repete itens", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const result = engine.weightedSample(items, () => 1, 3);
    const ids = result.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("pool vazio retorna []", () => {
    expect(engine.weightedSample([], () => 1, 3)).toEqual([]);
  });
});

// ---- Fraqueza do conceito (Quiz Adaptativo) ----

describe("conceptWeakness", () => {
  it("penaliza conceitos com poucas repetições", () => {
    engine.STATE = { cards: cardsWith({ c1: { reps: 0 } }) };
    const w = engine.conceptWeakness({ id: "c1" });
    expect(w).toBeGreaterThan(3); // 5 - 0 = 5, mais possíveis penalidades
  });

  it("penaliza conceito com revisão vencida", () => {
    const yesterday = engine.addDays(engine.todayStr(), -1);
    engine.STATE = { cards: cardsWith({ c1: { reps: 5, nextReview: yesterday, lastExplainScore: null, lastQuality: null } }) };
    const w = engine.conceptWeakness({ id: "c1" });
    expect(w).toBeGreaterThan(3); // base baixa + 3 por vencido
  });

  it("conceito com bons indicadores operacionais tem fraqueza baixa", () => {
    const future = engine.addDays(engine.todayStr(), 30);
    engine.STATE = { cards: cardsWith({ c1: { reps: 10, nextReview: future, lastExplainScore: 90, lastQuality: 5 } }) };
    const w = engine.conceptWeakness({ id: "c1" });
    expect(w).toBeLessThanOrEqual(5);
  });

  it("penaliza explicação fraca no Feynman", () => {
    const future = engine.addDays(engine.todayStr(), 10);
    engine.STATE = { cards: cardsWith({ c1: { reps: 5, nextReview: future, lastExplainScore: 40, lastQuality: 4 } }) };
    const w = engine.conceptWeakness({ id: "c1" });
    // lastExplainScore 40 < 60 → +2
    expect(w).toBeGreaterThanOrEqual(2);
  });
});

// ---- Priorização de explicação (Feynman) ----

describe("pickExplainConcept", () => {
  it("prioriza conceitos vencidos — o mais atrasado primeiro", () => {
    const today = engine.todayStr();
    const yesterday = engine.addDays(today, -1);
    const twoDaysAgo = engine.addDays(today, -2);

    engine.STATE = {
      cards: cardsWith({
        c1: { seen: true, nextReview: yesterday, explainCount: 0 },
        c2: { seen: true, nextReview: twoDaysAgo, explainCount: 0 },
        c3: { seen: false, nextReview: null, explainCount: 0 },
      }),
    };

    const picked = engine.pickExplainConcept();
    expect(picked.id).toBe("c2"); // mais atrasado
  });

  it("depois dos vencidos, prioriza nunca explicados", () => {
    const future = engine.addDays(engine.todayStr(), 10);
    engine.STATE = {
      cards: cardsWith({
        c1: { seen: true, nextReview: future, explainCount: 5, lastExplainScore: 80 },
        c2: { seen: true, nextReview: future, explainCount: 0 },
        c3: { seen: false, nextReview: null, explainCount: 0 },
      }),
    };
    const picked = engine.pickExplainConcept();
    expect(picked.id).toBe("c2");
  });

  it("retorna null quando não há conceitos vistos", () => {
    engine.STATE = {
      cards: cardsWith({
        c1: { seen: false, nextReview: null },
        c2: { seen: false, nextReview: null },
        c3: { seen: false, nextReview: null },
      }),
    };
    expect(engine.pickExplainConcept()).toBeNull();
  });

  it("quando tudo em dia e todos já explicados, sorteia qualquer um", () => {
    const future = engine.addDays(engine.todayStr(), 10);
    engine.STATE = {
      cards: cardsWith({
        c1: { seen: true, nextReview: future, explainCount: 1 },
        c2: { seen: true, nextReview: future, explainCount: 1 },
        c3: { seen: false, nextReview: null, explainCount: 0 },
      }),
    };
    const picked = engine.pickExplainConcept();
    expect(picked).not.toBeNull();
    expect(["c1", "c2"]).toContain(picked.id);
  });
});

describe("dueForExplanation", () => {
  it("conta conceitos vencidos", () => {
    const today = engine.todayStr();
    const yesterday = engine.addDays(today, -1);
    engine.STATE = {
      cards: cardsWith({
        c1: { seen: true, nextReview: yesterday },
        c2: { seen: true, nextReview: today },
        c3: { seen: true, nextReview: engine.addDays(today, 10) },
      }),
    };
    expect(engine.dueForExplanation()).toHaveLength(2);
  });

  it("ignora conceitos nunca vistos", () => {
    const yesterday = engine.addDays(engine.todayStr(), -1);
    engine.STATE = {
      cards: cardsWith({
        c1: { seen: false, nextReview: null },
        c2: { seen: true, nextReview: yesterday },
        c3: { seen: false, nextReview: null },
      }),
    };
    const due = engine.dueForExplanation();
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe("c2");
  });
});

// ---- qualityToFsrsGrade (já testado em fsrs.test.js, regressão rápida) ----

describe("qualityToFsrsGrade", () => {
  it("1 (Esqueci) → 1", () => expect(engine.qualityToFsrsGrade(1)).toBe(1));
  it("2 (Errou na checagem) → 1", () => expect(engine.qualityToFsrsGrade(2)).toBe(1));
  it("3 (Difícil) → 2", () => expect(engine.qualityToFsrsGrade(3)).toBe(2));
  it("4 (Bom) → 3", () => expect(engine.qualityToFsrsGrade(4)).toBe(3));
  it("5 (Fácil) → 4", () => expect(engine.qualityToFsrsGrade(5)).toBe(4));
});
