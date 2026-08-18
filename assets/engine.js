/* =====================================================================
   MOTOR COMPARTILHADO DO APP DE ESTUDO
   =====================================================================
   Este arquivo NÃO contém conteúdo de nenhum tema — apenas a lógica de:
   repetição espaçada (FSRS), gamificação (XP/níveis/streak/badges) e
   renderização das telas (Aprender, Revisar, Quiz, Progresso).

   Conteúdo (CONFIG + CONCEPTS) vem de arquivos JSON em /content e é
   injetado via initApp(config, concepts). Isso permite que o mesmo
   motor sirva qualquer número de módulos/temas sem duplicar código.

   Depende de assets/storage.js (StorageAdapter) já carregado antes deste
   script na página.
   ===================================================================== */

let CONFIG = null;
let CONCEPTS = [];
let STATE = null;
// Etapa 2 — "voltar ao trecho original": id do material da Biblioteca que
// originou este módulo (null pra módulos sem origem em PDF, ex.: fluxo de
// criar-modulo.html/catálogo estático). Cada conceito pode ter "sourcePage"
// (número da página) e "sourceExcerpt" (trecho curto do texto real daquela
// página, extraído em importar-livro.html — nunca escrito pela IA) — juntos
// dão a citação do trecho original e o link pro leitor.
let SOURCE_MATERIAL_ID = null;
// Etapa 3 — "associar anotação a conceitos ou módulos": id deste módulo
// (usado pra achar quais anotações do leitor foram vinculadas a ele) e a
// lista de anotações já filtradas (por app.html) pra este módulo.
let MODULE_ID = null;
let LINKED_NOTES = [];

function sourceLinkHtml(c){
  if(!SOURCE_MATERIAL_ID) return "";
  let html = "";
  if(c.sourceExcerpt){
    html += `<blockquote class="lead" style="font-style:italic; font-size:12px; margin:10px 0 0; padding:6px 10px; border-left:2px solid var(--border); background:rgba(255,255,255,0.03); border-radius:0 8px 8px 0;">"${escapeHtml(c.sourceExcerpt)}"</blockquote>`;
  }
  if(c.sourcePage){
    const url = `leitor.html?material=${encodeURIComponent(SOURCE_MATERIAL_ID)}&page=${encodeURIComponent(c.sourcePage)}`;
    html += `<a class="btn ghost" href="${url}" target="_blank" rel="noopener" style="margin-top:8px; display:inline-block; text-decoration:none; font-size:12.5px;">↩ Ver trecho original (pág. ${c.sourcePage})</a>`;
  }
  return html;
}

// Anotações feitas no leitor de PDF e vinculadas especificamente a este
// conceito (via linkedConceptId). Retorna [] quando não há nenhuma.
function notesForConcept(c){
  if(!LINKED_NOTES || LINKED_NOTES.length === 0) return [];
  return LINKED_NOTES.filter(n => n.linkedConceptId === c.id);
}

function linkedNotesHtml(c){
  const notes = notesForConcept(c);
  if(notes.length === 0) return "";
  const items = notes.map(n => `
    <li style="margin:4px 0;">
      <a href="leitor.html?material=${encodeURIComponent(SOURCE_MATERIAL_ID)}&page=${encodeURIComponent(n.pageNumber)}" target="_blank" rel="noopener" style="text-decoration:none; color:inherit;">
        📝 ${escapeHtml(n.text).slice(0, 140)}
      </a>
    </li>
  `).join("");
  return `
    <div style="margin-top:10px; font-size:12.5px; color:var(--text-dim);">
      <div style="font-weight:600; margin-bottom:2px;">Suas anotações sobre este conceito:</div>
      <ul style="margin:0; padding-left:18px;">${items}</ul>
    </div>
  `;
}

const LEVELS = [
  {min:0, name:"Iniciante"},
  {min:60, name:"Aprendiz"},
  {min:150, name:"Estudante Dedicado(a)"},
  {min:280, name:"Praticante"},
  {min:450, name:"Competente"},
  {min:660, name:"Avançado(a)"},
  {min:900, name:"Especialista"},
  {min:1180, name:"Referência no Tema"},
  {min:1500, name:"Prática Extensa"},
  {min:1900, name:"Prática Contínua"}
];

const BADGES = [
  {id:"first_step", ic:"👣", name:"Primeiros Passos", desc:"Aprenda seu 1º conceito", check: s => Object.values(s.cards).some(c=>c.seen)},
  {id:"all_intro", ic:"🗺️", name:"Trilha Completa", desc:"Apresente todos os conceitos", check: s => Object.values(s.cards).filter(c=>c.seen).length >= CONCEPTS.length},
  {id:"first_review", ic:"🔁", name:"Revisor(a) Dedicado(a)", desc:"Complete 1 sessão de revisão", check: s => s.reviewSessions >= 1},
  {id:"streak3", ic:"🔥", name:"Sequência de 3 dias", desc:"Estude 3 dias seguidos", check: s => s.streak >= 3},
  {id:"streak7", ic:"🌟", name:"Sequência de 7 dias", desc:"Estude 7 dias seguidos", check: s => s.streak >= 7},
  {id:"quiz_perfect", ic:"🎯", name:"Mira Perfeita", desc:"Acerte 100% em um Quiz", check: s => s.quiz.best >= CONCEPTS.length},
  {id:"retained5", ic:"🧱", name:"Retenção Verificada", desc:"Demonstre recuperação e explicação em 5 conceitos", check: s => Object.values(s.cards).filter(hasRetentionEvidence).length >= 5},
  {id:"retained_all", ic:"🏆", name:"Evidências em Todo o Tema", desc:"Demonstre recuperação e explicação em todos os conceitos", check: s => Object.values(s.cards).filter(hasRetentionEvidence).length >= CONCEPTS.length},
  {id:"feynman_first", ic:"🗣️", name:"Primeira Explicação", desc:"Explique 1 conceito no modo Feynman", check: s => Object.values(s.cards).some(c=>c.explainCount>0)},
  {id:"feynman5", ic:"🎤", name:"Explicador(a) Experiente", desc:"Explique 5 conceitos com nota 80+ no modo Feynman", check: s => Object.values(s.cards).filter(c=>c.lastExplainScore!=null && c.lastExplainScore>=80).length >= 5},
  {id:"calibrated10", ic:"🎯", name:"Bem Calibrado(a)", desc:"Acerte sua autoavaliação de confiança 10 vezes", check: s => s.calibration.aligned >= 10}
];

const EXPLANATION_PASS_SCORE = 70;
const EXPLANATION_MIN_LENGTH = 30;
// Estados possíveis de um explainAttempt. "pending_evaluation" cobre tanto
// "ainda não tentamos chamar a IA" quanto "cota esgotada" — nos dois casos
// a explicação já está persistida e pode ser avaliada depois, sem que a
// pessoa precise reescrevê-la (ver createExplainAttempt/evaluateExplainAttempt).
// "evaluation_failed" é reservado para quando a IA FOI chamada e falhou por
// motivo técnico (timeout/rede/HTTP/parse) — semântica escolhida de propósito
// para distinguir "esperando cota" de "algo deu errado tecnicamente", ver
// docs/estado-pedagogico.md. Ambos os estados não-"evaluated" podem ser
// reavaliados por evaluateExplainAttempt.
const EXPLAIN_ATTEMPT_STATUSES = Object.freeze(["pending_evaluation", "evaluated", "evaluation_failed"]);
// Decisões que o SERVIDOR pode devolver (ver api/_lib/explanationEvaluation.js).
// "pending_evaluation" não está aqui: é o valor que a decisão assume quando o
// attempt ainda não foi avaliado (ver deriveExplainAttemptDecision), nunca algo
// que a IA decide.
const EXPLAIN_PEDAGOGICAL_DECISIONS_FROM_API = Object.freeze(["passed", "retry_recommended", "return_to_comprehension"]);
const RETRIEVAL_PASS_QUALITY = 4;
const STATE_SCHEMA_VERSION = 1;
const PEDAGOGY_VERSION = 1;
const HISTORY_LIMIT = 50;
const COMPREHENSION_STATUSES = Object.freeze(["not_assessed", "no_issue_detected", "doubt_reported", "blocked"]);
const CALIBRATION_STATUSES = Object.freeze(["insufficient_data", "calibrated", "overconfident", "underconfident", "mixed"]);
const RETRIEVAL_SOURCES = Object.freeze(["review", "quiz", "constructed_response"]);
const RESPONSE_TYPES = Object.freeze(["multiple_choice", "constructed", "self_rated_review"]);
const EVIDENCE_STRENGTHS = Object.freeze(["none", "weak", "medium", "strong"]);
const CONSTRUCTED_RATINGS = Object.freeze({ failed:1, partial:3, correct:4 });
const MIN_CONSTRUCTED_RESPONSE_LENGTH = 10;
const AI_EVALUATION_CLASSIFICATIONS = Object.freeze(["incorrect", "partial", "correct"]);
const CONTENT_QUALITY_STATUSES = Object.freeze(["ok", "suspected", "reported"]);
const ERROR_TYPES = Object.freeze([
  "retrieval_failure", "conceptual_error", "incomplete_explanation", "misinterpretation",
  "execution_error", "transfer_failure", "prerequisite_gap", "confidence_miscalibration", "content_problem"
]);
const LEGACY_CONTRADICTORY_BADGES = new Set(["mastered5", "mastered_all"]);

function todayStr(){ return new Date().toISOString().slice(0,10); }
function addDays(dateStr, n){
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}
function daysBetween(a,b){
  return Math.round((new Date(b+"T00:00:00") - new Date(a+"T00:00:00")) / 86400000);
}

function elapsedDaysSinceLastReview(cardState, currentDate){
  if(!cardState || !cardState.lastReviewDate) return null;
  return Math.max(0, daysBetween(cardState.lastReviewDate, currentDate || todayStr()));
}

function defaultCardState(){
  return {
    pedagogyVersion:PEDAGOGY_VERSION,
    seen:false, presentedAt:null,
    comprehensionStatus:"not_assessed", comprehensionIssue:null,
    retrievalPassedAt:null, lastRetrievalSource:null, lastRetrievalQuality:null, retrievalAttempts:[],
    retrievalEvidenceStrength:"none", strongRetrievalPassedAt:null, pendingConstructedResponse:null,
    explainCount:0, lastExplainScore:null, explanationPassedAt:null, explainAttempts:[],
    applicationPassedAt:null, applicationLevel:0, applicationAttempts:[],
    lastConfidence:null, calibrationStatus:"insufficient_data",
    lastErrorType:null, errorHistory:[],
    contentQuality:{ status:"ok", reason:null, reportedAt:null },
    stability:null, difficulty:null, lastReviewDate:null, nextReview:null, reps:0,
    ef:2.5, interval:0, lastQuality:null, analogy:null
  };
}

function trimHistory(items){
  return Array.isArray(items) ? items.slice(-HISTORY_LIMIT) : [];
}

function calculateCalibrationStatus(attempts){
  const withConfidence = (attempts || []).filter(a => [1,2,3].includes(a.confidence));
  if(withConfidence.length < 3) return "insufficient_data";
  const counts = { overconfident:0, underconfident:0, calibrated:0 };
  withConfidence.forEach(a=>{
    if(a.confidence === 3 && !a.passed) counts.overconfident += 1;
    else if(a.confidence === 1 && a.passed) counts.underconfident += 1;
    else counts.calibrated += 1;
  });
  const threshold = Math.ceil(withConfidence.length * 0.6);
  const ranked = Object.entries(counts).sort((a,b)=>b[1]-a[1]);
  return ranked[0][1] >= threshold && ranked[0][1] > ranked[1][1] ? ranked[0][0] : "mixed";
}

function normalizeCardState(legacy){
  const normalized = Object.assign(defaultCardState(), legacy || {});
  normalized.pedagogyVersion = PEDAGOGY_VERSION;
  normalized.retrievalAttempts = trimHistory(legacy && legacy.retrievalAttempts);
  // Registros antigos (antes desta etapa) não têm explainAttempts — inicializa
  // como [] sem tentar reconstruir tentativas passadas a partir de
  // explainCount/lastExplainScore (não há dado suficiente pra isso, e não é
  // migração destrutiva: os campos antigos continuam intactos, ver abaixo).
  normalized.explainAttempts = trimHistory(legacy && legacy.explainAttempts);
  normalized.applicationAttempts = trimHistory(legacy && legacy.applicationAttempts);
  normalized.errorHistory = trimHistory(legacy && legacy.errorHistory);
  normalized.contentQuality = Object.assign(defaultCardState().contentQuality, legacy && legacy.contentQuality || {});
  if(!COMPREHENSION_STATUSES.includes(normalized.comprehensionStatus)) normalized.comprehensionStatus = "not_assessed";
  if(!EVIDENCE_STRENGTHS.includes(normalized.retrievalEvidenceStrength)) normalized.retrievalEvidenceStrength = "none";
  if(!CONTENT_QUALITY_STATUSES.includes(normalized.contentQuality.status)) normalized.contentQuality.status = "ok";
  if(!Number.isFinite(normalized.applicationLevel)) normalized.applicationLevel = 0;
  normalized.calibrationStatus = calculateCalibrationStatus(normalized.retrievalAttempts);
  if(!CALIBRATION_STATUSES.includes(normalized.calibrationStatus)) normalized.calibrationStatus = "insufficient_data";
  return normalized;
}

function migrateState(parsed){
  const base = defaultState();
  if(!parsed) return base;
  CONCEPTS.forEach(c=>{
    const legacy = parsed.cards && parsed.cards[c.id];
    if(!legacy) return;
    base.cards[c.id] = normalizeCardState(legacy);
    if(!base.cards[c.id].explanationPassedAt && legacy.lastExplainScore >= EXPLANATION_PASS_SCORE){
      base.cards[c.id].explanationPassedAt = legacy.lastReviewDate || "legacy";
    }
    base.cards[c.id].retrievalPassedAt = legacy.retrievalPassedAt || null;
    base.cards[c.id].applicationPassedAt = legacy.applicationPassedAt || null;
  });
  base.xp = parsed.xp||0;
  base.streak = parsed.streak||0;
  base.lastStudyDate = parsed.lastStudyDate||null;
  base.badges = (parsed.badges||[]).filter(id => !LEGACY_CONTRADICTORY_BADGES.has(id));
  base.reviewSessions = parsed.reviewSessions||0;
  base.quiz = Object.assign({}, base.quiz, parsed.quiz||{});
  base.settings = Object.assign({}, base.settings, parsed.settings||{});
  base.dailyProgress = Object.assign({}, base.dailyProgress, parsed.dailyProgress||{});
  base.calibration = Object.assign({}, base.calibration, parsed.calibration||{});
  base.schemaVersion = STATE_SCHEMA_VERSION;
  return base;
}

