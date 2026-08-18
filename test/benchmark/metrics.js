/* =====================================================================
   MÉTRICAS — benchmark de qualidade pedagógica da avaliação semântica.
   =====================================================================
   Funções puras, sem I/O e sem dependência da API de IA — operam sobre
   um array de "resultados" já produzidos por um runner (real ou
   fabricado em teste):

   { id, domain, expected, actual, confidence, reason }

   `expected`/`actual` devem ser uma das CLASSES ("incorrect"|"partial"
   |"correct") ou null (falha da IA — timeout/erro/output inválido).
   Resultados com `actual` fora do enum são ignorados no cálculo de
   accuracy/confusion matrix (mas continuam contáveis como falha pelo
   runner, fora deste módulo).
   ===================================================================== */

export const CLASSES = Object.freeze(["incorrect", "partial", "correct"]);
const ORDER = Object.freeze({ incorrect: 0, partial: 1, correct: 2 });

function isValidClass(v) {
  return CLASSES.includes(v);
}

/**
 * Matriz de confusão: matrix[expected][actual] = contagem.
 * Ignora resultados cujo expected/actual não seja uma classe válida.
 */
export function buildConfusionMatrix(results) {
  const matrix = {};
  for (const e of CLASSES) {
    matrix[e] = {};
    for (const a of CLASSES) matrix[e][a] = 0;
  }
  for (const r of results || []) {
    if (!isValidClass(r.expected) || !isValidClass(r.actual)) continue;
    matrix[r.expected][r.actual] += 1;
  }
  return matrix;
}

/** Accuracy geral, só sobre os resultados com actual válido (exclui falhas de IA). */
export function computeAccuracy(results) {
  const valid = (results || []).filter((r) => isValidClass(r.actual) && isValidClass(r.expected));
  if (!valid.length) return 0;
  const correct = valid.filter((r) => r.expected === r.actual).length;
  return correct / valid.length;
}

/** precision/recall/F1/support por classe, a partir da matriz de confusão. */
export function computeClassMetrics(results) {
  const matrix = buildConfusionMatrix(results);
  const metrics = {};
  for (const cls of CLASSES) {
    let tp = 0, fp = 0, fn = 0;
    for (const e of CLASSES) {
      for (const a of CLASSES) {
        const count = matrix[e][a];
        if (e === cls && a === cls) tp += count;
        else if (e !== cls && a === cls) fp += count;
        else if (e === cls && a !== cls) fn += count;
      }
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    const support = CLASSES.reduce((sum, a) => sum + matrix[cls][a], 0);
    metrics[cls] = { precision, recall, f1, support, truePositives: tp, falsePositives: fp, falseNegatives: fn };
  }
  return metrics;
}

/**
 * Métrica de risco mais importante: casos cujo ground truth é "partial"
 * ou "incorrect", mas a IA classificou como "correct" — falsa evidência
 * de aprendizagem completa.
 */
export function findFalseCorrect(results) {
  return (results || []).filter(
    (r) => (r.expected === "partial" || r.expected === "incorrect") && r.actual === "correct"
  );
}

/** Casos corretos classificados como "incorrect" — falso negativo. */
export function findFalseIncorrect(results) {
  return (results || []).filter((r) => r.expected === "correct" && r.actual === "incorrect");
}

/**
 * Severidade de uma divergência: "none" (acertou), "mild" (classes
 * adjacentes: correct<->partial ou partial<->incorrect), "severe"
 * (extremos: incorrect<->correct). Retorna null se expected/actual
 * não forem classes válidas (ex.: falha de IA).
 */
export function classifySeverity(expected, actual) {
  if (!isValidClass(expected) || !isValidClass(actual)) return null;
  if (expected === actual) return "none";
  const diff = Math.abs(ORDER[expected] - ORDER[actual]);
  return diff === 2 ? "severe" : "mild";
}

/** Contagem agregada de severidade, destacando incorrect->correct e correct->incorrect. */
export function summarizeSeverity(results) {
  const summary = { mild: 0, severe: 0, severeIncorrectToCorrect: 0, severeCorrectToIncorrect: 0 };
  for (const r of results || []) {
    const sev = classifySeverity(r.expected, r.actual);
    if (sev === "mild") summary.mild += 1;
    else if (sev === "severe") {
      summary.severe += 1;
      if (r.expected === "incorrect" && r.actual === "correct") summary.severeIncorrectToCorrect += 1;
      if (r.expected === "correct" && r.actual === "incorrect") summary.severeCorrectToIncorrect += 1;
    }
  }
  return summary;
}

/** Accuracy e contagem por domínio (ex.: "Biologia", "Física", ...). */
export function aggregateByDomain(results) {
  const byDomain = {};
  for (const r of results || []) {
    if (!byDomain[r.domain]) byDomain[r.domain] = [];
    byDomain[r.domain].push(r);
  }
  const out = {};
  for (const [domain, list] of Object.entries(byDomain)) {
    out[domain] = { total: list.length, accuracy: computeAccuracy(list) };
  }
  return out;
}

/**
 * Estatísticas de confidence — não implementa threshold, só mede, para
 * uso exploratório futuro (ver item 7/9 do escopo do benchmark).
 */
export function computeConfidenceStats(results) {
  const valid = (results || []).filter((r) => isValidClass(r.actual) && isValidClass(r.expected) && Number.isFinite(r.confidence));
  const correctPreds = valid.filter((r) => r.expected === r.actual);
  const wrongPreds = valid.filter((r) => r.expected !== r.actual);
  const falseCorrect = findFalseCorrect(valid);
  const avg = (arr) => (arr.length ? arr.reduce((s, r) => s + r.confidence, 0) / arr.length : null);
  const highConfidenceFalseCorrect = falseCorrect.filter((r) => r.confidence >= 0.8);
  return {
    avgConfidenceCorrectPredictions: avg(correctPreds),
    avgConfidenceWrongPredictions: avg(wrongPreds),
    avgConfidenceFalseCorrect: avg(falseCorrect),
    highConfidenceFalseCorrectCount: highConfidenceFalseCorrect.length,
    highConfidenceFalseCorrectCases: highConfidenceFalseCorrect
  };
}

/**
 * Monta o pacote completo de métricas usado pelo relatório — agrupa
 * todas as funções acima para não obrigar o runner a chamar cada uma
 * separadamente.
 */
export function computeAllMetrics(results) {
  return {
    total: (results || []).length,
    accuracy: computeAccuracy(results),
    classMetrics: computeClassMetrics(results),
    confusionMatrix: buildConfusionMatrix(results),
    falseCorrect: findFalseCorrect(results),
    falseIncorrect: findFalseIncorrect(results),
    severity: summarizeSeverity(results),
    byDomain: aggregateByDomain(results),
    confidence: computeConfidenceStats(results)
  };
}
