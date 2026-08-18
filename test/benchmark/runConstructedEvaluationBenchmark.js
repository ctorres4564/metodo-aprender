#!/usr/bin/env node
/* =====================================================================
   RUNNER — benchmark de qualidade pedagógica da avaliação semântica de
   resposta construída (Prioridade 3).
   =====================================================================
   Reutiliza evaluateConstructedResponse() de api/_lib/constructedEvaluation.js
   — a MESMA função chamada em produção por api/avaliar-resposta-construida.js.
   Este arquivo NÃO implementa um segundo classificador: só monta os
   argumentos a partir do dataset, chama a função real, e mede a
   qualidade das respostas.

   NÃO roda como parte de `npm test` (não é *.test.js) — é um script
   manual que faz chamadas reais e pagas à OpenRouter. Ver "como
   executar" no final deste arquivo.

   Execução sequencial de propósito (sem Promise.all/paralelismo
   agressivo): evita estourar rate limit da OpenRouter, evita
   concentrar custo numa rajada, e produz resultados mais estáveis
   (menos chance de contenção/instabilidade sob concorrência).
   ===================================================================== */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { evaluateConstructedResponse, DEFAULT_MODEL } from "../../api/_lib/constructedEvaluation.js";
import { DATASET, DATASET_VERSION } from "./constructedResponseDataset.js";
import { DATASET_V2, DATASET_VERSION as DATASET_VERSION_V2 } from "./constructedResponseDatasetV2.js";
import { computeAllMetrics } from "./metrics.js";

// Seleção de versão do dataset via env var — só usada pela CLI (abaixo),
// nunca muda o comportamento de quem importa runBenchmark() diretamente
// com seu próprio `dataset`. Default "v1" preserva o comportamento
// existente; "v2" habilita a comparação direta v1 -> v2 quando alguém
// decidir rodar o benchmark real da v2 (ver "como executar" no final
// deste arquivo) — nenhuma chamada é feita só por este arquivo existir.
const DATASET_VERSIONS = { v1: { dataset: DATASET, version: DATASET_VERSION }, v2: { dataset: DATASET_V2, version: DATASET_VERSION_V2 } };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Critérios EXPLORATÓRIOS de referência (item 9 do escopo) — nunca
// alteram produção automaticamente, só aparecem no relatório como
// "atingiu" ou "não atingiu".
export const QUALITY_REFERENCE = Object.freeze({
  minAccuracy: 0.85,
  maxFalseCorrectRate: 0.05,
  preferredMaxFalseCorrectRate: 0.02
});

/**
 * Monta os argumentos enviados a evaluateConstructedResponse a partir
 * de UM caso do dataset — função pura, sem I/O, testável sem rede.
 *
 * IMPORTANTE: só extrai prompt/referenceAnswer/studentAnswer. Nunca
 * inclui id/domain/caseType/expectedClassification/rationale — o
 * modelo nunca deve ver o ground truth nem a justificativa do dataset.
 */