function defaultState(){
  const cards = {};
  CONCEPTS.forEach(c => {
    // Campos do FSRS (repetição espaçada) — stability/difficulty ficam null
    // até a primeira revisão. interval/ef são mantidos só por compatibilidade
    // com progresso salvo antes da migração do SM-2 para o FSRS.
    cards[c.id] = defaultCardState();
  });
  return {
    schemaVersion:STATE_SCHEMA_VERSION,
    xp:0, streak:0, lastStudyDate:null, cards, badges:[], reviewSessions:0, quiz:{played:0, best:0, bestAdaptive:0},
    settings: { dailyNewLimit: 5, dailyReviewLimit: 0 }, // dailyReviewLimit 0 = sem limite
    dailyProgress: { date: null, newCount: 0, reviewCount: 0 },
    calibration: { aligned: 0, overconfident: 0, underconfident: 0 }
  };
}

async function loadState(){
  const parsed = await StorageAdapter.load(CONFIG.storageKey);
  return migrateState(parsed);
}

function recordError(cardState, type, source, detail){
  if(!ERROR_TYPES.includes(type)) throw new Error(`Tipo de erro inválido: ${type}`);
  const item = { at:new Date().toISOString(), type, source:source || null, detail:detail || null };
  cardState.lastErrorType = type;
  cardState.errorHistory = trimHistory([...(cardState.errorHistory || []), item]);
  return item;
}

function recordRetrievalEvidence(cardState, passed, source, quality, confidence, intervalDays, details){
  if(!RETRIEVAL_SOURCES.includes(source)) throw new Error(`Fonte de recuperação inválida: ${source}`);
  details = details || {};
  const defaultResponseType = source === "quiz" ? "multiple_choice" : source === "review" ? "self_rated_review" : "constructed";
  const defaultStrength = source === "quiz" ? "weak" : source === "review" ? "medium" : "strong";
  const responseType = details.responseType || defaultResponseType;
  const evidenceStrength = passed ? (details.evidenceStrength || defaultStrength) : "none";
  if(!RESPONSE_TYPES.includes(responseType)) throw new Error(`Tipo de resposta inválido: ${responseType}`);
  if(!EVIDENCE_STRENGTHS.includes(evidenceStrength)) throw new Error(`Força de evidência inválida: ${evidenceStrength}`);
  const attempt = {
    at:new Date().toISOString(), source, passed:Boolean(passed), quality,
    confidence:confidence == null ? null : confidence,
    intervalDays:intervalDays == null ? null : intervalDays,
    responseType, evidenceStrength
  };
  if(responseType === "constructed"){
    attempt.responseText = String(details.responseText || "");
    attempt.latencyMs = Math.max(0, Number(details.latencyMs) || 0);
  }
  cardState.retrievalAttempts = trimHistory([...(cardState.retrievalAttempts || []), attempt]);
  cardState.lastRetrievalSource = source;
  cardState.lastRetrievalQuality = quality;
  if(confidence != null) cardState.lastConfidence = confidence;
  if(passed) cardState.retrievalPassedAt = todayStr();
  const currentStrength = EVIDENCE_STRENGTHS.indexOf(cardState.retrievalEvidenceStrength || "none");
  const nextStrength = EVIDENCE_STRENGTHS.indexOf(evidenceStrength);
  if(nextStrength > currentStrength) cardState.retrievalEvidenceStrength = evidenceStrength;
  if(passed && evidenceStrength === "strong") cardState.strongRetrievalPassedAt = todayStr();
  if(!passed) recordError(cardState, "retrieval_failure", source, null);
  cardState.calibrationStatus = calculateCalibrationStatus(cardState.retrievalAttempts);
  return Boolean(passed);
}

function createConstructedAttemptSession(conceptId, startedAt){
  return { conceptId, startedAt:startedAt == null ? Date.now() : startedAt, confidence:null, responseText:"", submitted:false, revealed:false, latencyMs:null };
}

function setConstructedConfidence(session, confidence){
  if(session.submitted || session.revealed) throw new Error("A confiança não pode ser alterada após o envio.");
  if(![1,2,3].includes(confidence)) throw new Error("Confiança inválida.");
  session.confidence = confidence;
  return session;
}

function submitConstructedResponse(session, responseText, submittedAt){
  if(session.confidence == null) throw new Error("Registre a confiança antes de enviar a resposta.");
  const text = String(responseText || "").trim();
  if(text.length < MIN_CONSTRUCTED_RESPONSE_LENGTH) throw new Error(`A resposta deve ter ao menos ${MIN_CONSTRUCTED_RESPONSE_LENGTH} caracteres.`);
  const now = submittedAt == null ? Date.now() : submittedAt;
  session.responseText = text;
  session.latencyMs = Math.max(0, now - session.startedAt);
  session.submitted = true;
  return session;
}

function revealConstructedResponse(session){
  if(session.confidence == null) throw new Error("A resposta não pode ser revelada sem confiança prévia.");
  if(!session.submitted || !session.responseText) throw new Error("A resposta não pode ser revelada antes do envio.");
  session.revealed = true;
  return true;
}

function constructedPromptData(concept){
  return { conceptId:concept.id, tag:concept.tag, prompt:concept.q || concept.title };
}

function getConstructedReference(session, concept){
  revealConstructedResponse(session);
  return { responseText:session.responseText, referenceText:concept.text };
}

function recordConstructedResponseAttempt(cardState, session, rating){
  if(!session.revealed) throw new Error("Avalie somente depois da tentativa válida e da revelação.");
  if(!Object.prototype.hasOwnProperty.call(CONSTRUCTED_RATINGS, rating)) throw new Error("Avaliação construída inválida.");
  const quality = CONSTRUCTED_RATINGS[rating];
  const passed = rating === "correct";
  const elapsedDays = elapsedDaysSinceLastReview(cardState);
  fsrsUpdate(cardState, quality);
  recordRetrievalEvidence(cardState, passed, "constructed_response", quality, session.confidence, elapsedDays, {
    responseType:"constructed", evidenceStrength:passed ? "strong" : "none",
    responseText:session.responseText, latencyMs:session.latencyMs
  });
  cardState.pendingConstructedResponse = null;
  return cardState.retrievalAttempts[cardState.retrievalAttempts.length - 1];
}

/* ---- Avaliação semântica por IA (Prioridade 3) --------------------
   Camada estritamente adicional sobre a resposta construída: compara
   responseText com a referência do conceito no servidor e anexa o
   resultado ao attempt JÁ registrado por recordConstructedResponseAttempt.
   Nunca roda antes da autoavaliação, nunca reescreve passed/quality/
   evidenceStrength/retrievalPassedAt/strongRetrievalPassedAt, e uma
   falha aqui (rede, timeout, saída inválida) não desfaz nem atrasa nada
   do que já aconteceu — ver requestConstructedAiEvaluation, que chama
   estas funções puras depois de FSRS e persistência já terem ocorrido. */

/**
 * Valida a resposta bruta do endpoint /api/avaliar-resposta-construida
 * contra o schema esperado. Retorna null (nunca lança) para qualquer
 * formato inesperado — validação defensiva no cliente, além da já feita
 * no servidor (api/_lib/constructedEvaluation.js), porque esta função
 * também decide se algo é persistido em retrievalAttempts.
 */
function validateConstructedAiEvaluation(data){
  if(!data || typeof data !== "object") return null;
  if(!AI_EVALUATION_CLASSIFICATIONS.includes(data.classification)) return null;
  const confidence = Number(data.confidence);
  if(!Number.isFinite(confidence)) return null;
  return {
    classification:data.classification,
    confidence:Math.min(1, Math.max(0, confidence)),
    reason: typeof data.reason === "string" ? data.reason.slice(0, 400) : "",
    model: typeof data.model === "string" ? data.model.slice(0, 200) : ""
  };
}

/**
 * Anexa a avaliação semântica a um attempt já registrado, sob a chave
 * `aiEvaluation` (ausente em qualquer registro antigo — compatibilidade
 * total sem migração). Nunca toca em passed/quality/evidenceStrength;
 * essas continuam vindo exclusivamente da autoavaliação do usuário.
 */
function attachAiEvaluationToAttempt(attempt, aiResult){
  if(!attempt || !aiResult) return attempt;
  attempt.aiEvaluation = {
    classification:aiResult.classification,
    confidence:aiResult.confidence,
    reason:aiResult.reason,
    evaluatedAt:new Date().toISOString(),
    model:aiResult.model
  };
  return attempt;
}

/**
 * Dispara a avaliação semântica de forma assíncrona e melhor-esforço,
 * depois que autoavaliação + FSRS + persistência já aconteceram (ver os
 * chamadores em renderConstructedReference). Qualquer falha — quota,
 * rede, timeout, saída inválida — é engolida aqui: o fluxo de revisão
 * já terminou por completo antes desta função sequer ser chamada.
 */
// Contadores só de sessão (nunca persistidos, resetam a cada carregamento
// de página) — existem exclusivamente para "permitir verificar... falhas
// técnicas" e conclusões (item 8 da observabilidade) sem criar um novo
// campo persistido nem registrar conteúdo bruto. Ver getAiEvaluationSessionStats().
let aiEvaluationSessionSuccesses = 0;
let aiEvaluationSessionFailures = 0;

async function requestConstructedAiEvaluation(concept, session, attempt){
  if(!attempt || typeof authedFetch !== "function") return;
  try{
    const res = await authedFetch("/api/avaliar-resposta-construida", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ conceptTitle:concept.title, referenceText:concept.text, responseText:session.responseText })
    });
    if(!res.ok){ aiEvaluationSessionFailures += 1; return; }
    const data = await res.json();
    const aiResult = validateConstructedAiEvaluation(data);
    if(!aiResult){ aiEvaluationSessionFailures += 1; return; }
    attachAiEvaluationToAttempt(attempt, aiResult);
    aiEvaluationSessionSuccesses += 1;
    await saveState();
  }catch(e){
    aiEvaluationSessionFailures += 1;
    console.error("Avaliação semântica por IA indisponível (fluxo de revisão não é afetado):", e);
  }
}

/** Contadores desta sessão (não persistidos) — só para observabilidade local. */
function getAiEvaluationSessionStats(){
  return { successes:aiEvaluationSessionSuccesses, failures:aiEvaluationSessionFailures };
}

/* ---- Concordância autoavaliação x IA (experimento pedagógico controlado,
   Prioridade 4) --------------------------------------------------------
   Camada puramente analítica: mede o quanto a avaliação semântica
   concorda com a autoavaliação do usuário em uso real. NUNCA lê nem
   escreve em evidenceStrength/retrievalPassedAt/strongRetrievalPassedAt/
   FSRS/calibração — essas continuam vindo exclusivamente da autoavaliação
   (ver recordConstructedResponseAttempt). Os registros aqui nunca incluem
   responseText, o texto de referência, nem o "reason" da IA — só classes,
   confidence, domínio/tag e timestamps (ver buildAiAgreementRecord). */

const AGREEMENT_CLASSES = Object.freeze(["incorrect", "partial", "correct"]);
const AGREEMENT_ORDER = Object.freeze({ incorrect:0, partial:1, correct:2 });

/**
 * Deriva a classe da AUTOAVALIAÇÃO do usuário a partir do `quality` já
 * persistido no attempt — nunca duplica dado num campo novo. Para
 * source:"constructed_response", `quality` já É CONSTRUCTED_RATINGS
 * (failed:1, partial:3, correct:4); esta função só inverte esse mapa.
 * Retorna null para qualquer outra fonte (quiz/review) — fora do escopo
 * desta comparação, que é só sobre resposta construída — ou para dados
 * antigos/corrompidos sem um quality reconhecível.
 */
function deriveUserClassificationFromAttempt(attempt){
  if(!attempt || attempt.source !== "constructed_response") return null;
  if(attempt.quality === 4) return "correct";
  if(attempt.quality === 3) return "partial";
  if(attempt.quality === 1) return "incorrect";
  return null;
}

/**
 * Registro mínimo de concordância para UM attempt — só classes,
 * confidence e domínio/tag (quando disponível). Nunca inclui
 * responseText, referenceText ou o "reason" completo da IA (privacidade
 * — ver item 6 do escopo). Retorna null quando não há autoavaliação
 * derivável ou não há aiEvaluation ainda (tentativa sem IA concluída).
 */
function buildAiAgreementRecord(conceptId, tag, attempt){
  const userClass = deriveUserClassificationFromAttempt(attempt);
  if(!userClass || !attempt || !attempt.aiEvaluation) return null;
  const aiClass = attempt.aiEvaluation.classification;
  if(!AGREEMENT_CLASSES.includes(aiClass)) return null;
  return {
    conceptId,
    domain: tag || null,
    userClass,
    aiClass,
    confidence: attempt.aiEvaluation.confidence,
    at: attempt.aiEvaluation.evaluatedAt || attempt.at || null
  };
}

/**
 * Varre um mapa de cardStates (tipicamente STATE.cards) + a lista de
 * conceitos (só para achar a tag) e monta os registros de concordância
 * — só resposta construída com aiEvaluation já anexada. Função pura:
 * não lê STATE/CONCEPTS diretamente, para ficar testável sem DOM.
 */
function collectAiAgreementRecords(cards, concepts){
  const conceptsById = {};
  (concepts || []).forEach(c => { conceptsById[c.id] = c; });
  const records = [];
  for(const conceptId of Object.keys(cards || {})){
    const cardState = cards[conceptId];
    const attempts = (cardState && cardState.retrievalAttempts) || [];
    const tag = conceptsById[conceptId] ? conceptsById[conceptId].tag : null;
    for(const attempt of attempts){
      const record = buildAiAgreementRecord(conceptId, tag, attempt);
      if(record) records.push(record);
    }
  }
  return records;
}

/** Matriz de concordância 3x3: matrix[classeDoUsuário][classeDaIA] = contagem. */
function buildAgreementConfusionMatrix(records){
  const matrix = {};
  for(const u of AGREEMENT_CLASSES){
    matrix[u] = {};
    for(const a of AGREEMENT_CLASSES) matrix[u][a] = 0;
  }
  for(const r of (records || [])){
    if(!r || !AGREEMENT_CLASSES.includes(r.userClass) || !AGREEMENT_CLASSES.includes(r.aiClass)) continue;
    matrix[r.userClass][r.aiClass] += 1;
  }
  return matrix;
}

function avgAgreementConfidence(records){
  const withConfidence = (records || []).filter(r => Number.isFinite(r.confidence));
  if(!withConfidence.length) return null;
  return withConfidence.reduce((sum, r) => sum + r.confidence, 0) / withConfidence.length;
}

/**
 * Estatísticas experimentais de concordância — accuracy/agreement, nunca
 * usadas para decisão pedagógica (item 5 do escopo: "não use esses
 * valores para decisão pedagógica"). "ai_more_generous": a IA classifica
 * ACIMA do usuário (ex.: usuário disse partial, IA disse correct).
 * "ai_more_strict": a IA classifica ABAIXO do usuário.
 */
