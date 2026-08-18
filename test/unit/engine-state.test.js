/* =====================================================================
   TESTES — funções de estado do engine.js (engine-state)
   =====================================================================
   Testa funções puras e semi-puras do motor: datas, estado,
   amostragem, streak, progresso diário, e a lógica de priorização
   de conceitos para o modo Feynman.

   Usa loadEngineFsrsAndSetConcepts(): roda o engine.js REAL num
   contexto isolado do Node, sem tocar em DOM.
   ===================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
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
      expect(card.retrievalEvidenceStrength).toBe("none");
      expect(card.strongRetrievalPassedAt).toBeNull();
      expect(card.pendingConstructedResponse).toBeNull();
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

  function preparePersistence(card){
    let saves = 0;
    engine.STATE = { cards:{ c1:card } };
    engine.CONFIG = { storageKey:"test" };
    engine.StorageAdapter = { save:async()=>{ saves += 1; } };
    return ()=>saves;
  }

  it("persiste no_issue_detected sem transformar percepção em evidência", async () => {
    const card = engine.defaultCardState();
    const saves = preparePersistence(card);
    await engine.recordComprehensionStatus(card, "no_issue_detected", "texto ignorado");
    expect(card.comprehensionStatus).toBe("no_issue_detected");
    expect(card.comprehensionIssue).toBeNull();
    expect(saves()).toBe(1);
    expect(card.retrievalPassedAt).toBeNull();
    expect(card.explanationPassedAt).toBeNull();
    expect(card.applicationPassedAt).toBeNull();
  });

  it("doubt_reported e blocked aceitam descrição opcional", async () => {
    const card = engine.defaultCardState();
    preparePersistence(card);
    await engine.recordComprehensionStatus(card, "doubt_reported", "Não entendi a relação causal");
    expect(card.comprehensionIssue).toBe("Não entendi a relação causal");
    await engine.recordComprehensionStatus(card, "blocked", "Falta um pré-requisito");
    expect(card.comprehensionStatus).toBe("blocked");
    expect(card.comprehensionIssue).toBe("Falta um pré-requisito");
  });

  it("rejeita status inválido", async () => {
    const card = engine.defaultCardState();
    preparePersistence(card);
    await expect(engine.recordComprehensionStatus(card, "comprovado", null)).rejects.toThrow(/Status de compreensão inválido/);
  });

  it("alterar compreensão não modifica FSRS nem evidências", async () => {
    const card = Object.assign(engine.defaultCardState(), {
      retrievalPassedAt:"2026-08-01", explanationPassedAt:"2026-08-02", applicationPassedAt:null,
      stability:20, difficulty:4, nextReview:"2026-08-20", reps:7
    });
    preparePersistence(card);
    const before = {
      retrievalPassedAt:card.retrievalPassedAt, explanationPassedAt:card.explanationPassedAt,
      applicationPassedAt:card.applicationPassedAt, stability:card.stability,
      difficulty:card.difficulty, nextReview:card.nextReview, reps:card.reps
    };
    await engine.recordComprehensionStatus(card, "blocked", "Ainda confuso");
    await engine.recordComprehensionStatus(card, "no_issue_detected", null);
    expect(card.comprehensionStatus).toBe("no_issue_detected");
    expect(card.comprehensionIssue).toBeNull();
    expect({
      retrievalPassedAt:card.retrievalPassedAt, explanationPassedAt:card.explanationPassedAt,
      applicationPassedAt:card.applicationPassedAt, stability:card.stability,
      difficulty:card.difficulty, nextReview:card.nextReview, reps:card.reps
    }).toEqual(before);
  });

  it("conceptStatus permanece independente da autopercepção", () => {
    for(const comprehensionStatus of ["no_issue_detected", "doubt_reported", "blocked"]){
      engine.STATE = { cards:cardsWith({ c1:{ seen:true, comprehensionStatus } }) };
      expect(engine.conceptStatus({ id:"c1" }).label).toBe("Apresentado");
    }
  });
});

describe("histórico de recuperação", () => {
  function runScheduledAttempt(card, passed, quality, confidence){
    const elapsedDays = engine.elapsedDaysSinceLastReview(card);
    engine.fsrsUpdate(card, quality);
    engine.recordRetrievalEvidence(card, passed, "review", quality, confidence, elapsedDays);
    return card.retrievalAttempts.at(-1);
  }

  it("primeira tentativa registra intervalDays null", () => {
    const card = engine.defaultCardState();
    const attempt = runScheduledAttempt(card, true, 4, 2);
    expect(attempt.intervalDays).toBeNull();
  });

  it("tentativa após 3 dias registra exatamente 3 dias", () => {
    const card = Object.assign(engine.defaultCardState(), {
      seen:true, stability:12, difficulty:5, lastReviewDate:engine.addDays(engine.todayStr(), -3), interval:12
    });
    const attempt = runScheduledAttempt(card, true, 4, 2);
    expect(attempt.intervalDays).toBe(3);
  });

  it("não confunde dias transcorridos com o novo intervalo futuro do FSRS", () => {
    const card = Object.assign(engine.defaultCardState(), {
      seen:true, stability:100, difficulty:3, lastReviewDate:engine.addDays(engine.todayStr(), -3), interval:100
    });
    const attempt = runScheduledAttempt(card, true, 5, 3);
    expect(attempt.intervalDays).toBe(3);
    expect(attempt.intervalDays).not.toBe(card.interval);
  });

  it("falha e acerto usam o mesmo intervalo transcorrido", () => {
    const makeCard = ()=>Object.assign(engine.defaultCardState(), {
      seen:true, stability:10, difficulty:5, lastReviewDate:engine.addDays(engine.todayStr(), -3), interval:10
    });
    expect(runScheduledAttempt(makeCard(), false, 1, 3).intervalDays).toBe(3);
    expect(runScheduledAttempt(makeCard(), true, 4, 2).intervalDays).toBe(3);
  });

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

describe("resposta construída", () => {
  const concept = { id:"c1", tag:"Biologia", title:"Seleção natural", q:"Quais princípios sustentam a seleção natural?", text:"Variação, hereditariedade e reprodução diferencial." };

  function validSession(confidence = 2, startedAt = 1000, submittedAt = 2500){
    const session = engine.createConstructedAttemptSession("c1", startedAt);
    engine.setConstructedConfidence(session, confidence);
    engine.submitConstructedResponse(session, "Variação herdável e reprodução diferencial", submittedAt);
    engine.revealConstructedResponse(session);
    return session;
  }

  it("estímulo inicial não contém conteúdo de referência", () => {
    const prompt = engine.constructedPromptData(concept);
    expect(prompt).toMatchObject({ conceptId:"c1", tag:"Biologia", prompt:concept.q });
    expect(prompt).not.toHaveProperty("text");
    expect(prompt).not.toHaveProperty("referenceText");
  });

  it("exige confiança antes do envio", () => {
    const session = engine.createConstructedAttemptSession("c1", 1000);
    expect(()=>engine.submitConstructedResponse(session, "Resposta suficientemente longa", 2000)).toThrow(/confiança/);
  });

  it("exige resposta válida antes de revelar referência", () => {
    const session = engine.createConstructedAttemptSession("c1", 1000);
    engine.setConstructedConfidence(session, 2);
    expect(()=>engine.revealConstructedResponse(session)).toThrow(/antes do envio/);
    expect(()=>engine.submitConstructedResponse(session, "curta", 2000)).toThrow(/ao menos 10/);
  });

  it("revela referência somente depois de confiança + resposta enviada", () => {
    const session = engine.createConstructedAttemptSession("c1", 1000);
    engine.setConstructedConfidence(session, 3);
    engine.submitConstructedResponse(session, "Resposta suficientemente longa", 1800);
    const reference = engine.getConstructedReference(session, concept);
    expect(reference.responseText).toBe("Resposta suficientemente longa");
    expect(reference.referenceText).toBe(concept.text);
  });

  it("não permite alterar confiança retroativamente", () => {
    const session = validSession();
    expect(()=>engine.setConstructedConfidence(session, 3)).toThrow(/não pode ser alterada/);
  });

  it("registra tentativa completa, latência e intervalo decorrido", () => {
    const card = Object.assign(engine.defaultCardState(), {
      seen:true, stability:10, difficulty:5, interval:10, lastReviewDate:engine.addDays(engine.todayStr(), -3)
    });
    const attempt = engine.recordConstructedResponseAttempt(card, validSession(3, 1000, 2600), "correct");
    expect(attempt).toMatchObject({
      source:"constructed_response", responseType:"constructed", responseText:"Variação herdável e reprodução diferencial",
      confidence:3, latencyMs:1600, intervalDays:3, quality:4, passed:true, evidenceStrength:"strong"
    });
    expect(attempt.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("correta cria evidência forte; parcial e falha não", () => {
    const correct = engine.defaultCardState();
    engine.recordConstructedResponseAttempt(correct, validSession(), "correct");
    expect(correct.strongRetrievalPassedAt).not.toBeNull();
    expect(correct.retrievalEvidenceStrength).toBe("strong");

    for(const rating of ["partial", "failed"]){
      const card = engine.defaultCardState();
      engine.recordConstructedResponseAttempt(card, validSession(), rating);
      expect(card.strongRetrievalPassedAt).toBeNull();
      expect(card.retrievalPassedAt).toBeNull();
      expect(card.retrievalEvidenceStrength).toBe("none");
    }
  });

  it("múltipla escolha permanece evidência fraca e revisão rápida média", () => {
    const quiz = engine.defaultCardState();
    engine.recordRetrievalEvidence(quiz, true, "quiz", 5, null, 2);
    expect(quiz.retrievalEvidenceStrength).toBe("weak");
    expect(quiz.strongRetrievalPassedAt).toBeNull();
    expect(quiz.retrievalAttempts[0].responseType).toBe("multiple_choice");

    const review = engine.defaultCardState();
    engine.recordRetrievalEvidence(review, true, "review", 4, 2, 2);
    expect(review.retrievalEvidenceStrength).toBe("medium");
    expect(review.retrievalAttempts[0].responseType).toBe("self_rated_review");
  });

  it("acerto e falha alimentam o FSRS sem usar intervalo futuro como elapsedDays", () => {
    for(const rating of ["correct", "failed"]){
      const card = Object.assign(engine.defaultCardState(), {
        seen:true, stability:100, difficulty:5, interval:100, lastReviewDate:engine.addDays(engine.todayStr(), -13)
      });
      const previousStability = card.stability;
      const attempt = engine.recordConstructedResponseAttempt(card, validSession(), rating);
      expect(card.lastReviewDate).toBe(engine.todayStr());
      expect(attempt.intervalDays).toBe(13);
      expect(attempt.intervalDays).not.toBe(card.interval);
      expect(card.stability).not.toBeNull();
      if(rating === "failed") expect(card.stability).toBeLessThanOrEqual(previousStability);
    }
  });

  it("alimenta calibração com confiança alta+falha e baixa+acerto", () => {
    const over = engine.defaultCardState();
    for(let i=0;i<3;i++) engine.recordConstructedResponseAttempt(over, validSession(3), "failed");
    expect(over.calibrationStatus).toBe("overconfident");

    const under = engine.defaultCardState();
    for(let i=0;i<3;i++) engine.recordConstructedResponseAttempt(under, validSession(1), "correct");
    expect(under.calibrationStatus).toBe("underconfident");
  });
});

describe("avaliação semântica por IA da resposta construída", () => {
  const concept = { id:"c1", tag:"Biologia", title:"Seleção natural", q:"Quais princípios sustentam a seleção natural?", text:"Variação, hereditariedade e reprodução diferencial." };

  function validSession(confidence = 2, startedAt = 1000, submittedAt = 2500){
    const session = engine.createConstructedAttemptSession("c1", startedAt);
    engine.setConstructedConfidence(session, confidence);
    engine.submitConstructedResponse(session, "Variação herdável e reprodução diferencial", submittedAt);
    engine.revealConstructedResponse(session);
    return session;
  }

  describe("validateConstructedAiEvaluation — schema de saída", () => {
    it("aceita saída bem formada e clampa confidence em [0,1]", () => {
      const result = engine.validateConstructedAiEvaluation({ classification:"correct", confidence:1.5, reason:"cobre os três princípios", model:"openai/gpt-4o-mini" });
      expect(result).toEqual({ classification:"correct", confidence:1, reason:"cobre os três princípios", model:"openai/gpt-4o-mini" });
    });

    it("aceita ausência de model (compatibilidade com respostas sem esse campo) como string vazia", () => {
      const result = engine.validateConstructedAiEvaluation({ classification:"partial", confidence:0.5, reason:"x" });
      expect(result.model).toBe("");
    });

    it("rejeita classification fora do enum (output inválido)", () => {
      expect(engine.validateConstructedAiEvaluation({ classification:"quase", confidence:0.5, reason:"x" })).toBeNull();
    });

    it("rejeita confidence não numérico (output inválido)", () => {
      expect(engine.validateConstructedAiEvaluation({ classification:"correct", confidence:"alta", reason:"x" })).toBeNull();
    });

    it("rejeita payload nulo ou não-objeto", () => {
      expect(engine.validateConstructedAiEvaluation(null)).toBeNull();
      expect(engine.validateConstructedAiEvaluation("correct")).toBeNull();
    });
  });

  describe("attachAiEvaluationToAttempt — persistência e separação", () => {
    it("anexa aiEvaluation ao attempt sem alterar os campos da autoavaliação", () => {
      const card = engine.defaultCardState();
      const attempt = engine.recordConstructedResponseAttempt(card, validSession(), "partial");
      const snapshotBefore = { passed:attempt.passed, quality:attempt.quality, evidenceStrength:attempt.evidenceStrength, confidence:attempt.confidence };

      engine.attachAiEvaluationToAttempt(attempt, { classification:"correct", confidence:0.9, reason:"na verdade cobre tudo", model:"openai/gpt-4o-mini" });

      expect(attempt.aiEvaluation).toEqual(expect.objectContaining({ classification:"correct", confidence:0.9, reason:"na verdade cobre tudo", model:"openai/gpt-4o-mini" }));
      expect(attempt.aiEvaluation.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // A autoavaliação do usuário (o que já dirigiu FSRS e evidência) continua intacta.
      expect(attempt.passed).toBe(snapshotBefore.passed);
      expect(attempt.quality).toBe(snapshotBefore.quality);
      expect(attempt.evidenceStrength).toBe(snapshotBefore.evidenceStrength);
      expect(attempt.confidence).toBe(snapshotBefore.confidence);
    });

    it("não sobrescreve autoavaliação existente mesmo quando a IA discorda da classificação do usuário", () => {
      const card = engine.defaultCardState();
      // Usuário se autoavalia como "failed" (evidência none, sem retrievalPassedAt).
      const attempt = engine.recordConstructedResponseAttempt(card, validSession(), "failed");
      expect(card.retrievalPassedAt).toBeNull();
      expect(card.strongRetrievalPassedAt).toBeNull();

      // IA discorda e classifica como "correct" — mesmo assim não deve promover evidência.
      engine.attachAiEvaluationToAttempt(attempt, { classification:"correct", confidence:0.95, reason:"na verdade está certo" });

      expect(card.retrievalPassedAt).toBeNull();
      expect(card.strongRetrievalPassedAt).toBeNull();
      expect(card.retrievalEvidenceStrength).toBe("none");
      expect(attempt.passed).toBe(false);
    });

    it("registro sem aiEvaluation (histórico antigo) permanece válido — compatibilidade", () => {
      const legacyAttempt = { at:"2026-01-01T00:00:00.000Z", source:"constructed_response", passed:true, quality:4, confidence:2, intervalDays:3, responseType:"constructed", evidenceStrength:"strong", responseText:"resposta antiga" };
      expect(legacyAttempt.aiEvaluation).toBeUndefined();
      expect(() => engine.attachAiEvaluationToAttempt(legacyAttempt, { classification:"partial", confidence:0.4, reason:"x", model:"openai/gpt-4o-mini" })).not.toThrow();
      expect(legacyAttempt.aiEvaluation.classification).toBe("partial");
      expect(legacyAttempt.aiEvaluation.model).toBe("openai/gpt-4o-mini");
    });

    it("persiste o modelo utilizado em aiEvaluation.model, e um attempt antigo sem aiEvaluation continua legível mesmo com o campo model presente em novos registros", () => {
      const card = engine.defaultCardState();
      const attempt = engine.recordConstructedResponseAttempt(card, validSession(), "correct");
      engine.attachAiEvaluationToAttempt(attempt, { classification:"correct", confidence:0.85, reason:"ok", model:"anthropic/claude-3-haiku" });

      expect(attempt.aiEvaluation.model).toBe("anthropic/claude-3-haiku");

      // Um registro antigo (sem aiEvaluation nenhum) convive no mesmo array sem quebrar leitura.
      card.retrievalAttempts.unshift({ at:"2025-01-01T00:00:00.000Z", source:"constructed_response", passed:true, quality:4, responseType:"constructed", evidenceStrength:"strong" });
      expect(card.retrievalAttempts[0].aiEvaluation).toBeUndefined();
      expect(card.retrievalAttempts[card.retrievalAttempts.length - 1].aiEvaluation.model).toBe("anthropic/claude-3-haiku");
    });

    it("aiEvaluation nulo ou attempt ausente não lança nem cria campo", () => {
      const attempt = { passed:true };
      expect(engine.attachAiEvaluationToAttempt(attempt, null)).toBe(attempt);
      expect(attempt.aiEvaluation).toBeUndefined();
      expect(engine.attachAiEvaluationToAttempt(null, { classification:"correct", confidence:0.9, reason:"x" })).toBeNull();
    });

    it("FSRS e strongRetrievalPassedAt permanecem os definidos pela autoavaliação, mesmo após anexar avaliação de IA divergente", () => {
      const card = Object.assign(engine.defaultCardState(), {
        seen:true, stability:10, difficulty:5, interval:10, lastReviewDate:engine.addDays(engine.todayStr(), -3)
      });
      const attempt = engine.recordConstructedResponseAttempt(card, validSession(3, 1000, 2600), "correct");
      const stabilityAfterSelfRating = card.stability;
      const strongAtAfterSelfRating = card.strongRetrievalPassedAt;

      engine.attachAiEvaluationToAttempt(attempt, { classification:"incorrect", confidence:0.7, reason:"discordo" });

      expect(card.stability).toBe(stabilityAfterSelfRating);
      expect(card.strongRetrievalPassedAt).toBe(strongAtAfterSelfRating);
      expect(card.retrievalEvidenceStrength).toBe("strong");
    });
  });
});

describe("concordância autoavaliação x IA (experimento pedagógico, Prioridade 4)", () => {
  function constructedAttempt(overrides = {}){
    return Object.assign({
      at:"2026-01-01T00:00:00.000Z", source:"constructed_response", passed:true, quality:4,
      confidence:2, intervalDays:3, responseType:"constructed", evidenceStrength:"strong",
      responseText:"resposta do usuário"
    }, overrides);
  }

  describe("deriveUserClassificationFromAttempt", () => {
    it("mapeia quality 4/3/1 para correct/partial/incorrect", () => {
      expect(engine.deriveUserClassificationFromAttempt(constructedAttempt({ quality:4 }))).toBe("correct");
      expect(engine.deriveUserClassificationFromAttempt(constructedAttempt({ quality:3 }))).toBe("partial");
      expect(engine.deriveUserClassificationFromAttempt(constructedAttempt({ quality:1 }))).toBe("incorrect");
    });

    it("retorna null para attempts que não são de resposta construída (quiz/review)", () => {
      expect(engine.deriveUserClassificationFromAttempt(constructedAttempt({ source:"quiz", quality:5 }))).toBeNull();
      expect(engine.deriveUserClassificationFromAttempt(constructedAttempt({ source:"review", quality:4 }))).toBeNull();
    });

    it("retorna null para quality desconhecido, ausente ou attempt nulo", () => {
      expect(engine.deriveUserClassificationFromAttempt(constructedAttempt({ quality:2 }))).toBeNull();
      expect(engine.deriveUserClassificationFromAttempt(constructedAttempt({ quality:undefined }))).toBeNull();
      expect(engine.deriveUserClassificationFromAttempt(null)).toBeNull();
    });

    it("não introduz nem depende de nenhum campo novo — só quality, já persistido", () => {
      const attempt = constructedAttempt({ quality:4 });
      const keysBefore = Object.keys(attempt).sort();
      engine.deriveUserClassificationFromAttempt(attempt);
      expect(Object.keys(attempt).sort()).toEqual(keysBefore);
    });
  });

  describe("buildAiAgreementRecord — privacidade e forma do registro", () => {
    it("monta o registro com classes/confidence/domínio, nunca com responseText/reason/referenceText", () => {
      const attempt = constructedAttempt({
        quality:4,
        aiEvaluation:{ classification:"partial", confidence:0.8, reason:"texto completo do motivo da IA", evaluatedAt:"2026-01-02T00:00:00.000Z", model:"m" }
      });
      const record = engine.buildAiAgreementRecord("c1", "Biologia", attempt);
      expect(record).toEqual({ conceptId:"c1", domain:"Biologia", userClass:"correct", aiClass:"partial", confidence:0.8, at:"2026-01-02T00:00:00.000Z" });
      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain("resposta do usuário");
      expect(serialized).not.toContain("texto completo do motivo da IA");
    });

    it("retorna null quando não há aiEvaluation (tentativa sem IA concluída ainda)", () => {
      const attempt = constructedAttempt({ quality:3 });
      expect(engine.buildAiAgreementRecord("c1", "Biologia", attempt)).toBeNull();
    });

    it("retorna null para dados antigos sem responseType/aiEvaluation (registro pré-Prioridade-3)", () => {
      const legacyAttempt = { at:"2025-01-01T00:00:00.000Z", source:"constructed_response", passed:true, quality:4 };
      expect(engine.buildAiAgreementRecord("c1", "Biologia", legacyAttempt)).toBeNull();
    });

    it("retorna null quando não há autoavaliação derivável (source diferente de constructed_response)", () => {
      const attempt = constructedAttempt({ source:"quiz", quality:5, aiEvaluation:{ classification:"correct", confidence:0.9 } });
      expect(engine.buildAiAgreementRecord("c1", "Biologia", attempt)).toBeNull();
    });
  });

  describe("collectAiAgreementRecords + matriz de concordância 3x3", () => {
    const cards = {
      c1: { retrievalAttempts:[ constructedAttempt({ quality:4, aiEvaluation:{ classification:"correct", confidence:0.9, evaluatedAt:"2026-01-01T00:00:00.000Z" } }) ] },
      c2: { retrievalAttempts:[ constructedAttempt({ quality:3, aiEvaluation:{ classification:"correct", confidence:0.8, evaluatedAt:"2026-01-01T00:00:00.000Z" } }) ] }, // IA mais generosa
      c3: { retrievalAttempts:[ constructedAttempt({ quality:4, aiEvaluation:{ classification:"partial", confidence:0.7, evaluatedAt:"2026-01-01T00:00:00.000Z" } }) ] }, // IA mais rígida
      c4: { retrievalAttempts:[ constructedAttempt({ quality:1, aiEvaluation:{ classification:"incorrect", confidence:0.95, evaluatedAt:"2026-01-01T00:00:00.000Z" } }) ] },
      c5: { retrievalAttempts:[ constructedAttempt({ quality:3 }) ] } // sem aiEvaluation — não deve entrar
    };
    const concepts = [{ id:"c1", tag:"Biologia" }, { id:"c2", tag:"Física" }, { id:"c3", tag:"Biologia" }, { id:"c4", tag:"História" }, { id:"c5", tag:"Biologia" }];

    it("monta um registro por attempt com aiEvaluation, ignorando o que não tem", () => {
      const records = engine.collectAiAgreementRecords(cards, concepts);
      expect(records).toHaveLength(4);
      expect(records.map(r => r.conceptId).sort()).toEqual(["c1", "c2", "c3", "c4"]);
    });

    it("matriz 3x3 conta userClass x aiClass corretamente", () => {
      const records = engine.collectAiAgreementRecords(cards, concepts);
      const matrix = engine.buildAgreementConfusionMatrix(records);
      expect(matrix.correct.correct).toBe(1); // c1
      expect(matrix.partial.correct).toBe(1); // c2 — IA mais generosa
      expect(matrix.correct.partial).toBe(1); // c3 — IA mais rígida
      expect(matrix.incorrect.incorrect).toBe(1); // c4
      expect(matrix.correct.incorrect).toBe(0);
      expect(matrix.incorrect.correct).toBe(0);
    });
  });

  describe("computeAiAgreementStats — agreement/disagreement, generosidade/rigidez, confidence", () => {
    const records = [
      { conceptId:"c1", domain:"Biologia", userClass:"correct", aiClass:"correct", confidence:0.9 },
      { conceptId:"c2", domain:"Física", userClass:"partial", aiClass:"partial", confidence:0.6 },
      { conceptId:"c3", domain:"Biologia", userClass:"partial", aiClass:"correct", confidence:0.8 }, // generosa
      { conceptId:"c4", domain:"História", userClass:"correct", aiClass:"partial", confidence:0.7 }, // rígida
      { conceptId:"c5", domain:"Física", userClass:"incorrect", aiClass:"partial", confidence:0.5 } // generosa
    ];
    let stats;
    beforeEach(() => { stats = engine.computeAiAgreementStats(records); });

    it("agreement_rate e disagreement_rate somam 1 e refletem a matriz", () => {
      expect(stats.total).toBe(5);
      expect(stats.agreementRate).toBeCloseTo(2 / 5, 10);
      expect(stats.disagreementRate).toBeCloseTo(3 / 5, 10);
      expect(stats.agreementRate + stats.disagreementRate).toBeCloseTo(1, 10);
    });

    it("ai_more_generous_rate conta IA classificando ACIMA do usuário", () => {
      expect(stats.aiMoreGenerousRate).toBeCloseTo(2 / 5, 10); // c3, c5
    });

    it("ai_more_strict_rate conta IA classificando ABAIXO do usuário", () => {
      expect(stats.aiMoreStrictRate).toBeCloseTo(1 / 5, 10); // c4
    });

    it("confidence média por categoria (acordo/discordância/generosa/rígida)", () => {
      expect(stats.avgConfidenceAgreement).toBeCloseTo((0.9 + 0.6) / 2, 10);
      expect(stats.avgConfidenceDisagreement).toBeCloseTo((0.8 + 0.7 + 0.5) / 3, 10);
      expect(stats.avgConfidenceAiMoreGenerous).toBeCloseTo((0.8 + 0.5) / 2, 10);
      expect(stats.avgConfidenceAiMoreStrict).toBe(0.7);
    });

    it("lista vazia não lança e retorna rates/médias null, não NaN", () => {
      const empty = engine.computeAiAgreementStats([]);
      expect(empty.total).toBe(0);
      expect(empty.agreementRate).toBeNull();
      expect(empty.avgConfidenceAgreement).toBeNull();
      expect(Number.isNaN(empty.agreementRate)).toBe(false);
    });
  });

  describe("computeAiEvaluationCoverage — tentativas com e sem aiEvaluation", () => {
    it("conta o total de tentativas construídas e quantas têm aiEvaluation", () => {
      const cards = {
        c1: { retrievalAttempts:[ constructedAttempt({ aiEvaluation:{ classification:"correct", confidence:0.9 } }) ] },
        c2: { retrievalAttempts:[ constructedAttempt({}), constructedAttempt({ aiEvaluation:{ classification:"partial", confidence:0.7 } }) ] },
        c3: { retrievalAttempts:[ { source:"quiz", quality:5 } ] } // não é constructed_response — não conta
      };
      const coverage = engine.computeAiEvaluationCoverage(cards);
      expect(coverage.totalConstructedAttempts).toBe(3);
      expect(coverage.attemptsWithAiEvaluation).toBe(2);
      expect(coverage.aiEvaluationCoverageRate).toBeCloseTo(2 / 3, 10);
    });

    it("retorna coverageRate null quando não há nenhuma tentativa construída", () => {
      const coverage = engine.computeAiEvaluationCoverage({});
      expect(coverage.totalConstructedAttempts).toBe(0);
      expect(coverage.aiEvaluationCoverageRate).toBeNull();
    });
  });

  describe("aggregateAiAgreementByDomain — reaproveita computeAiAgreementStats, não reimplementa", () => {
    it("agrupa por domínio e calcula n/agreementRate/aiMoreGenerousRate/aiMoreStrictRate por grupo", () => {
      const records = [
        { userClass:"correct", aiClass:"correct", confidence:0.9, domain:"Biologia" },
        { userClass:"partial", aiClass:"correct", confidence:0.8, domain:"Biologia" }, // generosa
        { userClass:"correct", aiClass:"partial", confidence:0.7, domain:"Física" } // rígida
      ];
      const byDomain = engine.aggregateAiAgreementByDomain(records, 10);
      expect(byDomain["Biologia"]).toMatchObject({ n:2, agreementRate:0.5, aiMoreGenerousRate:0.5, aiMoreStrictRate:0 });
      expect(byDomain["Física"]).toMatchObject({ n:1, agreementRate:0, aiMoreStrictRate:1 });
    });

    it("marca insufficientSample quando n < minSampleSize (default 10)", () => {
      const records = [{ userClass:"correct", aiClass:"correct", confidence:0.9, domain:"Química" }];
      const byDomain = engine.aggregateAiAgreementByDomain(records);
      expect(byDomain["Química"].n).toBe(1);
      expect(byDomain["Química"].insufficientSample).toBe(true);
    });

    it("não marca insufficientSample quando n >= minSampleSize", () => {
      const records = Array.from({ length: 10 }, () => ({ userClass:"correct", aiClass:"correct", confidence:0.9, domain:"História" }));
      const byDomain = engine.aggregateAiAgreementByDomain(records, 10);
      expect(byDomain["História"].n).toBe(10);
      expect(byDomain["História"].insufficientSample).toBe(false);
    });

    it("registros sem domain caem em '(sem domínio)', sem lançar", () => {
      const records = [{ userClass:"correct", aiClass:"correct", confidence:0.9, domain:null }];
      const byDomain = engine.aggregateAiAgreementByDomain(records);
      expect(byDomain["(sem domínio)"].n).toBe(1);
    });

    it("lista vazia retorna objeto vazio", () => {
      expect(engine.aggregateAiAgreementByDomain([])).toEqual({});
    });
  });

  describe("findAiAgreementDivergences", () => {
    it("retorna só os registros em que userClass !== aiClass", () => {
      const records = [
        { userClass:"correct", aiClass:"correct", confidence:0.9 },
        { userClass:"partial", aiClass:"incorrect", confidence:0.7 },
        { userClass:"incorrect", aiClass:"correct", confidence:0.95 }
      ];
      const divergences = engine.findAiAgreementDivergences(records);
      expect(divergences).toHaveLength(2);
      expect(divergences.every(r => r.userClass !== r.aiClass)).toBe(true);
    });

    it("lista vazia para acordo total", () => {
      const records = [{ userClass:"partial", aiClass:"partial", confidence:0.8 }];
      expect(engine.findAiAgreementDivergences(records)).toEqual([]);
    });
  });

  describe("findCriticalAiAgreementCombinations — destaque para user_incorrect->ai_correct", () => {
    it("separa corretamente as 3 combinações críticas", () => {
      const records = [
        { conceptId:"a", userClass:"incorrect", aiClass:"correct", confidence:0.9 }, // a mais grave
        { conceptId:"b", userClass:"partial", aiClass:"correct", confidence:0.8 },
        { conceptId:"c", userClass:"correct", aiClass:"incorrect", confidence:0.7 },
        { conceptId:"d", userClass:"partial", aiClass:"incorrect", confidence:0.6 }, // não é nenhuma das 3
        { conceptId:"e", userClass:"correct", aiClass:"correct", confidence:0.9 } // acordo, fora de todas
      ];
      const critical = engine.findCriticalAiAgreementCombinations(records);
      expect(critical.userIncorrectAiCorrect.map(r => r.conceptId)).toEqual(["a"]);
      expect(critical.userPartialAiCorrect.map(r => r.conceptId)).toEqual(["b"]);
      expect(critical.userCorrectAiIncorrect.map(r => r.conceptId)).toEqual(["c"]);
    });

    it("listas vazias quando não há nenhuma dessas combinações", () => {
      const records = [{ userClass:"correct", aiClass:"correct", confidence:0.9 }];
      const critical = engine.findCriticalAiAgreementCombinations(records);
      expect(critical.userIncorrectAiCorrect).toEqual([]);
      expect(critical.userPartialAiCorrect).toEqual([]);
      expect(critical.userCorrectAiIncorrect).toEqual([]);
    });
  });

  describe("getAiEvaluationSessionStats", () => {
    it("começa em zero (contadores de sessão, não persistidos)", () => {
      const stats = engine.getAiEvaluationSessionStats();
      expect(stats).toEqual({ successes:0, failures:0 });
    });
  });

  describe("ausência de influência sobre FSRS/evidência/calibração", () => {
    it("nenhuma das funções de concordância lê nem grava strongRetrievalPassedAt, retrievalPassedAt, evidenceStrength, stability ou calibrationStatus", () => {
      const card = Object.assign(engine.defaultCardState(), {
        seen:true, stability:10, difficulty:5, interval:10, lastReviewDate:engine.addDays(engine.todayStr(), -3)
      });
      const session = engine.createConstructedAttemptSession("c1", 1000);
      engine.setConstructedConfidence(session, 3);
      engine.submitConstructedResponse(session, "Resposta suficientemente longa para o mínimo técnico", 2500);
      engine.revealConstructedResponse(session);
      const attempt = engine.recordConstructedResponseAttempt(card, session, "correct");
      engine.attachAiEvaluationToAttempt(attempt, { classification:"partial", confidence:0.6, reason:"discordo", model:"m" });

      const snapshot = {
        strongRetrievalPassedAt: card.strongRetrievalPassedAt,
        retrievalPassedAt: card.retrievalPassedAt,
        evidenceStrength: card.retrievalEvidenceStrength,
        stability: card.stability,
        calibrationStatus: card.calibrationStatus
      };

      // Chama toda a cadeia de funções de concordância sobre esse mesmo card —
      // só leitura, nunca deveria alterar nada do snapshot acima.
      const records = engine.collectAiAgreementRecords({ c1:card }, [{ id:"c1", tag:"Metacognição" }]);
      engine.computeAiAgreementStats(records);
      engine.computeAiEvaluationCoverage({ c1:card });
      engine.buildAgreementConfusionMatrix(records);
      engine.getAiEvaluationSessionStats();

      expect(card.strongRetrievalPassedAt).toBe(snapshot.strongRetrievalPassedAt);
      expect(card.retrievalPassedAt).toBe(snapshot.retrievalPassedAt);
      expect(card.retrievalEvidenceStrength).toBe(snapshot.evidenceStrength);
      expect(card.stability).toBe(snapshot.stability);
      expect(card.calibrationStatus).toBe(snapshot.calibrationStatus);
      // strong evidence continua vindo só da autoavaliação (quality 4 = "correct"),
      // mesmo com a IA discordando logo acima.
      expect(card.strongRetrievalPassedAt).not.toBeNull();
      expect(card.retrievalEvidenceStrength).toBe("strong");
    });
  });
});

describe("Explicar — histórico por tentativa (Prioridade 3, correção crítica)", () => {
  // applyExplanationEvaluation chama touchStreak()/addXP(), que leem/escrevem
  // STATE — precisa existir (mesmo padrão do describe("touchStreak") acima).
  beforeEach(() => {
    engine.STATE = { lastStudyDate:null, streak:0, xp:0, badges:[] };
  });

  function concept(){ return engine.CONCEPTS[0]; }
  function longEnoughText(suffix = ""){ return `Uma explicação com pelo menos trinta caracteres para passar na validação${suffix}.`; }

  function mockFetchOk(payload){
    engine.authedFetch = vi.fn().mockResolvedValue({ ok:true, status:200, json: async () => payload });
  }
  function mockFetchQuotaExceeded(){
    engine.authedFetch = vi.fn().mockResolvedValue({ ok:false, status:429, json: async () => ({ error:"Limite mensal atingido." }) });
  }
  function mockFetchHttpError(status = 500){
    engine.authedFetch = vi.fn().mockResolvedValue({ ok:false, status, json: async () => ({ error:"erro" }) });
  }
  function mockFetchThrows(err){
    engine.authedFetch = vi.fn().mockRejectedValue(err || Object.assign(new Error("timeout"), { name:"AbortError" }));
  }

  describe("1. tentativa persistida antes da chamada de IA", () => {
    it("createExplainAttempt grava o attempt em explainAttempts sem fazer nenhuma chamada de rede", () => {
      const cardState = engine.defaultCardState();
      expect(cardState.explainAttempts).toEqual([]);
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      expect(cardState.explainAttempts).toHaveLength(1);
      expect(cardState.explainAttempts[0].id).toBe(attempt.id);
      expect(attempt.status).toBe("pending_evaluation");
    });

    it("rejeita texto abaixo do mínimo e não persiste nada", () => {
      const cardState = engine.defaultCardState();
      expect(() => engine.createExplainAttempt(cardState, "curto demais")).toThrow(/ao menos/);
      expect(cardState.explainAttempts).toEqual([]);
    });
  });

  describe("2. tentativa mantém responseText", () => {
    it("o texto exato escrito pelo aluno é preservado no attempt", () => {
      const cardState = engine.defaultCardState();
      const text = longEnoughText(" — com um detalhe bem específico");
      const attempt = engine.createExplainAttempt(cardState, text);
      expect(attempt.responseText).toBe(text);
      expect(cardState.explainAttempts[0].responseText).toBe(text);
    });

    it("falha de IA (quota/timeout/http) nunca apaga responseText", async () => {
      const cardState = engine.defaultCardState();
      const text = longEnoughText();
      const attempt = engine.createExplainAttempt(cardState, text);
      mockFetchQuotaExceeded();
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.responseText).toBe(text);
      mockFetchThrows();
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.responseText).toBe(text);
    });
  });

  describe("3. avaliação bem-sucedida atualiza a mesma tentativa", () => {
    it("status vira 'evaluated' e evaluation é anexada ao MESMO attempt (mesmo id)", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      const originalId = attempt.id;
      mockFetchOk({ nota:85, mecanismoNoTexto:"o mecanismo", mecanismoCentral:"central", qualidadeSM2:4, equivocos:[], pontosCobertos:["x"], pontosFaltando:[], imprecisoes:[], feedback:"bom" });
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.id).toBe(originalId);
      expect(attempt.status).toBe("evaluated");
      expect(attempt.evaluation.score).toBe(85);
      expect(attempt.evaluatedAt).not.toBeNull();
      expect(cardState.explainAttempts).toHaveLength(1); // não criou um segundo attempt
    });
  });

  describe("4. quota esgotada mantém tentativa pendente", () => {
    it("HTTP 429 mantém status pending_evaluation, nunca vira evaluation_failed", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchQuotaExceeded();
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.status).toBe("pending_evaluation");
      expect(attempt.evaluation).toBeNull();
    });
  });

  describe("5. timeout mantém tentativa", () => {
    it("erro de rede/timeout preserva o attempt com status evaluation_failed", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchThrows();
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.status).toBe("evaluation_failed");
      expect(cardState.explainAttempts).toHaveLength(1);
    });

    it("erro HTTP do provedor (500) também vira evaluation_failed", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchHttpError(500);
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.status).toBe("evaluation_failed");
    });
  });

  describe("6. falha do provedor não altera FSRS", () => {
    it("nem quota esgotada nem falha técnica tocam stability/lastReviewDate/lastExplainScore", async () => {
      const cardState = Object.assign(engine.defaultCardState(), { stability:10, difficulty:5, lastReviewDate:"2026-01-01", lastExplainScore:55, explainCount:2 });
      const snapshot = { stability:cardState.stability, lastReviewDate:cardState.lastReviewDate, lastExplainScore:cardState.lastExplainScore, explainCount:cardState.explainCount };
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());

      mockFetchQuotaExceeded();
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(cardState.stability).toBe(snapshot.stability);
      expect(cardState.lastReviewDate).toBe(snapshot.lastReviewDate);
      expect(cardState.lastExplainScore).toBe(snapshot.lastExplainScore);
      expect(cardState.explainCount).toBe(snapshot.explainCount);

      mockFetchThrows();
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(cardState.stability).toBe(snapshot.stability);
      expect(cardState.lastReviewDate).toBe(snapshot.lastReviewDate);
      expect(cardState.lastExplainScore).toBe(snapshot.lastExplainScore);
      expect(cardState.explainCount).toBe(snapshot.explainCount);
    });
  });

  describe("7. pending_evaluation não cria explanationPassedAt", () => {
    it("cota esgotada não marca o conceito como explicado com sucesso", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchQuotaExceeded();
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(cardState.explanationPassedAt).toBeNull();
    });

    it("falha técnica também não marca explanationPassedAt", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchThrows();
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(cardState.explanationPassedAt).toBeNull();
    });
  });

  describe("8. avaliação posterior funciona", () => {
    it("reavaliar um attempt pending_evaluation (depois que a cota volta) o leva a evaluated", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchQuotaExceeded();
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.status).toBe("pending_evaluation");

      mockFetchOk({ nota:75, mecanismoNoTexto:"x", qualidadeSM2:4, equivocos:[], pontosCobertos:[], pontosFaltando:[], imprecisoes:[], feedback:"ok" });
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.status).toBe("evaluated");
      expect(attempt.evaluation.score).toBe(75);
    });

    it("reavaliar um attempt evaluation_failed também funciona", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchThrows();
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.status).toBe("evaluation_failed");

      mockFetchOk({ nota:60, mecanismoNoTexto:"x", qualidadeSM2:3, equivocos:[], pontosCobertos:[], pontosFaltando:[], imprecisoes:[], feedback:"ok" });
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.status).toBe("evaluated");
    });
  });

  describe("9. avaliação posterior não duplica tentativa", () => {
    it("explainAttempts continua com exatamente 1 item após retry bem-sucedido", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchQuotaExceeded();
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      mockFetchOk({ nota:80, mecanismoNoTexto:"x", qualidadeSM2:4, equivocos:[], pontosCobertos:[], pontosFaltando:[], imprecisoes:[], feedback:"ok" });
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(cardState.explainAttempts).toHaveLength(1);
    });
  });

  describe("10. avaliação posterior não aplica FSRS duas vezes (idempotência)", () => {
    it("chamar evaluateExplainAttempt de novo sobre um attempt já evaluated é no-op", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchOk({ nota:80, mecanismoNoTexto:"x", qualidadeSM2:4, equivocos:[], pontosCobertos:[], pontosFaltando:[], imprecisoes:[], feedback:"ok" });
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      const snapshot = { explainCount:cardState.explainCount, lastExplainScore:cardState.lastExplainScore, stability:cardState.stability, xp:engine.STATE?.xp };

      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id); // segunda chamada, mesmo attempt já avaliado
      expect(cardState.explainCount).toBe(snapshot.explainCount); // não incrementou de novo
      expect(cardState.lastExplainScore).toBe(snapshot.lastExplainScore);
      expect(cardState.stability).toBe(snapshot.stability);
      // authedFetch não deveria nem ter sido chamado de novo, já que a função
      // sai cedo ao ver status "evaluated" — confirma que não houve 2ª chamada de IA.
      expect(engine.authedFetch).toHaveBeenCalledTimes(1);
    });

    it("applyExplanationEvaluation chamada diretamente 2x sobre o mesmo attempt não duplica efeitos", () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      const raw = { nota:80, mecanismoNoTexto:"x", qualidadeSM2:4, equivocos:[], pontosCobertos:[], pontosFaltando:[], imprecisoes:[], feedback:"ok" };
      engine.applyExplanationEvaluation(cardState, attempt.id, raw);
      expect(cardState.explainCount).toBe(1);
      engine.applyExplanationEvaluation(cardState, attempt.id, raw);
      expect(cardState.explainCount).toBe(1); // idempotente
    });
  });

  describe("11. compatibilidade com estado antigo", () => {
    it("normalizeCardState inicializa explainAttempts:[] quando ausente, sem migração destrutiva", () => {
      const legacy = { explainCount:3, lastExplainScore:82, explanationPassedAt:"2025-01-01" };
      const normalized = engine.normalizeCardState(legacy);
      expect(normalized.explainAttempts).toEqual([]);
      // campos antigos preservados por compatibilidade — não removidos nesta tarefa
      expect(normalized.explainCount).toBe(3);
      expect(normalized.lastExplainScore).toBe(82);
      expect(normalized.explanationPassedAt).toBe("2025-01-01");
    });

    it("defaultCardState() já vem com explainAttempts:[] em cards novos", () => {
      expect(engine.defaultCardState().explainAttempts).toEqual([]);
    });
  });

  describe("12. histórico limitado (mesmo limite de retrievalAttempts)", () => {
    it("mantém só as 50 tentativas mais recentes", () => {
      const cardState = engine.defaultCardState();
      for(let i=0;i<55;i++){
        engine.createExplainAttempt(cardState, longEnoughText(` número ${i}`));
      }
      expect(cardState.explainAttempts).toHaveLength(50);
      // preserva as mais recentes: a última criada é a última do array
      expect(cardState.explainAttempts[49].responseText).toContain("número 54");
      // a mais antiga preservada é a de índice 5 (0..4 foram descartadas)
      expect(cardState.explainAttempts[0].responseText).toContain("número 5");
    });
  });

  describe("13-19. persistência do schema estruturado da avaliação", () => {
    it("13. mecanismo central (centralMechanism/mechanismInText)", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchOk({ nota:90, mecanismoCentral:"revisar perto de esquecer reforça a memória", mecanismoNoTexto:"revisar perto de esquecer", qualidadeSM2:5, equivocos:[], pontosCobertos:[], pontosFaltando:[], imprecisoes:[], feedback:"ok" });
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.evaluation.centralMechanism).toBe("revisar perto de esquecer reforça a memória");
      expect(attempt.evaluation.mechanismInText).toBe("revisar perto de esquecer");
    });

    it("14. omissões (missingPoints)", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchOk({ nota:50, mecanismoNoTexto:"x", qualidadeSM2:3, equivocos:[], pontosCobertos:[], pontosFaltando:["não menciona o papel do sono"], imprecisoes:[], feedback:"ok" });
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.evaluation.missingPoints).toEqual(["não menciona o papel do sono"]);
    });

    it("15. erros conceituais (conceptualErrors)", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchOk({ nota:30, mecanismoNoTexto:"x", qualidadeSM2:1, equivocos:["inverte causa e efeito"], pontosCobertos:[], pontosFaltando:[], imprecisoes:[], feedback:"ok" });
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.evaluation.conceptualErrors).toEqual(["inverte causa e efeito"]);
    });

    it("16. imprecisões (imprecisions) — distintas de erros conceituais", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchOk({ nota:65, mecanismoNoTexto:"x", qualidadeSM2:3, equivocos:[], pontosCobertos:[], pontosFaltando:[], imprecisoes:["usa 'memória' de forma vaga"], feedback:"ok" });
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.evaluation.imprecisions).toEqual(["usa 'memória' de forma vaga"]);
      expect(attempt.evaluation.conceptualErrors).toEqual([]);
    });

    it("17. pontos corretos (coveredPoints)", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchOk({ nota:70, mecanismoNoTexto:"x", qualidadeSM2:4, equivocos:[], pontosCobertos:["menciona sessões espaçadas"], pontosFaltando:[], imprecisoes:[], feedback:"ok" });
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.evaluation.coveredPoints).toEqual(["menciona sessões espaçadas"]);
    });

    it("18. nota (score)", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      mockFetchOk({ nota:77, mecanismoNoTexto:"x", qualidadeSM2:4, equivocos:[], pontosCobertos:[], pontosFaltando:[], imprecisoes:[], feedback:"ok" });
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.evaluation.score).toBe(77);
      expect(cardState.lastExplainScore).toBe(77);
    });

    it("19. decisão pedagógica (pedagogicalDecision)", async () => {
      const cardState = engine.defaultCardState();
      const passedAttempt = engine.createExplainAttempt(cardState, longEnoughText(" aprovado"));
      mockFetchOk({ nota:85, mecanismoNoTexto:"x", qualidadeSM2:4, equivocos:[], pontosCobertos:[], pontosFaltando:[], imprecisoes:[], feedback:"ok" });
      await engine.evaluateExplainAttempt(concept(), cardState, passedAttempt.id);
      expect(passedAttempt.evaluation.pedagogicalDecision).toBe("passed");

      const cardState2 = engine.defaultCardState();
      const returnAttempt = engine.createExplainAttempt(cardState2, longEnoughText(" com erro"));
      mockFetchOk({ nota:30, mecanismoNoTexto:"x", qualidadeSM2:1, equivocos:["erro claro"], pontosCobertos:[], pontosFaltando:[], imprecisoes:[], feedback:"ok" });
      await engine.evaluateExplainAttempt(concept(), cardState2, returnAttempt.id);
      expect(returnAttempt.evaluation.pedagogicalDecision).toBe("return_to_comprehension");

      // attempt ainda não avaliado: decisão "vista de fora" é pending_evaluation (derivada, sem duplicar dado)
      const cardState3 = engine.defaultCardState();
      const pendingAttempt = engine.createExplainAttempt(cardState3, longEnoughText(" pendente"));
      expect(engine.deriveExplainAttemptDecision(pendingAttempt)).toBe("pending_evaluation");
    });
  });

  describe("20. referência continua oculta antes da resposta", () => {
    it("o attempt persistido nunca contém o texto de referência do conceito, só a resposta do aluno", () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      const serialized = JSON.stringify(attempt);
      expect(serialized).not.toContain(concept().text);
      expect(Object.keys(attempt).sort()).toEqual(["at", "attemptNumber", "evaluatedAt", "evaluation", "followUp", "id", "previousAttemptId", "responseText", "status"]);
    });

    it("createExplainAttempt não recebe nem precisa do concept/referenceText — só cardState e o texto do aluno", () => {
      // Assinatura da função por si só é a garantia: não há como vazar a
      // referência para dentro do attempt nesta etapa do fluxo.
      expect(engine.createExplainAttempt.length).toBe(2);
    });
  });
});

describe("Explicar — nova tentativa estruturada + pergunta de aprofundamento (Prioridade 3, fechamento)", () => {
  beforeEach(() => {
    engine.STATE = { lastStudyDate:null, streak:0, xp:0, badges:[] };
  });

  function concept(){ return engine.CONCEPTS[0]; }
  function longEnoughText(suffix = ""){ return `Uma explicação com pelo menos trinta caracteres para passar na validação${suffix}.`; }

  function mockFetchOk(payload){
    engine.authedFetch = vi.fn().mockResolvedValue({ ok:true, status:200, json: async () => payload });
  }
  function evaluatedPayload(overrides = {}){
    return Object.assign({
      nota:80, mecanismoNoTexto:"x", mecanismoCentral:"y", qualidadeSM2:4,
      equivocos:[], pontosCobertos:[], pontosFaltando:[], imprecisoes:[],
      feedback:"ok", perguntaAprofundamento:"Por que isso acontece de forma gradual e não de uma vez só?"
    }, overrides);
  }

  async function makeEvaluatedAttempt(cardState, payload){
    const attempt = engine.createExplainAttempt(cardState, longEnoughText());
    mockFetchOk(payload || evaluatedPayload());
    await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
    return attempt;
  }

  describe("1-3. nova tentativa oferecida independentemente da decisão pedagógica", () => {
    it("1. retry_recommended: nova tentativa cria um attempt ligado ao anterior", async () => {
      const cardState = engine.defaultCardState();
      const attempt1 = await makeEvaluatedAttempt(cardState, evaluatedPayload({ nota:50, equivocos:[] })); // retry_recommended
      expect(attempt1.evaluation.pedagogicalDecision).toBe("retry_recommended");

      const attempt2 = engine.createExplainAttempt(cardState, longEnoughText(" — segunda tentativa"));
      expect(attempt2.previousAttemptId).toBe(attempt1.id);
      expect(attempt2.attemptNumber).toBe(2);
      expect(cardState.explainAttempts).toHaveLength(2);
    });

    it("2. return_to_comprehension: nova tentativa cria um attempt ligado ao anterior", async () => {
      const cardState = engine.defaultCardState();
      const attempt1 = await makeEvaluatedAttempt(cardState, evaluatedPayload({ nota:30, equivocos:["erro claro"] })); // return_to_comprehension
      expect(attempt1.evaluation.pedagogicalDecision).toBe("return_to_comprehension");

      const attempt2 = engine.createExplainAttempt(cardState, longEnoughText(" — segunda tentativa"));
      expect(attempt2.previousAttemptId).toBe(attempt1.id);
      expect(attempt2.attemptNumber).toBe(2);
    });

    it("3. passed: nova tentativa opcional continua possível, não é bloqueada", async () => {
      const cardState = engine.defaultCardState();
      const attempt1 = await makeEvaluatedAttempt(cardState, evaluatedPayload({ nota:90 })); // passed
      expect(attempt1.evaluation.pedagogicalDecision).toBe("passed");

      expect(() => engine.createExplainAttempt(cardState, longEnoughText(" — quero tentar de novo mesmo aprovado"))).not.toThrow();
      expect(cardState.explainAttempts).toHaveLength(2);
    });
  });

  it("4. nova tentativa cria um novo attempt (não reaproveita/edita o anterior)", async () => {
    const cardState = engine.defaultCardState();
    const attempt1 = await makeEvaluatedAttempt(cardState);
    const attempt2 = engine.createExplainAttempt(cardState, longEnoughText(" v2"));
    expect(attempt2.id).not.toBe(attempt1.id);
    expect(cardState.explainAttempts.map(a => a.id)).toEqual([attempt1.id, attempt2.id]);
  });

  it("5. tentativa anterior permanece intacta depois de uma nova tentativa (e de avaliá-la)", async () => {
    const cardState = engine.defaultCardState();
    const attempt1 = await makeEvaluatedAttempt(cardState, evaluatedPayload({ nota:55 }));
    const snapshot = JSON.stringify(attempt1);

    const attempt2 = engine.createExplainAttempt(cardState, longEnoughText(" v2"));
    mockFetchOk(evaluatedPayload({ nota:88 }));
    await engine.evaluateExplainAttempt(concept(), cardState, attempt2.id);

    expect(JSON.stringify(attempt1)).toBe(snapshot);
    expect(cardState.explainAttempts[0]).toBe(attempt1);
  });

  it("6. vínculo entre tentativas reconstrói a cadeia 1 -> 2 -> 3", async () => {
    const cardState = engine.defaultCardState();
    const attempt1 = await makeEvaluatedAttempt(cardState, evaluatedPayload({ nota:40 }));
    const attempt2 = await makeEvaluatedAttempt(cardState, evaluatedPayload({ nota:60 }));
    const attempt3 = await makeEvaluatedAttempt(cardState, evaluatedPayload({ nota:90 }));

    expect(attempt1.previousAttemptId).toBeNull();
    expect(attempt1.attemptNumber).toBe(1);
    expect(attempt2.previousAttemptId).toBe(attempt1.id);
    expect(attempt2.attemptNumber).toBe(2);
    expect(attempt3.previousAttemptId).toBe(attempt2.id);
    expect(attempt3.attemptNumber).toBe(3);

    // Reconstrução da cadeia completa a partir só de explainAttempts[],
    // caminhando do mais antigo (previousAttemptId:null) para o mais novo.
    const chain = [];
    let currentId = cardState.explainAttempts.find(a => a.previousAttemptId === null).id;
    while(currentId){
      chain.push(currentId);
      const next = cardState.explainAttempts.find(a => a.previousAttemptId === currentId);
      currentId = next ? next.id : null;
    }
    expect(chain).toEqual([attempt1.id, attempt2.id, attempt3.id]);
  });

  it("7. referência do conceito continua oculta também em tentativas subsequentes", async () => {
    const cardState = engine.defaultCardState();
    await makeEvaluatedAttempt(cardState);
    const attempt2 = engine.createExplainAttempt(cardState, longEnoughText(" v2"));
    expect(JSON.stringify(attempt2)).not.toContain(concept().text);
  });

  it("8. diagnóstico da tentativa anterior permanece visível (não é apagado ao criar uma nova tentativa)", async () => {
    const cardState = engine.defaultCardState();
    const attempt1 = await makeEvaluatedAttempt(cardState, evaluatedPayload({
      nota:55, pontosCobertos:["ponto A"], pontosFaltando:["ponto B"], imprecisoes:["impreciso C"], equivocos:[]
    }));
    engine.createExplainAttempt(cardState, longEnoughText(" v2"));

    // Mesmo depois de existir uma 2ª tentativa, o diagnóstico da 1ª continua
    // acessível e completo — nunca é substituído por uma "explicação-modelo".
    expect(attempt1.evaluation.coveredPoints).toEqual(["ponto A"]);
    expect(attempt1.evaluation.missingPoints).toEqual(["ponto B"]);
    expect(attempt1.evaluation.imprecisions).toEqual(["impreciso C"]);
    expect(attempt1.evaluation.feedback).toBe("ok");
  });

  describe("9-12. follow-up (perguntaAprofundamento)", () => {
    it("9. avaliação bem-sucedida sempre inclui followUpQuestion", async () => {
      const cardState = engine.defaultCardState();
      const attempt = await makeEvaluatedAttempt(cardState);
      expect(typeof attempt.evaluation.followUpQuestion).toBe("string");
      expect(attempt.evaluation.followUpQuestion.length).toBeGreaterThan(0);
    });

    it("10. attempt pending_evaluation não tem follow-up disponível", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      engine.authedFetch = vi.fn().mockResolvedValue({ ok:false, status:429, json: async () => ({ error:"cota" }) });
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.status).toBe("pending_evaluation");
      expect(attempt.evaluation).toBeNull();
      expect(() => engine.recordExplainFollowUpResponse(cardState, attempt.id, "minha resposta")).toThrow();
    });

    it("11. attempt evaluation_failed não tem follow-up disponível", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      engine.authedFetch = vi.fn().mockRejectedValue(Object.assign(new Error("timeout"), { name:"AbortError" }));
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.status).toBe("evaluation_failed");
      expect(() => engine.recordExplainFollowUpResponse(cardState, attempt.id, "minha resposta")).toThrow();
    });

    it("12. reavaliação de um attempt pendente gera follow-up normalmente", async () => {
      const cardState = engine.defaultCardState();
      const attempt = engine.createExplainAttempt(cardState, longEnoughText());
      engine.authedFetch = vi.fn().mockResolvedValue({ ok:false, status:429, json: async () => ({ error:"cota" }) });
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.evaluation).toBeNull();

      mockFetchOk(evaluatedPayload());
      await engine.evaluateExplainAttempt(concept(), cardState, attempt.id);
      expect(attempt.status).toBe("evaluated");
      expect(attempt.evaluation.followUpQuestion.length).toBeGreaterThan(0);
    });
  });

  describe("13-16. resposta ao follow-up: persistência, FSRS, evidência, idempotência", () => {
    it("13. resposta ao follow-up é persistida no mesmo attempt", async () => {
      const cardState = engine.defaultCardState();
      const attempt = await makeEvaluatedAttempt(cardState);
      const followUp = engine.recordExplainFollowUpResponse(cardState, attempt.id, "Porque a memória precisa de tempo para consolidar entre as sessões.");
      expect(followUp.question).toBe(attempt.evaluation.followUpQuestion);
      expect(followUp.responseText).toBe("Porque a memória precisa de tempo para consolidar entre as sessões.");
      expect(followUp.answeredAt).not.toBeNull();
      expect(attempt.followUp).toBe(followUp);
    });

    it("14. resposta ao follow-up não altera FSRS/contadores de explicação", async () => {
      const cardState = Object.assign(engine.defaultCardState(), { stability:10, difficulty:5, lastReviewDate:"2026-01-01" });
      const attempt = await makeEvaluatedAttempt(cardState);
      const snapshot = { stability:cardState.stability, lastReviewDate:cardState.lastReviewDate, explainCount:cardState.explainCount, lastExplainScore:cardState.lastExplainScore };

      engine.recordExplainFollowUpResponse(cardState, attempt.id, "Minha resposta de aprofundamento.");

      expect(cardState.stability).toBe(snapshot.stability);
      expect(cardState.lastReviewDate).toBe(snapshot.lastReviewDate);
      expect(cardState.explainCount).toBe(snapshot.explainCount);
      expect(cardState.lastExplainScore).toBe(snapshot.lastExplainScore);
    });

    it("15. resposta ao follow-up não altera evidência de recuperação nem calibração", async () => {
      const cardState = engine.defaultCardState();
      const attempt = await makeEvaluatedAttempt(cardState);
      const snapshot = {
        retrievalPassedAt: cardState.retrievalPassedAt,
        strongRetrievalPassedAt: cardState.strongRetrievalPassedAt,
        retrievalEvidenceStrength: cardState.retrievalEvidenceStrength,
        calibrationStatus: cardState.calibrationStatus
      };

      engine.recordExplainFollowUpResponse(cardState, attempt.id, "Minha resposta de aprofundamento.");

      expect(cardState.retrievalPassedAt).toBe(snapshot.retrievalPassedAt);
      expect(cardState.strongRetrievalPassedAt).toBe(snapshot.strongRetrievalPassedAt);
      expect(cardState.retrievalEvidenceStrength).toBe(snapshot.retrievalEvidenceStrength);
      expect(cardState.calibrationStatus).toBe(snapshot.calibrationStatus);
    });

    it("16. reenviar (ex.: reload/duplo clique) não sobrescreve a resposta já dada — idempotente", async () => {
      const cardState = engine.defaultCardState();
      const attempt = await makeEvaluatedAttempt(cardState);
      const first = engine.recordExplainFollowUpResponse(cardState, attempt.id, "Primeira resposta.");
      const second = engine.recordExplainFollowUpResponse(cardState, attempt.id, "Segunda resposta, tentando sobrescrever.");
      expect(second).toBe(first);
      expect(attempt.followUp.responseText).toBe("Primeira resposta.");
    });
  });

  it("17. reavaliar o mesmo attempt (idempotência de avaliação) não cria um attempt extra mesmo com os novos campos de vínculo", async () => {
    const cardState = engine.defaultCardState();
    const attempt = await makeEvaluatedAttempt(cardState);
    await engine.evaluateExplainAttempt(concept(), cardState, attempt.id); // 2ª chamada, já evaluated
    expect(cardState.explainAttempts).toHaveLength(1);
    expect(cardState.explainAttempts[0].attemptNumber).toBe(1);
  });

  it("18. histórico antigo (attempts sem previousAttemptId/attemptNumber/followUp) continua legível", () => {
    const cardState = engine.defaultCardState();
    cardState.explainAttempts = [{
      id:"legacy-1", at:"2025-06-01T00:00:00.000Z", responseText:"explicação antiga",
      status:"evaluated", evaluatedAt:"2025-06-01T00:00:01.000Z",
      evaluation:{ score:75, centralMechanism:"x", mechanismInText:"y", coveredPoints:[], missingPoints:[], conceptualErrors:[], imprecisions:[], feedback:"ok", quality:4, pedagogicalDecision:"passed" }
      // sem previousAttemptId, attemptNumber, followUp — formato anterior a esta etapa
    }];
    expect(() => engine.findExplainAttempt(cardState, "legacy-1")).not.toThrow();
    const legacy = engine.findExplainAttempt(cardState, "legacy-1");
    expect(legacy.responseText).toBe("explicação antiga");
    // uma nova tentativa a partir daqui liga normalmente ao registro antigo
    const next = engine.createExplainAttempt(cardState, longEnoughText());
    expect(next.previousAttemptId).toBe("legacy-1");
    expect(next.attemptNumber).toBe(2);
  });

  it("19. limite de 50 tentativas continua respeitado com os novos campos", async () => {
    const cardState = engine.defaultCardState();
    for(let i=0;i<55;i++){
      engine.createExplainAttempt(cardState, longEnoughText(` número ${i}`));
    }
    expect(cardState.explainAttempts).toHaveLength(50);
    expect(cardState.explainAttempts[49].attemptNumber).toBe(55);
    expect(cardState.explainAttempts[49].previousAttemptId).toBe(cardState.explainAttempts[48].id);
  });
});

describe("intercalação da fila de revisão", () => {
  it("alterna tags diferentes quando possível", () => {
    const items = [
      {id:"a1",tag:"A"},{id:"a2",tag:"A"},{id:"b1",tag:"B"},{id:"b2",tag:"B"}
    ];
    const result = engine.interleaveConceptsByTag(items);
    for(let i=1;i<result.length;i++) expect(result[i].tag).not.toBe(result[i-1].tag);
  });

  it("uma única tag não causa erro nem perde itens", () => {
    const items = [{id:"a1",tag:"A"},{id:"a2",tag:"A"}];
    expect(engine.interleaveConceptsByTag(items).map(x=>x.id)).toEqual(["a1","a2"]);
  });

  it("preserva prioridade de vencimento antes da diversidade", () => {
    const items = [{id:"newA",tag:"A"},{id:"oldA",tag:"A"},{id:"oldB",tag:"B"}];
    const cards = {
      newA:{nextReview:"2026-08-10"}, oldA:{nextReview:"2026-08-01"}, oldB:{nextReview:"2026-08-01"}
    };
    const result = engine.orderReviewQueue(items, cards);
    expect(result.slice(0,2).map(x=>x.id)).toEqual(["oldA","oldB"]);
    expect(result[2].id).toBe("newA");
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
    engine.recordExplanationOutcome(incomplete, 40, { missingPoints:["mecanismo"] });
    expect(incomplete.lastErrorType).toBe("incomplete_explanation");
    const conceptual = engine.defaultCardState();
    engine.recordExplanationOutcome(conceptual, 30, { conceptualErrors:["causa invertida"] });
    expect(conceptual.lastErrorType).toBe("conceptual_error");
  });

  it("não cria erro conceitual sem equívoco explícito", () => {
    const card = engine.defaultCardState();
    engine.recordExplanationOutcome(card, 90, { conceptualErrors:[] });
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