export function buildEvaluationArgs(testCase, { apiKey, model } = {}) {
  return {
    apiKey,
    model,
    conceptTitle: testCase.prompt,
    referenceText: testCase.referenceAnswer,
    responseText: testCase.studentAnswer
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executa o dataset inteiro, sequencialmente, contra a função real de
 * avaliação semântica. Retorna { results, metrics, meta }.
 *
 * `onProgress(caseResult, index, total)` é opcional, chamado após cada
 * caso — útil pro CLI imprimir progresso sem acoplar a lógica de I/O
 * aqui dentro.
 */
export async function runBenchmark({
  apiKey,
  model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
  dataset = DATASET,
  // Default é sempre a v1 — não tenta "adivinhar" a versão pela
  // identidade do array de `dataset` (frágil: um `.slice()` já quebraria
  // isso). Quem passa um dataset diferente (ex.: DATASET_V2) deve passar
  // `datasetVersion` explicitamente — é o que a CLI abaixo já faz.
  datasetVersion = DATASET_VERSION,
  delayMs = 250,
  onProgress
} = {}) {
  if (!apiKey) throw new Error("apiKey obrigatória (ex.: process.env.OPENROUTER_API_KEY).");

  const results = [];
  for (let i = 0; i < dataset.length; i++) {
    const testCase = dataset[i];
    const args = buildEvaluationArgs(testCase, { apiKey, model });
    const startedAt = Date.now();
    let result;
    try {
      const aiResult = await evaluateConstructedResponse(args);
      result = {
        id: testCase.id,
        domain: testCase.domain,
        caseType: testCase.caseType,
        boundary: testCase.boundary,
        expected: testCase.expectedClassification,
        actual: aiResult.classification,
        confidence: aiResult.confidence,
        reason: aiResult.reason,
        model: aiResult.model,
        error: null,
        latencyMs: Date.now() - startedAt,
        referenceAnswer: testCase.referenceAnswer,
        studentAnswer: testCase.studentAnswer
      };
    } catch (e) {
      // Falha (timeout/rede/HTTP/parse) não interrompe o benchmark — o
      // caso fica registrado com actual:null e é excluído das métricas
      // de classificação, mas contabilizado como falha no relatório.
      result = {
        id: testCase.id,
        domain: testCase.domain,
        caseType: testCase.caseType,
        boundary: testCase.boundary,
        expected: testCase.expectedClassification,
        actual: null,
        confidence: null,
        reason: null,
        model,
        error: { code: e && e.code, message: e && e.message },
        latencyMs: Date.now() - startedAt,
        referenceAnswer: testCase.referenceAnswer,
        studentAnswer: testCase.studentAnswer
      };
    }
    results.push(result);
    if (onProgress) onProgress(result, i, dataset.length);
    if (delayMs > 0 && i < dataset.length - 1) await sleep(delayMs);
  }

  const failures = results.filter((r) => r.actual === null);
  const metrics = computeAllMetrics(results);

  const meta = {
    datasetVersion,
    caseCount: dataset.length,
    failureCount: failures.length,
    modelRequested: model,
    executedAt: new Date().toISOString(),
    config: { maxTokens: 300, delayMsBetweenCalls: delayMs, execution: "sequential" }
  };

  return { results, metrics, meta };
}

function pct(x) {
  return x == null ? "—" : `${(x * 100).toFixed(1)}%`;
}

function fmtConfidence(x) {
  return x == null ? "—" : x.toFixed(3);
}

/** Monta o relatório em Markdown a partir do resultado de runBenchmark(). */
export function formatReport({ results, metrics, meta }) {
  const lines = [];
  lines.push(`# Benchmark — avaliação semântica de resposta construída`);
  lines.push("");
  lines.push(`## Reprodutibilidade`);
  lines.push(`- Dataset: \`${meta.datasetVersion}\` (${meta.caseCount} casos)`);
  lines.push(`- Modelo solicitado: \`${meta.modelRequested}\``);
  lines.push(`- Executado em: ${meta.executedAt}`);
  lines.push(`- Configuração: maxTokens=${meta.config.maxTokens}, execução ${meta.config.execution}, intervalo entre chamadas ${meta.config.delayMsBetweenCalls}ms`);
  lines.push(`- Falhas de IA (timeout/rede/HTTP/parse, excluídas das métricas de classificação): ${meta.failureCount}`);
  lines.push("");

  lines.push(`## Resumo`);
  lines.push(`- Total de casos: ${metrics.total}`);
  lines.push(`- Accuracy geral: ${pct(metrics.accuracy)}`);
  lines.push(`- Distribuição esperada: correct=${metrics.classMetrics.correct.support}, partial=${metrics.classMetrics.partial.support}, incorrect=${metrics.classMetrics.incorrect.support}`);
  lines.push(`- Divergências: leves (classes adjacentes)=${metrics.severity.mild}, graves (extremos)=${metrics.severity.severe}`);
  lines.push(`- **false_correct** (partial/incorrect classificado como correct): ${metrics.falseCorrect.length} (${pct(metrics.falseCorrect.length / metrics.total)})`);
  lines.push(`- **false_incorrect** (correct classificado como incorrect): ${metrics.falseIncorrect.length} (${pct(metrics.falseIncorrect.length / metrics.total)})`);
  lines.push(`- incorrect→correct (subconjunto mais grave de false_correct): ${metrics.severity.severeIncorrectToCorrect}`);
  lines.push("");

  lines.push(`## Critério inicial de qualidade (exploratório, não é regra de produção)`);
  const accOk = metrics.accuracy >= QUALITY_REFERENCE.minAccuracy;
  const falseCorrectRate = metrics.falseCorrect.length / metrics.total;
  const falseCorrectOk = falseCorrectRate <= QUALITY_REFERENCE.maxFalseCorrectRate;
  const falseCorrectPreferred = falseCorrectRate <= QUALITY_REFERENCE.preferredMaxFalseCorrectRate;
  lines.push(`- accuracy >= ${pct(QUALITY_REFERENCE.minAccuracy)}: ${accOk ? "ATINGIU" : "NÃO ATINGIU"} (${pct(metrics.accuracy)})`);
  lines.push(`- false_correct <= ${pct(QUALITY_REFERENCE.maxFalseCorrectRate)}: ${falseCorrectOk ? "ATINGIU" : "NÃO ATINGIU"} (${pct(falseCorrectRate)})`);
  lines.push(`- false_correct <= ${pct(QUALITY_REFERENCE.preferredMaxFalseCorrectRate)} (preferencial): ${falseCorrectPreferred ? "ATINGIU" : "não atingiu"}`);
  lines.push("");

  lines.push(`## Precision / recall / F1 por classe`);
  lines.push(`| classe | precision | recall | F1 | support |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const cls of ["correct", "partial", "incorrect"]) {
    const m = metrics.classMetrics[cls];
    lines.push(`| ${cls} | ${pct(m.precision)} | ${pct(m.recall)} | ${pct(m.f1)} | ${m.support} |`);
  }
  lines.push("");

  lines.push(`## Confusion matrix (linha = esperado, coluna = retornado pela IA)`);
  lines.push(`| esperado \\ retornado | incorrect | partial | correct |`);
  lines.push(`| --- | --- | --- | --- |`);
  for (const e of ["incorrect", "partial", "correct"]) {
    lines.push(`| ${e} | ${metrics.confusionMatrix[e].incorrect} | ${metrics.confusionMatrix[e].partial} | ${metrics.confusionMatrix[e].correct} |`);
  }
  lines.push("");

  lines.push(`## Confidence`);
  lines.push(`- Confidence média nos acertos: ${fmtConfidence(metrics.confidence.avgConfidenceCorrectPredictions)}`);
  lines.push(`- Confidence média nos erros: ${fmtConfidence(metrics.confidence.avgConfidenceWrongPredictions)}`);
  lines.push(`- Confidence média nos false_correct: ${fmtConfidence(metrics.confidence.avgConfidenceFalseCorrect)}`);
  lines.push(`- false_correct com confidence >= 0.8: ${metrics.confidence.highConfidenceFalseCorrectCount}`);
  lines.push("");

  lines.push(`## Riscos — incorrect→correct e partial→correct`);
  if (metrics.falseCorrect.length === 0) {
    lines.push(`Nenhum caso de false_correct nesta execução.`);
  } else {
    for (const r of metrics.falseCorrect) {
      lines.push(`### ${r.id} (${r.domain}) — esperado \`${r.expected}\`, retornado \`${r.actual}\``);
      lines.push(`- Resposta de referência: ${r.referenceAnswer}`);
      lines.push(`- Resposta do estudante: ${r.studentAnswer}`);
      lines.push(`- Confidence: ${fmtConfidence(r.confidence)}`);
      lines.push(`- Reason (IA): ${r.reason}`);
      lines.push("");
    }
  }

  lines.push(`## Casos difíceis (divergências entre classes adjacentes)`);
  const mildCases = results.filter((r) => r.actual !== null && r.expected !== r.actual && Math.abs(["incorrect", "partial", "correct"].indexOf(r.expected) - ["incorrect", "partial", "correct"].indexOf(r.actual)) === 1);
  if (mildCases.length === 0) {
    lines.push(`Nenhuma divergência leve nesta execução.`);
  } else {
    for (const r of mildCases) {
      lines.push(`- \`${r.id}\` (${r.domain}, ${r.caseType}): esperado \`${r.expected}\` → retornado \`${r.actual}\` (confidence ${fmtConfidence(r.confidence)})`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------
// CLI — só executa se este arquivo for chamado diretamente (não quando
// importado por dataset.test.js/metrics.test.js ou por outro módulo).
// ---------------------------------------------------------------------
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("OPENROUTER_API_KEY não definida. Exporte a variável antes de rodar o benchmark:");
    console.error("  OPENROUTER_API_KEY=sk-... node test/benchmark/runConstructedEvaluationBenchmark.js");
    process.exit(1);
  }

  const versionKey = (process.env.BENCHMARK_DATASET_VERSION || "v1").toLowerCase();
  const selected = DATASET_VERSIONS[versionKey];
  if (!selected) {
    console.error(`BENCHMARK_DATASET_VERSION inválida: "${versionKey}". Use "v1" ou "v2".`);
    process.exit(1);
  }

  const total = selected.dataset.length;
  console.log(`Rodando benchmark (${selected.version}, ${total} casos, sequencial, ~250ms entre chamadas)...`);

  runBenchmark({
    apiKey,
    dataset: selected.dataset,
    datasetVersion: selected.version,
    onProgress: (result, index) => {
      const status = result.actual === null ? `FALHA(${result.error.code || "erro"})` : result.expected === result.actual ? "ok" : `diverg: ${result.expected}->${result.actual}`;
      console.log(`[${index + 1}/${total}] ${result.id}: ${status}`);
    }
  })
    .then(({ results, metrics, meta }) => {
      const report = formatReport({ results, metrics, meta });
      const outDir = path.resolve(__dirname, "results");
      mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, `${versionKey}-${meta.executedAt.replace(/[:.]/g, "-")}.md`);
      writeFileSync(outPath, report, "utf8");

      console.log("");
      console.log(report);
      console.log("");
      console.log(`Relatório salvo em: ${outPath}`);
    })
    .catch((e) => {
      console.error("Falha ao rodar o benchmark:", e);
      process.exit(1);
    });
}

/* =====================================================================
   COMO EXECUTAR (não roda em `npm test` nem em CI — é manual e faz
   chamadas reais/pagas à OpenRouter):

     OPENROUTER_API_KEY=sk-... node test/benchmark/runConstructedEvaluationBenchmark.js

   Roda o dataset v1 por padrão (comportamento inalterado). Para rodar o
   v2 (prompt e dataset revisados após a auditoria do v1) e comparar:

     OPENROUTER_API_KEY=sk-... BENCHMARK_DATASET_VERSION=v2 node test/benchmark/runConstructedEvaluationBenchmark.js

   Opcional: OPENROUTER_MODEL=algum/modelo para trocar o modelo padrão
   (DEFAULT_MODEL em api/_lib/constructedEvaluation.js).

   O relatório em Markdown é salvo em test/benchmark/results/ (fora do
   git — ver .gitignore, prefixado com "v1-"/"v2-") e também impresso no
   terminal.
   ===================================================================== */