function computeAiAgreementStats(records){
  const valid = (records || []).filter(r => r && AGREEMENT_CLASSES.includes(r.userClass) && AGREEMENT_CLASSES.includes(r.aiClass));
  const total = valid.length;
  const agree = valid.filter(r => r.userClass === r.aiClass);
  const disagree = valid.filter(r => r.userClass !== r.aiClass);
  const generous = valid.filter(r => AGREEMENT_ORDER[r.aiClass] > AGREEMENT_ORDER[r.userClass]);
  const strict = valid.filter(r => AGREEMENT_ORDER[r.aiClass] < AGREEMENT_ORDER[r.userClass]);
  return {
    total,
    confusionMatrix: buildAgreementConfusionMatrix(valid),
    agreementRate: total ? agree.length / total : null,
    disagreementRate: total ? disagree.length / total : null,
    aiMoreGenerousRate: total ? generous.length / total : null,
    aiMoreStrictRate: total ? strict.length / total : null,
    avgConfidenceAgreement: avgAgreementConfidence(agree),
    avgConfidenceDisagreement: avgAgreementConfidence(disagree),
    avgConfidenceAiMoreGenerous: avgAgreementConfidence(generous),
    avgConfidenceAiMoreStrict: avgAgreementConfidence(strict)
  };
}

/**
 * Cobertura: quantas tentativas de resposta construída existem no total
 * e quantas já têm aiEvaluation anexada — não distingue "falhou" de
 * "ainda não tentou" (a arquitetura atual não persiste essa distinção,
 * de propósito — ver requestConstructedAiEvaluation, melhor-esforço e
 * silencioso). Falhas desta sessão ficam em getAiEvaluationSessionStats().
 */
function computeAiEvaluationCoverage(cards){
  let totalConstructedAttempts = 0;
  let attemptsWithAiEvaluation = 0;
  for(const conceptId of Object.keys(cards || {})){
    const attempts = (cards[conceptId] && cards[conceptId].retrievalAttempts) || [];
    for(const attempt of attempts){
      if(!attempt || attempt.source !== "constructed_response") continue;
      totalConstructedAttempts += 1;
      if(attempt.aiEvaluation) attemptsWithAiEvaluation += 1;
    }
  }
  return {
    totalConstructedAttempts,
    attemptsWithAiEvaluation,
    aiEvaluationCoverageRate: totalConstructedAttempts ? attemptsWithAiEvaluation / totalConstructedAttempts : null
  };
}

/**
 * Agrega as mesmas taxas de computeAiAgreementStats (reaproveitada, não
 * reimplementada) por domínio/tag — usado pelo relatório real (ver
 * scripts/reportAiAgreement.js) para apontar em quais domínios ocorrem
 * mais divergências. Grupos com menos de `minSampleSize` registros são
 * marcados `insufficientSample:true` — nunca descartados silenciosamente,
 * só sinalizados como não confiáveis para interpretação isolada.
 */
function aggregateAiAgreementByDomain(records, minSampleSize){
  const threshold = minSampleSize == null ? 10 : minSampleSize;
  const byDomain = {};
  for(const r of (records || [])){
    const key = (r && r.domain) ? r.domain : "(sem domínio)";
    (byDomain[key] = byDomain[key] || []).push(r);
  }
  const out = {};
  for(const domain of Object.keys(byDomain)){
    const stats = computeAiAgreementStats(byDomain[domain]);
    out[domain] = {
      n: stats.total,
      agreementRate: stats.agreementRate,
      aiMoreGenerousRate: stats.aiMoreGenerousRate,
      aiMoreStrictRate: stats.aiMoreStrictRate,
      insufficientSample: stats.total < threshold
    };
  }
  return out;
}

/**
 * Todos os registros em que usuário e IA discordam — só identificadores
 * técnicos e classes (conceptId/domain/userClass/aiClass/confidence/at),
 * nunca responseText/referenceText/reason (ver buildAiAgreementRecord,
 * que já não inclui esses campos desde a origem do registro).
 */
function findAiAgreementDivergences(records){
  return (records || []).filter(r => r && AGREEMENT_CLASSES.includes(r.userClass) && AGREEMENT_CLASSES.includes(r.aiClass) && r.userClass !== r.aiClass);
}

/**
 * As três combinações de maior interesse para análise futura (nunca para
 * alterar comportamento pedagógico — ver escopo do relatório real):
 * user incorrect→AI correct (a mais importante: potencial superestimação
 * da aprendizagem), user partial→AI correct, e user correct→AI incorrect.
 */
function findCriticalAiAgreementCombinations(records){
  const divergences = findAiAgreementDivergences(records);
  return {
    userIncorrectAiCorrect: divergences.filter(r => r.userClass === "incorrect" && r.aiClass === "correct"),
    userPartialAiCorrect: divergences.filter(r => r.userClass === "partial" && r.aiClass === "correct"),
    userCorrectAiIncorrect: divergences.filter(r => r.userClass === "correct" && r.aiClass === "incorrect")
  };
}

/**
 * Relatório de observabilidade pronto para uso real (lê STATE/CONCEPTS
 * atuais) — não chamado automaticamente por nenhum fluxo de UI; existe
 * para inspeção manual (ex.: console do navegador) ou para uma futura
 * tela de administração, fora do escopo desta etapa.
 */
function getAiAgreementReport(){
  if(typeof STATE === "undefined" || !STATE || !STATE.cards) return null;
  const records = collectAiAgreementRecords(STATE.cards, typeof CONCEPTS !== "undefined" ? CONCEPTS : []);
  return {
    ...computeAiEvaluationCoverage(STATE.cards),
    ...computeAiAgreementStats(records),
    session: getAiEvaluationSessionStats()
  };
}

function recordExplanationEvidence(cardState, score){
  if(score < EXPLANATION_PASS_SCORE) return false;
  cardState.explanationPassedAt = todayStr();
  return true;
}

/**
 * `evaluation` aqui é o objeto JÁ NORMALIZADO por mapExplanationResponseToEvaluation
 * (chaves em inglês: conceptualErrors/missingPoints), não a resposta bruta do
 * endpoint (que usa equivocos/pontosFaltando em português) — ver
 * applyExplanationEvaluation, único chamador desta função.
 */
function recordExplanationOutcome(cardState, score, evaluation){
  recordExplanationEvidence(cardState, score);
  if(evaluation && Array.isArray(evaluation.conceptualErrors) && evaluation.conceptualErrors.length > 0){
    recordError(cardState, "conceptual_error", "explanation", evaluation.conceptualErrors.join("; "));
  }else if(score < EXPLANATION_PASS_SCORE){
    const detail = evaluation && Array.isArray(evaluation.missingPoints) ? evaluation.missingPoints.join("; ") : null;
    recordError(cardState, "incomplete_explanation", "explanation", detail);
  }
}

/* ---- Explicar / Técnica de Feynman — histórico por tentativa -------
   (Prioridade 3 — correção crítica: persistência antes da IA + estado
   "aguardando avaliação"). Espelha a arquitetura já usada por
   retrievalAttempts/recordConstructedResponseAttempt: cada tentativa é
   um objeto próprio, criado e PERSISTIDO antes de qualquer chamada de
   IA, e só atualizado in-place depois — nunca perdido por timeout,
   cota esgotada ou fechamento da aba. explainCount/lastExplainScore/
   explanationPassedAt continuam existindo e sendo atualizados (só
   depois de uma avaliação bem-sucedida), por compatibilidade — ver
   docs/estado-pedagogico.md. */

function generateExplainAttemptId(){
  if(typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `ea-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
}

/**
 * Cria e PERSISTE (no array, ainda não no storage — quem chama precisa
 * dar saveState() em seguida) um novo explainAttempt com
 * status:"pending_evaluation", ANTES de qualquer chamada de IA. Esse é
 * o invariante mais importante desta etapa: perda de rede, cota ou
 * fechamento da aba depois deste ponto nunca apaga o texto do aluno.
 */
/**
 * `previousAttemptId`/`attemptNumber` linkam esta tentativa à anterior do
 * MESMO conceito (se houver) — permitem reconstruir a cadeia "tentativa 1
 * → tentativa 2 → tentativa 3" sem um segundo sistema de histórico, só
 * lendo explainAttempts[] na ordem em que já fica (mais os dois campos,
 * que sobrevivem mesmo que o array seja um dia reordenado/filtrado). Todo
 * attempt novo — seja a primeira explicação do conceito ou uma "tentar
 * explicar novamente" depois de um diagnóstico — passa por aqui.
 */
function createExplainAttempt(cardState, responseText){
  const text = String(responseText || "").trim();
  if(text.length < EXPLANATION_MIN_LENGTH){
    throw new Error(`A explicação deve ter ao menos ${EXPLANATION_MIN_LENGTH} caracteres.`);
  }
  const existing = cardState.explainAttempts || [];
  const lastAttempt = existing.length ? existing[existing.length - 1] : null;
  // attemptNumber encadeia a partir do attemptNumber do anterior (não do
  // tamanho do array) de propósito: depois que o histórico atinge o limite
  // de 50 e passa a ser aparado (trimHistory), existing.length fica preso
  // em 50 para sempre — encadear pelo valor anterior mantém a contagem
  // real de tentativas (51ª, 52ª...) mesmo com tentativas antigas já
  // removidas do array.
  const attempt = {
    id: generateExplainAttemptId(),
    at: new Date().toISOString(),
    responseText: text,
    status: "pending_evaluation",
    evaluation: null,
    evaluatedAt: null,
    previousAttemptId: lastAttempt ? lastAttempt.id : null,
    attemptNumber: lastAttempt ? (lastAttempt.attemptNumber || existing.length) + 1 : 1,
    followUp: null
  };
  cardState.explainAttempts = trimHistory([...existing, attempt]);
  return attempt;
}

function findExplainAttempt(cardState, attemptId){
  return (cardState && cardState.explainAttempts || []).find(a => a.id === attemptId) || null;
}

/**
 * Decisão pedagógica "vista de fora": se o attempt já foi avaliado,
 * devolve a decisão persistida; senão devolve "pending_evaluation" — sem
 * duplicar o dado, é uma leitura derivada (ver evaluation.pedagogicalDecision).
 */
function deriveExplainAttemptDecision(attempt){
  if(attempt && attempt.status === "evaluated" && attempt.evaluation){
    return attempt.evaluation.pedagogicalDecision;
  }
  return "pending_evaluation";
}

/**
 * Falha TÉCNICA (timeout/rede/HTTP/parse) na chamada de IA — semântica
 * escolhida de propósito, distinta de cota esgotada (que mantém
 * "pending_evaluation", ver evaluateExplainAttempt): aqui a IA foi
 * chamada e algo deu errado no meio do caminho. Idempotente: nunca
 * reabre um attempt já avaliado.
 */
function markExplainAttemptFailed(cardState, attemptId){
  const attempt = findExplainAttempt(cardState, attemptId);
  if(!attempt || attempt.status === "evaluated") return attempt;
  attempt.status = "evaluation_failed";
  return attempt;
}

/**
 * Traduz a resposta bruta do endpoint (chaves em português —
 * api/_lib/explanationEvaluation.js) para o schema estruturado persistido
 * por tentativa (chaves em inglês, pedidas nesta etapa). Defensiva: nunca
 * lança, sempre devolve algo utilizável mesmo com campos ausentes —
 * mesmo espírito de validateConstructedAiEvaluation.
 */
function mapExplanationResponseToEvaluation(data){
  data = data || {};
  const score = Math.max(0, Math.min(100, Math.round(Number(data.nota) || 0)));
  const qualityByScore = score>=90 ? 5 : score>=70 ? 4 : score>=45 ? 3 : 1;
  const quality = [1,3,4,5].includes(data.qualidadeSM2) ? Math.min(data.qualidadeSM2, qualityByScore) : qualityByScore;
  const conceptualErrors = Array.isArray(data.equivocos) ? data.equivocos : [];
  const pedagogicalDecision = EXPLAIN_PEDAGOGICAL_DECISIONS_FROM_API.includes(data.decisaoPedagogica)
    ? data.decisaoPedagogica
    : (score >= EXPLANATION_PASS_SCORE ? "passed" : (conceptualErrors.length > 0 ? "return_to_comprehension" : "retry_recommended"));
  return {
    score,
    centralMechanism: typeof data.mecanismoCentral === "string" ? data.mecanismoCentral : "",
    mechanismInText: typeof data.mecanismoNoTexto === "string" ? data.mecanismoNoTexto : "",
    coveredPoints: Array.isArray(data.pontosCobertos) ? data.pontosCobertos : [],
    missingPoints: Array.isArray(data.pontosFaltando) ? data.pontosFaltando : [],
    conceptualErrors,
    imprecisions: Array.isArray(data.imprecisoes) ? data.imprecisoes : [],
    feedback: typeof data.feedback === "string" ? data.feedback : "",
    quality,
    pedagogicalDecision,
    followUpQuestion: typeof data.perguntaAprofundamento === "string" ? data.perguntaAprofundamento : ""
  };
}

/**
 * Aplica uma avaliação bem-sucedida a um attempt JÁ EXISTENTE — nunca cria
 * um novo. Idempotente: se o attempt já estiver "evaluated", não reaplica
 * FSRS/XP/contadores (evita duplicar efeitos quando chamada mais de uma
 * vez, ex.: avaliação posterior de uma tentativa que, por alguma corrida,
 * já tinha sido avaliada). Só a partir daqui — nunca antes — é que FSRS,
 * explainCount, lastExplainScore e explanationPassedAt são tocados.
 */
function applyExplanationEvaluation(cardState, attemptId, rawApiResponse){
  const attempt = findExplainAttempt(cardState, attemptId);
  if(!attempt) throw new Error("Tentativa de explicação não encontrada.");
  if(attempt.status === "evaluated") return attempt;

  const evaluation = mapExplanationResponseToEvaluation(rawApiResponse);
  const previousScore = cardState.lastExplainScore;
  cardState.explainCount = (cardState.explainCount || 0) + 1;
  cardState.lastExplainScore = evaluation.score;
  recordExplanationOutcome(cardState, evaluation.score, evaluation);
  fsrsUpdate(cardState, evaluation.quality);
  touchStreak();
  // XP premia demonstração de entendimento e progresso real entre tentativas.
  // Antes era Math.max(4, nota/100*25), o que dava mais pontos a uma explicação
  // fluente e vazia (nota 72) do que a um erro conceitual honesto (nota 35) —
  // incoerente num produto cujo propósito é justamente não recompensar a ilusão.
  const improvement = previousScore != null ? Math.max(0, evaluation.score - previousScore) : 0;
  const xpGain = (evaluation.score >= EXPLANATION_PASS_SCORE ? Math.round((evaluation.score/100) * 25) : 0)
    + Math.round(improvement / 5)
    + 2; // participação: escrever e receber o diagnóstico já vale algo
  addXP(xpGain);

  // Só marca como "evaluated" depois que TODOS os efeitos pedagógicos acima
  // rodaram sem lançar — evita um attempt marcado como avaliado com efeitos
  // só parcialmente aplicados. Se algo acima lançar, evaluateExplainAttempt
  // captura e marca "evaluation_failed" (o attempt continua "pending_evaluation"
  // até aqui), permitindo tentar de novo com segurança.
  attempt.evaluation = evaluation;
  attempt.evaluatedAt = new Date().toISOString();
  attempt.status = "evaluated";

  return attempt;
}

/**
 * Avalia (ou REAVALIA) um attempt já persistido — usada tanto no fluxo de
 * submissão inicial quanto numa avaliação posterior de uma tentativa
 * pendente. Nunca cria outro attempt (recebe o id de um já existente) e é
 * idempotente (ver applyExplanationEvaluation): chamar duas vezes sobre um
 * attempt já avaliado não duplica FSRS/XP/histórico.
 *
 * Tratamento de falha, por design:
 * - HTTP 429 (cota esgotada, ver requireUsageQuota): o attempt permanece
 *   "pending_evaluation" — não é uma falha técnica, é "ainda não avaliado".
 * - qualquer outra falha (timeout/rede/HTTP/parse/schema inválido): o
 *   attempt vira "evaluation_failed" (ver markExplainAttemptFailed).
 * Em nenhum dos dois casos o responseText é apagado, FSRS é chamado, ou
 * explanationPassedAt/lastExplainScore são tocados.
 */
async function evaluateExplainAttempt(concept, cardState, attemptId){
  const attempt = findExplainAttempt(cardState, attemptId);
  if(!attempt) throw new Error("Tentativa de explicação não encontrada.");
  if(attempt.status === "evaluated") return attempt;

  try{
    const res = await authedFetch("/api/avaliar-explicacao", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ title:concept.title, referenceText:concept.text, studentText:attempt.responseText })
    });
    if(res.status === 429){
      return attempt; // cota esgotada: permanece pending_evaluation, ver docstring acima
    }
    if(!res.ok){
      return markExplainAttemptFailed(cardState, attemptId);
    }
    const data = await res.json();
    return applyExplanationEvaluation(cardState, attemptId, data);
  }catch(e){
    console.error("Falha ao avaliar explicação (tentativa preservada):", e);
    return markExplainAttemptFailed(cardState, attemptId);
  }
}

/**
 * Persiste a resposta do aluno à pergunta de aprofundamento — só sobre um
 * attempt já "evaluated" com followUpQuestion disponível. Não faz nenhuma
 * chamada de IA (Prioridade 3 não exige avaliar essa resposta) e nunca
 * toca em FSRS/evidência/calibração. Idempotente: se o attempt já tem
 * followUp respondido, devolve o que já existe sem sobrescrever — reload
 * ou reenvio acidental nunca duplica/substitui a resposta já dada.
 */
function recordExplainFollowUpResponse(cardState, attemptId, responseText){
  const attempt = findExplainAttempt(cardState, attemptId);
  if(!attempt) throw new Error("Tentativa de explicação não encontrada.");
  if(attempt.status !== "evaluated" || !attempt.evaluation || !attempt.evaluation.followUpQuestion){
    throw new Error("Esta tentativa ainda não tem uma pergunta de aprofundamento disponível.");
  }
  if(attempt.followUp) return attempt.followUp; // idempotente: não sobrescreve resposta já dada

  const text = String(responseText || "").trim();
  if(!text) throw new Error("Escreva uma resposta antes de enviar.");

  attempt.followUp = {
    question: attempt.evaluation.followUpQuestion,
    responseText: text,
    answeredAt: new Date().toISOString()
  };
  return attempt.followUp;
}

function markConceptPresented(cardState){
  if(cardState.seen) return false;
  cardState.seen = true;
  cardState.presentedAt = new Date().toISOString();
  return true;
}

async function recordComprehensionStatus(cardState, status, issue){
  if(!COMPREHENSION_STATUSES.includes(status)){
    throw new Error(`Status de compreensão inválido: ${status}`);
  }
  cardState.comprehensionStatus = status;
  cardState.comprehensionIssue = (status === "no_issue_detected" || status === "not_assessed") ? null : (String(issue || "").trim() || null);
  await saveState();
  return { status:cardState.comprehensionStatus, issue:cardState.comprehensionIssue };
}

function comprehensionControlsHtml(cardState){
  const labels = {
    not_assessed:"Ainda não avaliado",
    no_issue_detected:"Entendi sem dificuldade",
    doubt_reported:"Ainda tenho dúvida",
    blocked:"Não consegui compreender"
  };
  return `
    <div class="comprehension-check" style="margin-top:12px; padding:12px; border:1px solid var(--border); border-radius:10px;">
      <div class="qtext" style="margin-bottom:8px;">Como ficou este conceito para você?</div>
      <p class="lead" style="margin:0 0 8px; font-size:11.5px;">Esta é apenas sua percepção atual; não comprova retenção ou aprendizagem.</p>
      <div style="display:flex; gap:7px; flex-wrap:wrap;">
        <button class="btn ghost comprehension-option" type="button" data-status="no_issue_detected">Entendi sem dificuldade</button>
        <button class="btn ghost comprehension-option" type="button" data-status="doubt_reported">Ainda tenho dúvida</button>
        <button class="btn ghost comprehension-option" type="button" data-status="blocked">Não consegui compreender</button>
      </div>
      <div class="comprehension-feedback lead" style="margin:8px 0 0; font-size:11.5px;">Atual: ${escapeHtml(labels[cardState.comprehensionStatus] || labels.not_assessed)}${cardState.comprehensionIssue ? ` — ${escapeHtml(cardState.comprehensionIssue)}` : ""}</div>
    </div>`;
}

function bindComprehensionControls(container, concept){
  const cardState = STATE.cards[concept.id];
  const labels = { no_issue_detected:"Entendi sem dificuldade", doubt_reported:"Ainda tenho dúvida", blocked:"Não consegui compreender" };
  container.querySelectorAll(".comprehension-option").forEach(btn=>{
    btn.onclick = async ()=>{
      const status = btn.dataset.status;
      let issue = null;
      if(status === "doubt_reported") issue = window.prompt("Qual é sua dúvida? (opcional)", "");
      if(status === "blocked") issue = window.prompt("O que impediu você de compreender? (opcional)", "");
      if((status === "doubt_reported" || status === "blocked") && issue === null) return;
      await recordComprehensionStatus(cardState, status, issue);
      const feedback = container.querySelector(".comprehension-feedback");
      if(feedback) feedback.textContent = `Atual: ${labels[status]}${cardState.comprehensionIssue ? ` — ${cardState.comprehensionIssue}` : ""}`;
    };
  });
}

function reportContentProblem(cardState, reason){
  cardState.contentQuality = { status:"reported", reason:reason || null, reportedAt:new Date().toISOString() };
  recordError(cardState, "content_problem", "content_report", reason || null);
  return cardState.contentQuality;
}

function contentReportHtml(){
  return `<button class="btn ghost content-report-btn" type="button" style="margin-top:10px; font-size:11.5px;">⚑ Este conceito está confuso ou pode estar errado</button><div class="content-report-feedback"></div>`;
}

function bindContentReport(container, concept){
  const reportBtn = container.querySelector(".content-report-btn");
  if(!reportBtn) return;
  reportBtn.onclick = async ()=>{
    const reason = window.prompt("Motivo opcional: o que parece confuso ou incorreto?", "");
    if(reason === null) return;
    reportContentProblem(STATE.cards[concept.id], reason.trim());
    await saveState();
    const feedback = container.querySelector(".content-report-feedback");
    if(feedback) feedback.innerHTML = '<div class="feedback ok" style="margin-top:8px;">Obrigado. O conteúdo foi marcado para revisão sem alterar seu progresso ou agendamento.</div>';
  };
}

function evaluateConceptEvidence(cardState){
  const retrievalVerified = Boolean(cardState && cardState.retrievalPassedAt);
  const explanationVerified = Boolean(cardState && cardState.explanationPassedAt);
  const applicationVerified = Boolean(cardState && cardState.applicationPassedAt);
  return {
    retrievalVerified,
    explanationVerified,
    applicationVerified,
    retentionVerified: retrievalVerified && explanationVerified
  };
}

function hasRetentionEvidence(cardState){
  return evaluateConceptEvidence(cardState).retentionVerified;
}

function retentionEvidencePercentage(cards, conceptCount){
  if(!conceptCount) return 0;
  const retained = Object.values(cards || {}).filter(hasRetentionEvidence).length;
  return Math.round((retained / conceptCount) * 100);
}
async function saveState(){ await StorageAdapter.save(CONFIG.storageKey, STATE); }

function resetDailyProgressIfNeeded(){
  const t = todayStr();
  if(STATE.dailyProgress.date !== t){
    STATE.dailyProgress = { date: t, newCount: 0, reviewCount: 0 };
  }
}

function touchStreak(){
  const t = todayStr();
  if(STATE.lastStudyDate === t) return;
  if(STATE.lastStudyDate && daysBetween(STATE.lastStudyDate, t) === 1){
    STATE.streak += 1;
  } else {
    STATE.streak = 1;
  }
  STATE.lastStudyDate = t;
}

// Gamificação desativada: XP, níveis, streak e badges saíram da interface.
// Num produto cujo propósito é impedir a sensação falsa de progresso, pontuar
// a tentativa recria a ilusão em outro lugar. Os campos continuam no STATE
// apenas para não invalidar o progresso já salvo de quem usou as versões
// anteriores — nada é exibido nem premiado.
const GAMIFICATION_ENABLED = false;

function addXP(n){
  if(!GAMIFICATION_ENABLED) return;
  STATE.xp += n;
  showToast(`+${n} XP`);
}

function levelInfo(xp){
  let idx = 0;
  for(let i=0;i<LEVELS.length;i++){ if(xp >= LEVELS[i].min) idx = i; }
  const cur = LEVELS[idx];
  const next = LEVELS[idx+1];
  const pct = next ? Math.min(100, Math.round(((xp-cur.min)/(next.min-cur.min))*100)) : 100;
  return { name: cur.name, level: idx+1, pct, next };
}

function checkBadges(){
  if(!GAMIFICATION_ENABLED) return;
  const newly = [];
  BADGES.forEach(b=>{
    if(!STATE.badges.includes(b.id) && b.check(STATE)){
      STATE.badges.push(b.id);
      newly.push(b);
    }
  });
  newly.forEach(b => showToast(`🏅 Conquista: ${b.name}`));
  return newly;
}

/* ---- FSRS (repetição espaçada) ----
   Substitui o SM-2 usado até a Fase 4. FSRS modela a memória de cada
   ficha com dois números que evoluem a cada revisão:
   - stability (S): quantos dias levam para a chance de lembrar cair a 90%.
   - difficulty (D): de 1 (fácil) a 10 (difícil), quão rápido a estabilidade
     cresce a cada acerto.
   A partir desses dois valores, calcula-se retrievability (R, a chance
   estimada de lembrar HOJE) e o próximo intervalo de revisão, mirando
   sempre 90% de chance de lembrança na hora da próxima revisão.

   Pesos padrão da comunidade open-spaced-repetition (FSRS-4.5) — não são
   ajustados por usuário aqui (isso exigiria um histórico de revisões para
   treinar um modelo por pessoa, fora do escopo deste app).
   Referência: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm */
const FSRS_W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621
];
const FSRS_FACTOR = 19 / 81;
const FSRS_DECAY = -0.5;
const FSRS_DESIRED_RETENTION = 0.9;

function fsrsClampD(d){ return Math.min(10, Math.max(1, d)); }

// t = dias desde a última revisão, s = stability atual → probabilidade estimada de lembrar hoje.
function fsrsRetrievability(t, s){
  if(!s || s <= 0) return 0;
  return Math.pow(1 + FSRS_FACTOR * (t / s), FSRS_DECAY);
}
// Dado o stability, calcula em quantos dias a retrievability cai até a meta (90%).
function fsrsIntervalDays(s){
  return (s / FSRS_FACTOR) * (Math.pow(FSRS_DESIRED_RETENTION, 1 / FSRS_DECAY) - 1);
}
function fsrsInitialStability(g){ return FSRS_W[g - 1]; } // g=1..4 → W[0..3]
function fsrsInitialDifficulty(g){
  return fsrsClampD(FSRS_W[4] - Math.exp(FSRS_W[5] * (g - 1)) + 1);
}
function fsrsNextDifficulty(d, g){
  const deltaD = -FSRS_W[6] * (g - 3);
  const dPrime = d + deltaD * ((10 - d) / 9);
  return fsrsClampD(FSRS_W[7] * fsrsInitialDifficulty(4) + (1 - FSRS_W[7]) * dPrime);
}
function fsrsStabilityAfterSuccess(d, s, r, g){
  const tD = 11 - d;
  const tS = Math.pow(s, -FSRS_W[9]);
  const tR = Math.exp(FSRS_W[10] * (1 - r)) - 1;
  const hardPenalty = g === 2 ? FSRS_W[15] : 1;
  const easyBonus = g === 4 ? FSRS_W[16] : 1;
  const alpha = 1 + tD * tS * tR * hardPenalty * easyBonus * Math.exp(FSRS_W[8]);
  return s * alpha;
}
function fsrsStabilityAfterFail(d, s, r){
  const dF = Math.pow(d, -FSRS_W[12]);
  const sF = Math.pow(s + 1, FSRS_W[13]) - 1;
  const rF = Math.exp(FSRS_W[14] * (1 - r));
  return Math.min(dF * sF * rF * FSRS_W[11], s);
}

// Converte a escala de qualidade usada no app (1=Esqueci, 2=Errou na
// checagem, 3=Difícil, 4=Bom, 5=Fácil) para a nota FSRS de 4 pontos
// (1=Forgot, 2=Hard, 3=Good, 4=Easy).
function qualityToFsrsGrade(quality){
  if(quality <= 2) return 1;
  if(quality === 3) return 2;
  if(quality === 4) return 3;
  return 4;
}

function fsrsUpdate(cardState, quality){
  const g = qualityToFsrsGrade(quality);
  const today = todayStr();

  if(cardState.stability == null || cardState.difficulty == null){
    // Primeira vez desta ficha no FSRS. Se ela já tinha progresso do
    // algoritmo antigo (SM-2, antes da Fase 4), reaproveita o intervalo
    // já calculado como estimativa inicial de estabilidade, em vez de
    // reiniciar do zero — assim quem já vinha estudando não perde todo
    // o histórico de repetição ao ganhar esta atualização.
    cardState.stability = (cardState.seen && cardState.interval > 0)
      ? Math.max(1, cardState.interval)
      : fsrsInitialStability(g);
    cardState.difficulty = fsrsInitialDifficulty(g);
  } else {
    const elapsedDays = cardState.lastReviewDate ? Math.max(0, daysBetween(cardState.lastReviewDate, today)) : 0;
    const r = fsrsRetrievability(elapsedDays, cardState.stability);
    cardState.stability = (g === 1)
      ? fsrsStabilityAfterFail(cardState.difficulty, cardState.stability, r)
      : fsrsStabilityAfterSuccess(cardState.difficulty, cardState.stability, r, g);
    cardState.difficulty = fsrsNextDifficulty(cardState.difficulty, g);
  }

  // "reps" não participa mais do cálculo do intervalo — fica só para
  // exibição na tela de Progresso e para as conquistas (badges).
  cardState.reps = (g === 1) ? 0 : (cardState.reps || 0) + 1;

  const intervalDays = Math.max(1, Math.round(fsrsIntervalDays(cardState.stability)));
  cardState.interval = intervalDays;
  cardState.nextReview = addDays(today, intervalDays);
  cardState.lastReviewDate = today;
  cardState.lastQuality = quality;
  cardState.seen = true;
}

function showToast(msg){
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 2600);
}
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){ const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

function interleaveConceptsByTag(items){
  const remaining = (items || []).slice();
  const result = [];
  let lastTag = null;
  while(remaining.length){
    let index = remaining.findIndex(item => item.tag !== lastTag);
    if(index < 0) index = 0;
    const [next] = remaining.splice(index, 1);
    result.push(next);
    lastTag = next.tag;
  }
  return result;
}

function orderReviewQueue(items, cards){
  const sorted = (items || []).slice().sort((a,b)=>String(cards[a.id].nextReview || "").localeCompare(String(cards[b.id].nextReview || "")));
  const result = [];
  let start = 0;
  while(start < sorted.length){
    const priority = String(cards[sorted[start].id].nextReview || "");
    let end = start + 1;
    while(end < sorted.length && String(cards[sorted[end].id].nextReview || "") === priority) end += 1;
    result.push(...interleaveConceptsByTag(sorted.slice(start, end)));
    start = end;
  }
  return result;
}
function conceptStatus(c){
  const s = STATE.cards[c.id];
  if(!s.seen) return {label:"Novo", cls:"chip-new"};
  const evidence = evaluateConceptEvidence(s);
  if(evidence.retentionVerified){
    return {label:"Retido — transferência não verificada", cls:"chip-retained"};
  }
  if(evidence.retrievalVerified || evidence.explanationVerified){
    return {label:"Em prática", cls:"chip-practice"};
  }
  return {label:"Apresentado", cls:"chip-presented"};
}
function dueCards(){
  const t = todayStr();
  return CONCEPTS.filter(c => STATE.cards[c.id].seen && STATE.cards[c.id].nextReview <= t);
}

/* ---- Tabs ---- */
function bindTabs(){
  document.querySelectorAll("nav.tabs button").forEach(btn=>{
    btn.addEventListener("click", ()=> switchTab(btn.dataset.tab));
  });
}
function switchTab(name){
  // T2: sair da tela de estudo (aprender/revisar/quiz/explicar) pra
  // qualquer outra aba é um bom momento pra garantir que o progresso
  // recente já foi pro Firestore, sem esperar o debounce normal. Não
  // trava a troca de aba — dispara e segue (o storage.js já lida com
  // não sobrepor gravações).
  if(CONFIG && typeof StorageAdapter !== "undefined" && StorageAdapter.flush) StorageAdapter.flush(CONFIG.storageKey).catch(()=>{});

  document.querySelectorAll(".tab-content").forEach(el=> el.style.display = "none");
  document.getElementById("tab-"+name).style.display = "block";
  document.querySelectorAll("nav.tabs button").forEach(b=> b.classList.toggle("active", b.dataset.tab===name));
  if(name==="aprender") renderLearn();
  if(name==="revisar") renderReview();
  if(name==="explicar") renderExplain();
  if(name==="quiz") renderQuizStart();
  if(name==="progresso") renderProgress();
  renderHeader();
}

function renderHeader(){
  const due = dueCards().length;
  const elDueStat = document.getElementById("stat-due");
  if(elDueStat) elDueStat.textContent = due;
  const dueBadge = document.getElementById("due-badge");
  if(dueBadge){
    if(due>0){ dueBadge.style.display="inline-block"; dueBadge.textContent = due; }
    else dueBadge.style.display = "none";
  }

  const introduced = Object.values(STATE.cards).filter(c=>c.seen).length;
  const elIntro = document.getElementById("home-introduced");
  const elDue = document.getElementById("home-due");
  if(elIntro) elIntro.textContent = `${introduced} / ${CONCEPTS.length}`;
  if(elDue) elDue.textContent = due;
}

/* ---- Aprender ---- */
let learnIndex = 0;
let learnOverrideLimit = false;
function nextUnseenIndex(){
  const idx = CONCEPTS.findIndex(c => !STATE.cards[c.id].seen);
  return idx === -1 ? 0 : idx;
}
function renderLearn(){
  resetDailyProgressIfNeeded();
  learnOverrideLimit = false;
  learnIndex = nextUnseenIndex();
  renderLearnCard();
}
function renderLearnCard(){
  const panel = document.getElementById("learn-panel");
  const total = CONCEPTS.length;
  const allDone = Object.values(STATE.cards).every(c=>c.seen);

  if(allDone){
    panel.innerHTML = `
      <div class="empty-state">
        <div class="big">🎉</div>
        <h2 class="section-title" style="justify-content:center;">Todos os conceitos foram apresentados!</h2>
        <p class="lead">Agora é hora de fortalecer a memória. Vá para a aba <b>Revisar</b> ou desafie-se no <b>Quiz</b>.</p>
        <div style="margin-top:14px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <button class="btn" onclick="switchTab('explicar')">🗣️ Explicar agora</button>
          <button class="btn secondary" onclick="switchTab('revisar')">🔁 Revisão rápida</button>
        </div>
      </div>`;
    return;
  }

  const dailyLimit = STATE.settings.dailyNewLimit;
  const limitReached = dailyLimit > 0 && STATE.dailyProgress.newCount >= dailyLimit;
  if(limitReached && !learnOverrideLimit){
    panel.innerHTML = `
      <div class="empty-state">
        <div class="big">🌤️</div>
        <h2 class="section-title" style="justify-content:center;">Meta diária concluída!</h2>
        <p class="lead">Você já estudou <b>${STATE.dailyProgress.newCount}</b> conceito(s) novo(s) hoje — sua meta é ${dailyLimit} por dia
        (dá pra mudar isso na aba Progresso). Estudar aos poucos ajuda a memória mais do que apresentar tudo de uma vez.</p>
        <div style="margin-top:14px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
          <button class="btn" onclick="switchTab('revisar')">🔁 Revisar o que já estudei</button>
          <button class="btn secondary" id="learn-override-btn">Continuar estudando mesmo assim</button>
        </div>
      </div>`;
    const overrideBtn = document.getElementById("learn-override-btn");
    if(overrideBtn) overrideBtn.onclick = ()=>{ learnOverrideLimit = true; renderLearnCard(); };
    return;
  }

  const c = CONCEPTS[learnIndex];
  const cardState = STATE.cards[c.id];
  if(markConceptPresented(cardState)){
    STATE.dailyProgress.newCount += 1;
    saveState().catch(()=>{});
  }
  let track = `<div class="track">`;
  CONCEPTS.forEach((cc,i)=>{
    let cls = "dot";
    if(STATE.cards[cc.id].seen) cls += " done";
    if(i===learnIndex) cls += " current";
    track += `<div class="${cls}"></div>`;
  });
  track += `</div>`;

  panel.innerHTML = `
    <h2 class="section-title">📖 Conceito ${learnIndex+1} de ${total}</h2>
    ${track}
    <div class="concept-card" id="learn-card">
      <span class="concept-tag">${escapeHtml(c.tag)}</span>
      <div class="concept-title">${escapeHtml(c.title)}</div>
      <div class="concept-text">${escapeHtml(c.text)}</div>
      ${sourceLinkHtml(c)}
      ${linkedNotesHtml(c)}
      <div id="analogy-box">
        ${STATE.cards[c.id].analogy ? renderAnalogyHtml(STATE.cards[c.id].analogy) : `<button class="btn ghost" id="analogy-btn">💡 Ver explicação com analogia</button>`}
      </div>
      ${comprehensionControlsHtml(cardState)}
      ${contentReportHtml()}
      <div class="quiz-q">
        <div class="qtext">✅ Checagem rápida: ${escapeHtml(c.q)}</div>
        <div id="learn-opts"></div>
        <div id="learn-feedback"></div>
      </div>
    </div>
  `;

  const optsWrap = document.getElementById("learn-opts");
  const shuffledOptions = c.options.map((text,i)=>({text, isCorrect: i===c.correct}));
  shuffle(shuffledOptions).forEach(opt=>{
    const b = document.createElement("button");
    b.className = "opt";
    b.textContent = opt.text;
    b.onclick = ()=> handleLearnAnswer(opt.isCorrect, b, optsWrap);
    optsWrap.appendChild(b);
  });

  const analogyBtn = document.getElementById("analogy-btn");
  if(analogyBtn) analogyBtn.onclick = ()=> loadAnalogy(c);
  bindComprehensionControls(panel, c);
  bindContentReport(panel, c);
}

function renderAnalogyHtml(text){
  return `<div class="feedback ok" style="margin-top:10px;"><b>💡 Outra forma de pensar nisso:</b><br>${escapeHtml(text)}</div>`;
}

async function loadAnalogy(c){
  const box = document.getElementById("analogy-box");
  box.innerHTML = `<p class="lead" style="margin-top:10px;">🧠 Pensando numa analogia...</p>`;
  try{
    const resp = await authedFetch("/api/gerar-analogia", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: c.title, referenceText: c.text })
    });
    const data = await resp.json();
    if(!resp.ok){
      box.innerHTML = `<div class="feedback bad" style="margin-top:10px;">${escapeHtml(data.error || "Não foi possível gerar a analogia agora.")}</div>`;
      return;
    }
    STATE.cards[c.id].analogy = data.analogia;
    await saveState();
    box.innerHTML = renderAnalogyHtml(data.analogia);
  }catch(e){
    console.error(e);
    box.innerHTML = `<div class="feedback bad" style="margin-top:10px;">Erro ao gerar analogia. Tente novamente.</div>`;
  }
}

async function handleLearnAnswer(isCorrect, btnEl, optsWrap){
  const buttons = optsWrap.querySelectorAll(".opt");
  buttons.forEach(b=> b.classList.add("disabled"));
  buttons.forEach(b=>{ if(b === btnEl) b.classList.add(isCorrect ? "correct" : "wrong"); });

  const c = CONCEPTS[learnIndex];
  const cardState = STATE.cards[c.id];
  fsrsUpdate(cardState, isCorrect ? 4 : 2);
  touchStreak();
  addXP(isCorrect ? 10 : 4);
  await saveState();

  const fb = document.getElementById("learn-feedback");
  fb.className = "feedback " + (isCorrect ? "ok" : "bad");
  fb.textContent = isCorrect
    ? "Isso mesmo! Este conceito volta amanhã para uma revisão rápida."
    : "Quase! Releia a explicação acima — este conceito vai voltar amanhã para reforço.";

  const nextBtn = document.createElement("button");
  nextBtn.className = "btn";
  nextBtn.style.marginTop = "14px";
  nextBtn.textContent = (learnIndex < CONCEPTS.length-1) ? "Próximo conceito →" : "Concluir";
  nextBtn.onclick = ()=>{
    checkBadges();
    learnIndex = nextUnseenIndex();
    renderHeader();
    renderLearnCard();
  };
  fb.appendChild(document.createElement("br"));
  fb.appendChild(nextBtn);
  renderHeader();
}

/* ---- Revisar ---- */
let reviewQueue = [];
let reviewHiddenByLimit = 0;
let reviewLimitOverride = false;
let reviewMode = "constructed";
function renderReview(){
  resetDailyProgressIfNeeded();
  reviewLimitOverride = false;
  reviewMode = "constructed";
  const allDue = orderReviewQueue(dueCards(), STATE.cards);
  const pendingIndex = allDue.findIndex(c => STATE.cards[c.id].pendingConstructedResponse);
  if(pendingIndex > 0) allDue.unshift(allDue.splice(pendingIndex, 1)[0]);
  const limit = STATE.settings.dailyReviewLimit;
  if(limit > 0){
    const remaining = Math.max(0, limit - STATE.dailyProgress.reviewCount);
    reviewQueue = allDue.slice(0, remaining);
    reviewHiddenByLimit = allDue.length - reviewQueue.length;
  } else {
    reviewQueue = allDue;
    reviewHiddenByLimit = 0;
  }
  renderReviewCard();
}

function reviewModeButtonsHtml(){
  return `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
    <button class="btn ${reviewMode === "constructed" ? "" : "secondary"} review-mode-btn" type="button" data-mode="constructed">✍️ Resposta construída</button>
    <button class="btn ${reviewMode === "self_rated" ? "" : "secondary"} review-mode-btn" type="button" data-mode="self_rated">🔁 Autoavaliação rápida</button>
  </div>`;
}

function bindReviewModeButtons(panel){
  panel.querySelectorAll(".review-mode-btn").forEach(btn=>{
    btn.onclick = ()=>{
      reviewMode = btn.dataset.mode;
      renderReviewCard();
    };
  });
}

function renderConstructedReference(panel, concept, session){
  const reference = getConstructedReference(session, concept);
  panel.innerHTML = `
    <h2 class="section-title">✍️ Resposta construída</h2>
    ${reviewModeButtonsHtml()}
    <p class="lead">Compare honestamente antes de classificar. A resposta construída correta gera evidência forte; parcial não.</p>
    <div class="concept-card">
      <span class="concept-tag">${escapeHtml(concept.tag)}</span>
      <div class="qtext" style="margin-top:8px;">${escapeHtml(concept.q || concept.title)}</div>
      <div class="stat-card" style="margin-top:12px;"><div class="label">Sua resposta</div><p class="lead" style="margin:6px 0 0; white-space:pre-wrap;">${escapeHtml(reference.responseText)}</p></div>
      <div class="stat-card" style="margin-top:10px;"><div class="label">Resposta de referência</div><p class="lead" style="margin:6px 0 0; white-space:pre-wrap;">${escapeHtml(reference.referenceText)}</p></div>
      ${sourceLinkHtml(concept)}${linkedNotesHtml(concept)}${contentReportHtml()}
      <div style="margin-top:14px;">
        <p class="lead" style="margin-bottom:8px;">Quanto você conseguiu recuperar antes de consultar?</p>
        <div class="rate-row">
          <button class="rate-btn rate-again constructed-rating" type="button" data-rating="failed">Não consegui recuperar<small>FSRS 1</small></button>
          <button class="rate-btn rate-hard constructed-rating" type="button" data-rating="partial">Recuperei parcialmente<small>FSRS 3</small></button>
          <button class="rate-btn rate-good constructed-rating" type="button" data-rating="correct">Recuperei corretamente<small>FSRS 4</small></button>
        </div>
      </div>
    </div>`;
  bindReviewModeButtons(panel);
  bindContentReport(panel, concept);
  panel.querySelectorAll(".constructed-rating").forEach(btn=>{
    btn.onclick = async ()=>{
      panel.querySelectorAll(".constructed-rating").forEach(b=>b.disabled = true);
      const cardState = STATE.cards[concept.id];
      const attempt = recordConstructedResponseAttempt(cardState, session, btn.dataset.rating);
      touchStreak();
      STATE.dailyProgress.reviewCount += 1;
      if(session.confidence === 3 && btn.dataset.rating !== "correct") STATE.calibration.overconfident += 1;
      else if(session.confidence === 1 && btn.dataset.rating === "correct") STATE.calibration.underconfident += 1;
      else STATE.calibration.aligned += 1;
      reviewQueue.shift();
      if(reviewQueue.length === 0) STATE.reviewSessions += 1;
      await saveState();
      checkBadges();
      renderHeader();
      renderReviewCard();
      // Disparado DEPOIS que autoavaliação + FSRS + persistência já
      // terminaram acima — nunca aguardado (fire-and-forget). Uma falha
      // ou demora na IA não atrasa nem afeta o fluxo de revisão.
      requestConstructedAiEvaluation(concept, session, attempt);
    };
  });
}

function renderConstructedReviewCard(panel, concept){
  const cardState = STATE.cards[concept.id];
  const pending = cardState.pendingConstructedResponse;
  if(pending && pending.confidence != null && pending.responseText){
    const restored = createConstructedAttemptSession(concept.id, pending.startedAt);
    Object.assign(restored, pending, { submitted:true });
    renderConstructedReference(panel, concept, restored);
    return;
  }
  const session = createConstructedAttemptSession(concept.id);
  const prompt = constructedPromptData(concept);
  panel.innerHTML = `
    <h2 class="section-title">✍️ Resposta construída</h2>
    ${reviewModeButtonsHtml()}
    <p class="lead" style="margin-top:-4px;">${reviewQueue.length} carta(s) restante(s). Responda sem consultar; conteúdo, notas e fontes permanecem ocultos até o envio.</p>
    <div class="concept-card">
      <span class="concept-tag">${escapeHtml(prompt.tag)}</span>
      <div class="qtext" style="margin-top:8px;">${escapeHtml(prompt.prompt)}</div>
      <div class="constructed-confidence" style="margin-top:14px;">
        <p class="lead" style="margin-bottom:8px;">Antes de responder: quão confiante você está?</p>
        <div class="rate-row">
          <button class="rate-btn rate-again constructed-confidence-btn" type="button" data-confidence="1">Baixa</button>
          <button class="rate-btn rate-hard constructed-confidence-btn" type="button" data-confidence="2">Média</button>
          <button class="rate-btn rate-easy constructed-confidence-btn" type="button" data-confidence="3">Alta</button>
        </div>
      </div>
      <textarea class="explain-textarea constructed-response-input" rows="4" disabled placeholder="Escolha sua confiança e escreva o que consegue recuperar sem consultar." style="margin-top:12px;"></textarea>
      <div class="lead constructed-charcount" style="font-size:11.5px; margin:5px 0 0;">0 caracteres (mínimo ${MIN_CONSTRUCTED_RESPONSE_LENGTH})</div>
      <button class="btn constructed-submit" type="button" disabled style="margin-top:10px;">Registrar minha resposta</button>
      <div class="constructed-error"></div>
    </div>`;
  bindReviewModeButtons(panel);
  const input = panel.querySelector(".constructed-response-input");
  const submit = panel.querySelector(".constructed-submit");
  const counter = panel.querySelector(".constructed-charcount");
  panel.querySelectorAll(".constructed-confidence-btn").forEach(btn=>{
    btn.onclick = ()=>{
      setConstructedConfidence(session, parseInt(btn.dataset.confidence, 10));
      panel.querySelectorAll(".constructed-confidence-btn").forEach(b=>b.classList.toggle("selected", b === btn));
      input.disabled = false;
      input.focus();
      submit.disabled = input.value.trim().length < MIN_CONSTRUCTED_RESPONSE_LENGTH;
    };
  });
  input.oninput = ()=>{
    const length = input.value.trim().length;
    counter.textContent = `${length} caracteres (mínimo ${MIN_CONSTRUCTED_RESPONSE_LENGTH})`;
    submit.disabled = session.confidence == null || length < MIN_CONSTRUCTED_RESPONSE_LENGTH;
  };
  submit.onclick = async ()=>{
    try{
      submitConstructedResponse(session, input.value);
      cardState.pendingConstructedResponse = {
        conceptId:concept.id, startedAt:session.startedAt, confidence:session.confidence,
        responseText:session.responseText, latencyMs:session.latencyMs, submittedAt:new Date().toISOString()
      };
      await saveState();
      renderConstructedReference(panel, concept, session);
    }catch(error){
      panel.querySelector(".constructed-error").innerHTML = `<div class="feedback bad" style="margin-top:8px;">${escapeHtml(error.message)}</div>`;
    }
  };
}

function renderReviewCard(){
  const panel = document.getElementById("review-panel");
  if(reviewQueue.length === 0 && !reviewLimitOverride){
    const totalSeen = Object.values(STATE.cards).filter(c=>c.seen).length;
    if(totalSeen === 0){
      panel.innerHTML = `
        <div class="empty-state">
          <div class="big">📭</div>
          <h2 class="section-title" style="justify-content:center;">Nada para revisar ainda</h2>
          <p class="lead">Você ainda não estudou nenhum conceito. Comece pela aba <b>Aprender</b>.</p>
          <button class="btn" style="margin-top:10px;" onclick="switchTab('aprender')">📖 Começar a aprender</button>
        </div>`;
      return;
    }
    if(reviewHiddenByLimit > 0){
      panel.innerHTML = `
        <div class="empty-state">
          <div class="big">🌤️</div>
          <h2 class="section-title" style="justify-content:center;">Meta diária de revisão concluída!</h2>
          <p class="lead">Ainda restam <b>${reviewHiddenByLimit}</b> carta(s) pendente(s) hoje, além do seu limite diário
          (ajustável na aba Progresso). Elas continuam guardadas — só não vencem, então não há problema em deixar para depois.</p>
          <div style="margin-top:14px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
            <button class="btn" id="review-override-btn">Revisar mesmo assim</button>
          </div>
        </div>`;
      const overrideBtn = document.getElementById("review-override-btn");
      if(overrideBtn) overrideBtn.onclick = ()=>{
        reviewLimitOverride = true;
        reviewQueue = orderReviewQueue(dueCards(), STATE.cards).slice(0, reviewHiddenByLimit);
        renderReviewCard();
      };
      return;
    }
    const upcoming = CONCEPTS
      .filter(c=>STATE.cards[c.id].seen)
      .map(c=>STATE.cards[c.id].nextReview)
      .sort()[0];
    panel.innerHTML = `
      <div class="empty-state">
        <div class="big">✅</div>
        <h2 class="section-title" style="justify-content:center;">Revisão em dia!</h2>
        <p class="lead">Nenhuma carta pendente hoje. ${upcoming ? `Próxima revisão programada para <b>${upcoming}</b>.` : ""}</p>
        <button class="btn secondary" style="margin-top:10px;" onclick="switchTab('aprender')">📖 Aprender mais conceitos</button>
      </div>`;
    return;
  }

  if(reviewQueue.length === 0 && reviewLimitOverride){
    panel.innerHTML = `
      <div class="empty-state">
        <div class="big">✅</div>
        <h2 class="section-title" style="justify-content:center;">Revisão concluída!</h2>
        <p class="lead">Você revisou todas as cartas disponíveis nesta sessão.</p>
      </div>`;
    return;
  }

  const c = reviewQueue[0];
  if(reviewMode === "constructed"){
    renderConstructedReviewCard(panel, c);
    return;
  }
  let confidence = null; // 1=baixa, 2=média, 3=alta

  panel.innerHTML = `
    <h2 class="section-title">🔁 Revisão espaçada</h2>
    ${reviewModeButtonsHtml()}
    <p class="lead" style="margin-top:-4px;">${reviewQueue.length} carta(s) restante(s) nesta sessão.</p>
    <div class="flash-outer">
      <div class="flashcard" id="flashcard">
        <div class="face front">
          <span class="concept-tag">${escapeHtml(c.tag)}</span>
          <div class="qtext">${escapeHtml(c.title)}</div>
          <div class="hint" id="flip-hint" style="display:none;">toque para virar</div>
        </div>
        <div class="face back">
          <div class="atext">${c.text}</div>
        </div>
      </div>
    </div>
    <div style="text-align:center;">${sourceLinkHtml(c)}${linkedNotesHtml(c)}${contentReportHtml()}</div>
    <div id="confidence-row">
      <p class="lead" style="text-align:center; margin-top:0;">Antes de ver a resposta: quão confiante você está de que lembra este conceito?</p>
      <div class="rate-row">
        <div class="rate-btn rate-again" data-conf="1">😟 Baixa<small>acho que não lembro</small></div>
        <div class="rate-btn rate-hard" data-conf="2">😐 Média<small>lembro em parte</small></div>
        <div class="rate-btn rate-easy" data-conf="3">😎 Alta<small>tenho certeza</small></div>
      </div>
    </div>
    <div id="rate-row" style="display:none;">
      <p class="lead" style="text-align:center; margin-top:0;">Como foi sua lembrança, de fato?</p>
      <div class="rate-row">
        <div class="rate-btn rate-again" data-q="1">Esqueci<small>revê amanhã</small></div>
        <div class="rate-btn rate-hard" data-q="3">Difícil<small>revê em breve</small></div>
        <div class="rate-btn rate-good" data-q="4">Bom<small>intervalo normal</small></div>
        <div class="rate-btn rate-easy" data-q="5">Fácil<small>intervalo maior</small></div>
      </div>
      <div id="calibration-msg"></div>
    </div>
  `;

  const flash = document.getElementById("flashcard");
  bindReviewModeButtons(panel);
  bindContentReport(panel, c);

  document.querySelectorAll("#confidence-row .rate-btn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      confidence = parseInt(btn.dataset.conf, 10);
      panel.querySelectorAll(".review-mode-btn").forEach(modeBtn=> modeBtn.disabled = true);
      document.getElementById("confidence-row").style.display = "none";
      flash.classList.add("flipped");
      document.getElementById("rate-row").style.display = "block";
    });
  });

  document.querySelectorAll("#rate-row .rate-btn").forEach(btn=>{
    btn.addEventListener("click", async (e)=>{
      e.stopPropagation();
      if(confidence === null) return; // segurança: não avalia sem julgamento prévio
      const q = parseInt(btn.dataset.q,10);
      const cardState = STATE.cards[c.id];
      cardState.lastConfidence = confidence;
      const elapsedDays = elapsedDaysSinceLastReview(cardState);
      fsrsUpdate(cardState, q);
      recordRetrievalEvidence(cardState, q >= RETRIEVAL_PASS_QUALITY, "review", q, confidence, elapsedDays);
      touchStreak();
      STATE.dailyProgress.reviewCount += 1;
      const xpGain = q===1?2:(q===3?5:(q===4?8:10));
      addXP(xpGain);

      // Calibração: confiança alta (3) presume acerto forte (q>=4); confiança baixa (1) presume falha (q<=1)
      const actuallyGood = q >= 4;
      const actuallyBad = q <= 1;
      let calibMsg = "";
      if(confidence === 3 && actuallyBad){
        STATE.calibration.overconfident += 1;
        recordError(cardState, "confidence_miscalibration", "review", "Confiança alta após falha de recuperação.");
        calibMsg = `<div class="feedback bad">🔎 Você estava confiante, mas não lembrou — esse conceito merece atenção extra.</div>`;
      } else if(confidence === 1 && actuallyGood){
        STATE.calibration.underconfident += 1;
        calibMsg = `<div class="feedback ok">✨ Você sabia mais do que pensava! Sua confiança pode subir aqui.</div>`;
      } else {
        STATE.calibration.aligned += 1;
        calibMsg = `<div class="feedback ok">🎯 Boa calibração — sua confiança bateu com o resultado.</div>`;
      }
      const msgBox = document.getElementById("calibration-msg");
      if(msgBox) msgBox.innerHTML = calibMsg;

      reviewQueue.shift();
      if(reviewQueue.length === 0){ STATE.reviewSessions += 1; }
      await saveState();
      checkBadges();
      renderHeader();
      setTimeout(()=> renderReviewCard(), msgBox ? 900 : 0);
    });
  });
}

/* ---- Explicar (Técnica de Feynman) ---- */
let explainCurrent = null;

// Ordem de prioridade do que é pedido para explicar. O vencimento vem primeiro:
// é o que fecha o ciclo entre a avaliação da explicação (que já alimenta o FSRS)
// e a cobrança seguinte. Antes esta função sorteava sem olhar nextReview, então
// um conceito vencido podia nunca voltar — a repetição espaçada agendava, mas
// nada consultava esse agendamento.
function pickExplainConcept(){
  const seen = CONCEPTS.filter(c => STATE.cards[c.id].seen);
  if(seen.length === 0) return null;

  const today = todayStr();
  // 1) vencidos, do mais atrasado para o menos
  const due = seen
    .filter(c => STATE.cards[c.id].nextReview <= today)
    .sort((a,b) => String(STATE.cards[a.id].nextReview).localeCompare(String(STATE.cards[b.id].nextReview)));
  if(due.length > 0) return due[0];

  // 2) nada vencido: conceitos que ainda nunca foram explicados
  const neverExplained = seen.filter(c => !STATE.cards[c.id].explainCount);
  if(neverExplained.length > 0) return neverExplained[Math.floor(Math.random()*neverExplained.length)];

  // 3) tudo em dia: revisão livre, sorteada
  return seen[Math.floor(Math.random()*seen.length)];
}

// Quantos conceitos estão vencidos e portanto serão pedidos antes dos demais.
function dueForExplanation(){
  const today = todayStr();
  return CONCEPTS.filter(c => STATE.cards[c.id].seen && STATE.cards[c.id].nextReview <= today);
}

function renderExplain(){
  explainCurrent = pickExplainConcept();
  renderExplainCard();
}

function renderExplainCard(){
  const panel = document.getElementById("explain-panel");
  if(!explainCurrent){
    panel.innerHTML = `
      <div class="empty-state">
        <div class="big">🗣️</div>
        <h2 class="section-title" style="justify-content:center;">Nada para explicar ainda</h2>
        <p class="lead">Aprenda pelo menos um conceito na aba <b>Aprender</b> antes de praticar a explicação.</p>
        <button class="btn" style="margin-top:10px;" onclick="switchTab('aprender')">📖 Começar a aprender</button>
      </div>`;
    return;
  }

  const c = explainCurrent;
  const cs = STATE.cards[c.id];
  panel.innerHTML = `
    <h2 class="section-title">🗣️ Técnica de Feynman</h2>
    <p class="lead" style="margin-top:-4px;">Explique o conceito abaixo com suas próprias palavras, como se estivesse ensinando alguém que nunca ouviu falar nisso. Não vale copiar frases prontas — o objetivo é você perceber sozinho(a) o que já entendeu bem e o que ainda está confuso.</p>
    <div class="concept-card">
      <span class="concept-tag">${escapeHtml(c.tag)}</span>
      <div class="concept-title">${escapeHtml(c.title)}</div>
      ${cs.explainCount > 0 ? `<p class="lead" style="margin-top:-6px;">Última nota: <b>${cs.lastExplainScore ?? "—"}/100</b> (tentativa ${cs.explainCount})</p>` : ""}
      ${cs.seen && cs.nextReview <= todayStr()
        ? `<p class="lead" style="margin-top:-6px;">🗣️ Este conceito voltou hoje${cs.explainCount > 0 ? " porque a última explicação indicou que ele ainda não estava firme" : ""}. Faltam ${Math.max(0, dueForExplanation().length - 1)} depois deste.</p>`
        : `<p class="lead" style="margin-top:-6px;">✅ Nada vencido no momento — este é um treino extra, por sua conta.</p>`}
      <textarea id="explain-input" class="explain-textarea" rows="6" placeholder="Comece explicando aqui, com suas próprias palavras..."></textarea>
      ${contentReportHtml()}
      <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px; gap:10px; flex-wrap:wrap;">
        <span class="lead" id="explain-charcount" style="margin:0; font-size:11.5px;">0 caracteres (mínimo ${EXPLANATION_MIN_LENGTH})</span>
        <button class="btn" id="explain-submit" disabled>🎓 Avaliar explicação</button>
      </div>
      <div id="explain-result"></div>
    </div>
  `;

  const input = document.getElementById("explain-input");
  const submitBtn = document.getElementById("explain-submit");
  const counter = document.getElementById("explain-charcount");
  input.addEventListener("input", ()=>{
    const len = input.value.trim().length;
    counter.textContent = `${len} caracteres (mínimo ${EXPLANATION_MIN_LENGTH})`;
    submitBtn.disabled = len < EXPLANATION_MIN_LENGTH;
  });
  submitBtn.addEventListener("click", ()=> handleExplainSubmit(c, input.value.trim()));
  bindContentReport(panel, c);
}

/**
 * Fluxo de submissão em duas fases — o invariante mais importante desta
 * etapa: o attempt é criado e PERSISTIDO (saveState) antes de qualquer
 * chamada de IA. Perda de rede, cota esgotada ou fechamento da aba depois
 * deste ponto nunca apaga o texto que o aluno escreveu.
 */
async function handleExplainSubmit(c, studentText){
  const resultBox = document.getElementById("explain-result");
  const submitBtn = document.getElementById("explain-submit");
  const cardState = STATE.cards[c.id];

  let attempt;
  try{
    attempt = createExplainAttempt(cardState, studentText);
  }catch(e){
    resultBox.innerHTML = `<div class="feedback bad" style="margin-top:12px;">${escapeHtml(e.message)}</div>`;
    return;
  }
  await saveState(); // INVARIANTE: persistido antes da IA (ver createExplainAttempt)

  // Capturado ANTES de evaluateExplainAttempt: createExplainAttempt não toca
  // em lastExplainScore, então este ainda é o valor da tentativa anterior.
  const previousScore = cardState.lastExplainScore;
  submitBtn.disabled = true;
  submitBtn.textContent = "Avaliando...";
  resultBox.innerHTML = `<p class="lead" style="margin-top:12px;">🧠 Analisando sua explicação...</p>`;

  await runExplainAttemptEvaluation(c, cardState, attempt, previousScore);
}

/**
 * Chama evaluateExplainAttempt (ou reavalia um attempt pendente/com falha
 * já existente — mesma função, mesmo caminho, ver item "avaliação
 * posterior"), persiste o resultado e renderiza de acordo com o status
 * final. FSRS/XP/contadores só rodam dentro de applyExplanationEvaluation,
 * chamada internamente por evaluateExplainAttempt SOMENTE quando a
 * avaliação é bem-sucedida — nunca antes disso.
 */
async function runExplainAttemptEvaluation(c, cardState, attempt, previousScore){
  const submitBtn = document.getElementById("explain-submit");
  await evaluateExplainAttempt(c, cardState, attempt.id);
  await saveState();

  if(attempt.status === "evaluated"){
    checkBadges();
    renderHeader();
  }

  renderExplainAttemptResult(c, attempt, previousScore);

  if(submitBtn){
    submitBtn.disabled = false;
    submitBtn.textContent = "🎓 Avaliar explicação";
  }
}

/**
 * Renderiza o resultado de acordo com attempt.status — substitui a antiga
 * renderExplainResult(). "pending_evaluation" (cota esgotada) e
 * "evaluation_failed" (falha técnica) mostram mensagens distintas, nunca
 * um erro genérico, e sempre com a opção de tentar avaliar de novo sem
 * perder o texto já escrito.
 */
function renderExplainAttemptResult(c, attempt, previousScore){
  const resultBox = document.getElementById("explain-result");
  if(!resultBox) return;

  if(attempt.status === "pending_evaluation"){
    resultBox.innerHTML = `
      <div class="feedback" style="margin-top:12px;">
        📩 Sua explicação foi salva e está aguardando avaliação. Isso costuma acontecer quando o limite mensal de avaliações de IA foi atingido — tente avaliar novamente mais tarde, sem precisar reescrever nada.
      </div>
      <button class="btn secondary" id="explain-retry" style="margin-top:10px;">🔄 Tentar avaliar novamente</button>
    `;
    bindExplainRetryButton(c, attempt, previousScore);
    return;
  }

  if(attempt.status === "evaluation_failed"){
    resultBox.innerHTML = `
      <div class="feedback bad" style="margin-top:12px;">
        ⚠️ Não foi possível avaliar sua explicação agora por um problema técnico. Sua resposta foi salva — você pode tentar avaliar novamente.
      </div>
      <button class="btn secondary" id="explain-retry" style="margin-top:10px;">🔄 Tentar avaliar novamente</button>
    `;
    bindExplainRetryButton(c, attempt, previousScore);
    return;
  }

  // status === "evaluated"
  const data = attempt.evaluation;
  const nota = data.score;

  const listHtml = (items, icon) => (items && items.length)
    ? `<ul style="margin:6px 0 0; padding-left:18px;">${items.map(i=>`<li style="margin-bottom:4px;">${icon} ${escapeHtml(i)}</li>`).join("")}</ul>`
    : `<p class="lead" style="margin:6px 0 0;">—</p>`;

  let comparisonHtml = "";
  if(previousScore != null){
    const delta = nota - previousScore;
    if(delta > 0){
      comparisonHtml = `<p class="lead" style="text-align:center; margin-top:-6px;">📈 Você foi de <b>${previousScore}</b> para <b>${nota}</b> — melhorou ${delta} ponto(s)!</p>`;
    } else if(delta < 0){
      comparisonHtml = `<p class="lead" style="text-align:center; margin-top:-6px;">📉 Você foi de <b>${previousScore}</b> para <b>${nota}</b> desta vez. Sem problema, isso também é informação útil.</p>`;
    } else {
      comparisonHtml = `<p class="lead" style="text-align:center; margin-top:-6px;">➡️ Mesma nota da última vez (${previousScore}).</p>`;
    }
  }

  const decisionLabel = {
    passed: "✅ Aprovado",
    retry_recommended: "🔁 Vale tentar de novo",
    return_to_comprehension: "📖 Vale voltar ao material"
  }[data.pedagogicalDecision] || "";

  resultBox.innerHTML = `
    <div style="margin-top:16px; padding-top:14px; border-top:1px dashed var(--border);">
      <div class="score-big" style="font-size:32px;">${nota}/100</div>
      <div class="progressbar" style="margin-bottom:10px;"><div style="width:${nota}%"></div></div>
      ${decisionLabel ? `<p class="lead" style="text-align:center; margin-top:-6px;">${decisionLabel}</p>` : ""}
      ${comparisonHtml}
      <p class="feedback ${nota>=70?'ok':'bad'}">${escapeHtml(data.feedback || "")}</p>
      ${data.centralMechanism ? `
        <div class="stat-card" style="margin-top:10px;">
          <div class="label">🔑 O mecanismo central deste conceito</div>
          <p class="lead" style="margin:6px 0 0;">${escapeHtml(data.centralMechanism)}</p>
          ${data.mechanismInText
            ? `<p class="lead" style="margin:6px 0 0;">✅ Você enunciou: “${escapeHtml(data.mechanismInText)}”</p>`
            : `<p class="lead" style="margin:6px 0 0;">➡️ Não encontrei no seu texto uma frase que diga <b>como</b> isso funciona — só os elementos envolvidos. É esse o próximo passo.</p>`}
        </div>` : ""}
      <div class="grid2" style="margin-top:10px;">
        <div class="stat-card">
          <div class="label">✅ Você cobriu</div>
          ${listHtml(data.coveredPoints, "✅")}
        </div>
        <div class="stat-card">
          <div class="label">⚠️ Ficou faltando</div>
          ${listHtml(data.missingPoints, "➡️")}
        </div>
      </div>
      ${data.imprecisions && data.imprecisions.length ? `
        <div class="stat-card" style="margin-top:10px;">
          <div class="label">🔎 Imprecisões (não invalidam o núcleo, mas vale ajustar)</div>
          ${listHtml(data.imprecisions, "🔎")}
        </div>` : ""}
      ${data.conceptualErrors && data.conceptualErrors.length ? `
        <div class="stat-card" style="margin-top:10px; border-color:var(--danger);">
          <div class="label">❗ Possíveis equívocos</div>
          ${listHtml(data.conceptualErrors, "❗")}
        </div>` : ""}
      <div id="explain-followup-section">${followUpSectionHtml(attempt)}</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:14px;">
        <button class="btn secondary" id="explain-retry-attempt">🔁 Tentar explicar novamente</button>
        <button class="btn" id="explain-next">Próximo conceito →</button>
      </div>
    </div>
  `;

  bindFollowUpSection(c, attempt);

  // "Tentar explicar novamente" reaproveita o textarea/botão originais
  // (acima do resultado) — cria um novo explainAttempt LIGADO a este via
  // previousAttemptId/attemptNumber (ver createExplainAttempt), sem
  // depender de pickExplainConcept() escolher este conceito de novo. O
  // diagnóstico permanece visível até o momento em que uma nova submissão
  // realmente começa (não some só por clicar em "tentar de novo").
  const retryAttemptBtn = document.getElementById("explain-retry-attempt");
  if(retryAttemptBtn){
    retryAttemptBtn.onclick = ()=>{
      const input = document.getElementById("explain-input");
      const submitBtn = document.getElementById("explain-submit");
      const counter = document.getElementById("explain-charcount");
      if(!input) return;
      input.value = "";
      if(counter) counter.textContent = `0 caracteres (mínimo ${EXPLANATION_MIN_LENGTH})`;
      if(submitBtn) submitBtn.disabled = true;
      input.focus();
      input.scrollIntoView({ behavior:"smooth", block:"center" });
    };
  }

  document.getElementById("explain-next").onclick = ()=>{
    renderExplain();
    renderHeader();
  };
}

/**
 * Pergunta de aprofundamento (evaluation.followUpQuestion) — sempre
 * presente numa avaliação bem-sucedida (ver api/_lib/explanationEvaluation.js,
 * garantida por fallback determinístico se a IA não mandar uma válida).
 * Exige elaboração escrita, sem chamada de IA para avaliar a resposta
 * nesta etapa (só gera, exibe, exige elaboração e persiste).
 */
function followUpSectionHtml(attempt){
  const question = attempt.evaluation && attempt.evaluation.followUpQuestion;
  if(!question) return "";
  if(attempt.followUp){
    return `
      <div class="stat-card" style="margin-top:10px;">
        <div class="label">🧩 Pergunta de aprofundamento</div>
        <p class="lead" style="margin:6px 0 0;">${escapeHtml(question)}</p>
        <p class="lead" style="margin:10px 0 0;"><b>Sua resposta:</b></p>
        <p class="lead" style="margin:4px 0 0; white-space:pre-wrap;">${escapeHtml(attempt.followUp.responseText)}</p>
      </div>`;
  }
  return `
    <div class="stat-card" style="margin-top:10px;">
      <div class="label">🧩 Pergunta de aprofundamento</div>
      <p class="lead" style="margin:6px 0 0;">${escapeHtml(question)}</p>
      <textarea id="explain-followup-input" class="explain-textarea" rows="3" placeholder="Escreva sua resposta aqui..." style="margin-top:8px;"></textarea>
      <button class="btn" id="explain-followup-submit" style="margin-top:8px;" disabled>Enviar resposta</button>
    </div>`;
}

function bindFollowUpSection(c, attempt){
  const input = document.getElementById("explain-followup-input");
  const submitBtn = document.getElementById("explain-followup-submit");
  if(!input || !submitBtn) return; // já respondida ou sem pergunta — nada para vincular

  input.addEventListener("input", ()=>{
    submitBtn.disabled = input.value.trim().length === 0;
  });
  submitBtn.onclick = async ()=>{
    const cardState = STATE.cards[c.id];
    try{
      recordExplainFollowUpResponse(cardState, attempt.id, input.value);
    }catch(e){
      console.error(e);
      return;
    }
    await saveState();
    const section = document.getElementById("explain-followup-section");
    if(section) section.innerHTML = followUpSectionHtml(attempt);
  };
}

function bindExplainRetryButton(c, attempt, previousScore){
  const retryBtn = document.getElementById("explain-retry");
  if(!retryBtn) return;
  retryBtn.onclick = async ()=>{
    retryBtn.disabled = true;
    retryBtn.textContent = "Avaliando...";
    const cardState = STATE.cards[c.id];
    await runExplainAttemptEvaluation(c, cardState, attempt, previousScore);
  };
}

/* ---- Quiz ---- */
let quizState = null;

function conceptWeakness(c){
  // Quanto maior, mais "fraco" (mais precisa de prática) o conceito está.
  const cs = STATE.cards[c.id];
  let w = Math.max(1, 5 - cs.reps); // menos repetições bem-sucedidas = mais peso
  if(cs.nextReview && cs.nextReview <= todayStr()) w += 3; // já venceu a revisão
  if(cs.lastExplainScore != null && cs.lastExplainScore < 60) w += 2; // explicou mal no modo Feynman
  if(cs.lastQuality != null && cs.lastQuality <= 2) w += 2; // última vez foi ruim
  return w;
}

function weightedSample(items, weightFn, n){
  const pool = items.map(it => ({ it, w: Math.max(0.0001, weightFn(it)) }));
  const result = [];
  while(result.length < n && pool.length > 0){
    const total = pool.reduce((s,p)=>s+p.w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for(; idx < pool.length; idx++){ r -= pool[idx].w; if(r <= 0) break; }
    idx = Math.min(idx, pool.length - 1);
    result.push(pool[idx].it);
    pool.splice(idx, 1);
  }
  return result;
}

function renderQuizStart(){
  const panel = document.getElementById("quiz-panel");
  const seenCount = CONCEPTS.filter(c => STATE.cards[c.id].seen).length;
  const adaptiveN = Math.min(10, seenCount);
  panel.innerHTML = `
    <h2 class="section-title">🎯 Quiz</h2>

    <div class="concept-card" style="margin-bottom:14px;">
      <div class="concept-title" style="font-size:15px;">🧠 Quiz Adaptativo</div>
      <p class="lead" style="margin-top:-2px;">Foca nos conceitos que ainda precisam de prática — prioriza os que erraram
      recentemente, tiveram pouca prática ou estão com revisão vencida. ${seenCount > 0
        ? `${adaptiveN} pergunta(s), sua melhor pontuação: <b>${STATE.quiz.bestAdaptive || 0}/${adaptiveN || "-"}</b>.`
        : "Aprenda ao menos 1 conceito para liberar este modo."}</p>
      <button class="btn" id="start-quiz-adaptive" ${seenCount === 0 ? "disabled" : ""}>🎯 Iniciar Quiz Adaptativo</button>
    </div>

    <div class="concept-card">
      <div class="concept-title" style="font-size:15px;">📋 Quiz Completo</div>
      <p class="lead" style="margin-top:-2px;">Um desafio com todos os ${CONCEPTS.length} conceitos deste módulo, em ordem aleatória.
      Sua melhor pontuação: <b>${STATE.quiz.best}/${CONCEPTS.length}</b>.</p>
      <button class="btn secondary" id="start-quiz-full">▶️ Iniciar Quiz Completo</button>
    </div>
  `;
  document.getElementById("start-quiz-full").onclick = ()=> startQuiz("full");
  const adaptiveBtn = document.getElementById("start-quiz-adaptive");
  if(adaptiveBtn) adaptiveBtn.onclick = ()=> startQuiz("adaptive");
}

function startQuiz(mode){
  mode = mode || "full";
  let order;
  if(mode === "adaptive"){
    const pool = CONCEPTS.filter(c => STATE.cards[c.id].seen);
    const n = Math.min(10, pool.length);
    order = weightedSample(pool, conceptWeakness, n);
  } else {
    order = shuffle(CONCEPTS);
  }
  quizState = { mode, order, index:0, correct:0, answered:false };
  renderQuizQuestion();
}
function renderQuizQuestion(){
  const panel = document.getElementById("quiz-panel");
  const {order, index, correct} = quizState;
  if(index >= order.length){ finishQuiz(); return; }
  const c = order[index];
  panel.innerHTML = `
    <div class="quiz-progress">
      <span>Pergunta ${index+1} de ${order.length}</span>
      <span>Acertos: ${correct}</span>
    </div>
    <div class="progressbar" style="margin-bottom:16px;"><div style="width:${(index/order.length)*100}%"></div></div>
    <div class="concept-card">
      <span class="concept-tag">${escapeHtml(c.tag)}</span>
      <div class="qtext" style="margin-top:8px;">${escapeHtml(c.q)}</div>
      <div id="quiz-opts" style="margin-top:12px;"></div>
      <div id="quiz-feedback"></div>
    </div>
  `;
  const optsWrap = document.getElementById("quiz-opts");
  const shuffledOptions = c.options.map((text,i)=>({text, isCorrect:i===c.correct}));
  shuffle(shuffledOptions).forEach(opt=>{
    const b = document.createElement("button");
    b.className = "opt";
    b.textContent = opt.text;
    b.onclick = ()=> handleQuizAnswer(c, opt.isCorrect, b, optsWrap);
    optsWrap.appendChild(b);
  });
}
async function handleQuizAnswer(c, isCorrect, btnEl, optsWrap){
  if(quizState.answered) return;
  quizState.answered = true;
  optsWrap.querySelectorAll(".opt").forEach(b=>{
    b.classList.add("disabled");
    if(b===btnEl) b.classList.add(isCorrect?"correct":"wrong");
  });
  if(isCorrect) quizState.correct++;

  const cardState = STATE.cards[c.id];
  if(cardState.seen){
    const elapsedDays = elapsedDaysSinceLastReview(cardState);
    fsrsUpdate(cardState, isCorrect ? 5 : 2);
    recordRetrievalEvidence(cardState, isCorrect, "quiz", isCorrect ? 5 : 2, null, elapsedDays);
  }
  await saveState();

  const fb = document.getElementById("quiz-feedback");
  fb.className = "feedback " + (isCorrect?"ok":"bad");
  fb.textContent = isCorrect ? "Correto!" : "Não foi dessa vez.";
  const nextBtn = document.createElement("button");
  nextBtn.className = "btn";
  nextBtn.style.marginTop = "12px";
  nextBtn.textContent = "Próxima →";
  nextBtn.onclick = ()=>{
    quizState.index++;
    quizState.answered = false;
    renderQuizQuestion();
  };
  fb.appendChild(document.createElement("br"));
  fb.appendChild(nextBtn);
}
async function finishQuiz(){
  const {order, correct, mode} = quizState;
  touchStreak();
  STATE.quiz.played += 1;
  if(mode === "adaptive"){
    STATE.quiz.bestAdaptive = Math.max(STATE.quiz.bestAdaptive || 0, correct);
  } else {
    STATE.quiz.best = Math.max(STATE.quiz.best, correct);
  }
  await saveState();
  checkBadges();
  renderHeader();

  const panel = document.getElementById("quiz-panel");
  panel.innerHTML = `
    <h2 class="section-title" style="justify-content:center;">🏁 Resultado — ${mode === "adaptive" ? "Quiz Adaptativo" : "Quiz Completo"}</h2>
    <div class="score-big">${correct} / ${order.length}</div>
    <p class="lead" style="text-align:center;">Reconhecer a alternativa certa é mais fácil do que explicar. Se quiser saber se entendeu mesmo, escreva o conceito na aba Explicar.</p>
    <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:10px;">
      <button class="btn" id="retry-quiz">🔁 Tentar novamente</button>
      <button class="btn secondary" onclick="switchTab('explicar')">🗣️ Ir para Explicar</button>
    </div>
  `;
  document.getElementById("retry-quiz").onclick = ()=> startQuiz(mode);
}

/* ---- Progresso ---- */
function renderProgress(){
  // Progresso deixou de ser pontuação e passou a ser capacidade de explicar:
  // quantos conceitos você já conseguiu enunciar bem, e quantos estão devendo.
  const explained = Object.values(STATE.cards).filter(c => c.lastExplainScore != null);
  const solid = explained.filter(c => c.lastExplainScore >= EXPLANATION_PASS_SCORE).length;
  const shaky = explained.length - solid;
  const neverExplained = Object.values(STATE.cards).filter(c => c.seen && c.lastExplainScore == null).length;
  const solidPct = CONCEPTS.length ? Math.round((solid / CONCEPTS.length) * 100) : 0;

  const levelNameEl = document.getElementById("prog-level-name");
  if(levelNameEl) levelNameEl.textContent = `${solid} de ${CONCEPTS.length} conceitos você já conseguiu explicar bem`;
  const xpBarEl = document.getElementById("prog-xp-bar");
  if(xpBarEl) xpBarEl.style.width = solidPct + "%";
  const xpTextEl = document.getElementById("prog-xp-text");
  if(xpTextEl){
    xpTextEl.textContent = explained.length === 0
      ? "Você ainda não explicou nenhum conceito. É a aba Explicar que move este número."
      : `${shaky} explicação(ões) ainda fraca(s) e ${neverExplained} conceito(s) vistos que você nunca tentou explicar.`;
  }

  const retained = Object.values(STATE.cards).filter(hasRetentionEvidence).length;
  const retentionEvidencePct = retentionEvidencePercentage(STATE.cards, CONCEPTS.length);
  const retentionEl = document.getElementById("prog-retention");
  if(retentionEl) retentionEl.textContent = retentionEvidencePct + "%";
  const retentionBarEl = document.getElementById("prog-retention-bar");
  if(retentionBarEl) retentionBarEl.style.width = retentionEvidencePct + "%";
  const retentionTextEl = document.getElementById("prog-retention-text");
  if(retentionTextEl) retentionTextEl.textContent = `${retained} de ${CONCEPTS.length} com recuperação e explicação verificadas. A transferência prática ainda não foi verificada.`;

  // Badges saíram da interface junto com a gamificação.
  const badgesGrid = document.getElementById("badges-grid");
  if(badgesGrid){
    const badgesPanel = badgesGrid.closest(".panel");
    if(badgesPanel) badgesPanel.style.display = "none";
  }

  const list = document.getElementById("concept-list");
  list.innerHTML = "";
  CONCEPTS.forEach(c=>{
    const st = conceptStatus(c);
    const cs = STATE.cards[c.id];
    const row = document.createElement("div");
    row.className = "concept-row";
    row.innerHTML = `
      <div>
        <div style="font-weight:700;">${escapeHtml(c.title)}</div>
        <div style="color:var(--text-dim); font-size:11.5px;">${cs.seen
          ? (cs.lastExplainScore != null
              ? `Última explicação: ${cs.lastExplainScore}/100 · volta em ${cs.nextReview}`
              : `Nunca explicado · volta em ${cs.nextReview}`)
          : "Ainda não apresentado"}</div>
      </div>
      <span class="status-chip ${st.cls}">${st.label}</span>
    `;
    list.appendChild(row);
  });

  const calibAlignedEl = document.getElementById("calib-aligned");
  const calibOverEl = document.getElementById("calib-over");
  const calibUnderText = document.getElementById("calib-under-text");
  if(calibAlignedEl) calibAlignedEl.textContent = STATE.calibration.aligned;
  if(calibOverEl) calibOverEl.textContent = STATE.calibration.overconfident;
  if(calibUnderText){
    const totalJudg = STATE.calibration.aligned + STATE.calibration.overconfident + STATE.calibration.underconfident;
    calibUnderText.textContent = totalJudg > 0
      ? `Também houve ${STATE.calibration.underconfident} vez(es) em que você sabia mais do que pensava, de um total de ${totalJudg} julgamentos.`
      : "Ainda sem dados — faça algumas revisões na aba Revisar para começar a ver sua calibração aqui.";
  }

  const newLimitInput = document.getElementById("setting-new-limit");
  const reviewLimitInput = document.getElementById("setting-review-limit");
  if(newLimitInput) newLimitInput.value = STATE.settings.dailyNewLimit;
  if(reviewLimitInput) reviewLimitInput.value = STATE.settings.dailyReviewLimit;
  const saveBtn = document.getElementById("save-settings-btn");
  if(saveBtn){
    saveBtn.onclick = async ()=>{
      const newVal = Math.max(1, parseInt(newLimitInput.value,10) || 5);
      const reviewVal = Math.max(0, parseInt(reviewLimitInput.value,10) || 0);
      STATE.settings.dailyNewLimit = newVal;
      STATE.settings.dailyReviewLimit = reviewVal;
      await saveState();
      showToast("⚙️ Metas diárias salvas");
    };
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// Renderiza o resumo do módulo (CONFIG.homeIntro) como texto formatado: linhas
// normais viram parágrafos, linhas começando com "• " viram itens de lista —
// para o resumo gerado por IA (introdução + tópicos principais) aparecer
// como uma lista de verdade, em vez de tudo grudado numa linha só.
function renderHomeIntroHtml(text){
  if(!text) return "";
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  let html = "";
  let inList = false;
  lines.forEach(line=>{
    const isBullet = /^[•\-*]\s+/.test(line);
    const content = escapeHtml(line.replace(/^[•\-*]\s+/, ""));
    if(isBullet){
      if(!inList){ html += "<ul>"; inList = true; }
      html += `<li>${content}</li>`;
    } else {
      if(inList){ html += "</ul>"; inList = false; }
      html += `<p>${content}</p>`;
    }
  });
  if(inList) html += "</ul>";
  return html;
}

function applyConfigToDOM(){
  document.title = CONFIG.appTitle;
  const setText = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
  setText("app-logo", CONFIG.logoEmoji);
  setText("app-title", CONFIG.appTitle);
  setText("app-subtitle", CONFIG.appSubtitle);
  const introEl = document.getElementById("home-intro-text");
  if(introEl) introEl.innerHTML = renderHomeIntroHtml(CONFIG.homeIntro);
  const footer = document.getElementById("footer-credit");
  if(footer) footer.innerHTML = escapeHtml(CONFIG.sourceCredit || "") + "<br>Progresso salvo automaticamente.";
}

/* =====================================================================
   PONTO DE ENTRADA — chamado por app.html depois de buscar o JSON
   do módulo (CONFIG + CONCEPTS) em /content.
   ===================================================================== */
// T2: garante que o progresso pendente (ainda não gravado no Firestore
// por causa do debounce em storage.js) não se perde em situações onde a
// pessoa não passa por switchTab — minimizar a aba, trocar de app no
// celular, fechar a aba, navegar pra outro módulo. "visibilitychange"
// cobre a imensa maioria dos casos (dispara ao minimizar/trocar de aba/
// app, e também antes da navegação sair da página, na prática, na
// maioria dos navegadores); "pagehide" é a rede de segurança adicional
// pro caso de navegação/fechamento que "visibilitychange" não pegar —
// de propósito NÃO depende só de "beforeunload" (que não é confiável em
// mobile e é cada vez mais restrito por navegadores modernos).
let flushListenersBound = false;
function bindStateFlushListeners(){
  if(flushListenersBound) return;
  flushListenersBound = true;
  const flushNow = ()=>{
    if(!CONFIG || typeof StorageAdapter === "undefined" || !StorageAdapter.flush) return;
    StorageAdapter.flush(CONFIG.storageKey).catch(()=>{});
  };
  document.addEventListener("visibilitychange", ()=>{
    if(document.hidden) flushNow();
  });
  window.addEventListener("pagehide", flushNow);
}

async function initApp(config, concepts, sourceMaterialId, moduleId, linkedNotes){
  CONFIG = config;
  CONCEPTS = concepts;
  SOURCE_MATERIAL_ID = sourceMaterialId || null;
  MODULE_ID = moduleId || null;
  LINKED_NOTES = Array.isArray(linkedNotes) ? linkedNotes : [];
  STATE = await loadState();
  bindTabs();
  bindStateFlushListeners();
  applyConfigToDOM();
  renderHeader();
  renderProgress();
  switchTab("inicio");
}
