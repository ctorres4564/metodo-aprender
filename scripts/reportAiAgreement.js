#!/usr/bin/env node
/* =====================================================================
   RELATÓRIO — concordância entre autoavaliação e avaliação semântica da
   IA em uso real (experimento pedagógico controlado, Prioridade 4).
   =====================================================================
   Script de DESENVOLVIMENTO/ADMIN, só leitura, executado manualmente por
   quem tem a credencial de administrador do Firebase (FIREBASE_SERVICE_
   ACCOUNT) ou, em teste, contra o Firestore Emulator. NÃO é uma tela do
   app, não é chamado por nenhum fluxo do estudante, e NÃO grava nada de
   volta no Firestore — é puramente um relatório agregado sobre dados já
   persistidos por STATE.cards[...].retrievalAttempts (ver
   recordConstructedResponseAttempt / attachAiEvaluationToAttempt em
   assets/engine.js).

   Reaproveita — nunca duplica — a lógica já implementada e testada em
   assets/engine.js: deriveUserClassificationFromAttempt,
   buildAiAgreementRecord, collectAiAgreementRecords,
   buildAgreementConfusionMatrix, computeAiAgreementStats,
   computeAiEvaluationCoverage, aggregateAiAgreementByDomain,
   findAiAgreementDivergences, findCriticalAiAgreementCombinations. Esse
   arquivo é carregado num sandbox Node (mesma técnica de
   test/helpers/loadEngineFsrs.js) — não é reescrito nem importado como
   módulo, porque engine.js é um script de navegador comum.

   IMPORTANTE — o que esta matriz mede (e o que NÃO mede): compara a
   classificação da IA com a AUTOAVALIAÇÃO do usuário, nunca com um
   "gabarito objetivo". O estudante também pode se autoavaliar de forma
   incorreta. Os números aqui são concordância IA×autoavaliação, um dado
   complementar ao benchmark controlado (test/benchmark/) — não um
   substituto, e não uma medida de accuracy real da IA.

   Preserva a arquitetura existente de armazenamento local-por-usuário
   (coleção "progress" do Firestore, um documento por uid+storageKey — ver
   assets/firebase-init.js): este script só LÊ documentos que já existem,
   não cria nenhuma coleção nova nem agregação persistida centralizada.
   Mesmo padrão de leitura ampla via Admin SDK já usado por
   api/enviar-lembretes.js (cron que também varre a coleção "progress").

   PRIVACIDADE: nunca lê nem imprime responseText, o texto de referência,
   o "reason" completo da IA, e-mail, nome ou qualquer dado pessoal — só
   classes, confidence, conceptId, domínio/tag e timestamps (ver
   buildAiAgreementRecord em assets/engine.js, que já constrói o registro
   sem esses campos). O uid é usado só para consultar o Firestore, nunca
   aparece no relatório impresso.
   ===================================================================== */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { adminDb } from "../api/_lib/firebaseAdmin.js";
import { loadEngineFsrs } from "../test/helpers/loadEngineFsrs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.resolve(__dirname, "../content");

/**
 * Mapa conceptId -> tag a partir do catálogo estático (content/*.json,
 * exceto catalog.json, que é só o índice). Só leitura de arquivos locais
 * do repositório — nenhuma chamada de rede.
 */
export function loadStaticConceptTags(contentDir = CONTENT_DIR){
  const map = {};
  let files = [];
  try{
    files = readdirSync(contentDir);
  }catch(e){
    return map;
  }
  for(const file of files){
    if(!file.endsWith(".json") || file === "catalog.json") continue;
    try{
      const data = JSON.parse(readFileSync(path.join(contentDir, file), "utf8"));
      for(const c of (data.concepts || [])){
        if(c && c.id) map[c.id] = c.tag || null;
      }
    }catch(e){
      console.error(`Falha ao ler ${file} do catálogo estático (ignorado):`, e.message);
    }
  }
  return map;
}

/**
 * Mapa conceptId -> tag a partir dos módulos criados pelo próprio usuário
 * (coleção "modules", filtrada por ownerId) — só usado quando um uid
 * específico é passado (ver --uid= na CLI). Sem uid, módulos de usuário
 * não são resolvidos (domínio aparece como "(sem domínio)" nesses casos),
 * para não exigir varrer todos os módulos de todo mundo só para montar
 * um mapa de tags.
 */
export async function loadUserModuleConceptTags(db, uid){
  const map = {};
  if(!uid) return map;
  const snap = await db.collection("modules").where("ownerId", "==", uid).get();
  for(const doc of snap.docs){
    const data = doc.data() || {};
    for(const c of (data.concepts || [])){
      if(c && c.id) map[c.id] = c.tag || null;
    }
  }
  return map;
}

export function conceptsArrayFromTagMap(tagMap){
  return Object.entries(tagMap || {}).map(([id, tag]) => ({ id, tag }));
}

/**
 * Busca os documentos da coleção "progress" — opcionalmente filtrados
 * por uid (ver --uid= na CLI). Cada doc tem { state, uid, updatedAt };
 * `state.cards` é o mesmo formato que STATE.cards no cliente.
 */
export async function fetchProgressDocs(db, uid){
  let query = db.collection("progress");
  if(uid) query = query.where("uid", "==", uid);
  const snap = await query.get();
  return snap.docs.map(d => d.data());
}

/**
 * Monta o relatório agregado a partir de documentos JÁ BUSCADOS — função
 * PURA (sem I/O), separada de propósito da busca no Firestore acima, pra
 * poder ser testada com dados fabricados, sem emulator nem rede. Cada
 * doc de progresso é processado separadamente e só os RECORDS (nunca os
 * cardStates inteiros) são concatenados — evita que conceptIds iguais
 * entre usuários diferentes (comum em módulos do catálogo estático)
 * colidam e se sobrescrevam.
 */
export function buildAiAgreementReportFromDocs({ progressDocs, concepts, engine, minSampleSize = 10 } = {}){
  let totalConstructedAttempts = 0;
  let attemptsWithAiEvaluation = 0;
  let allRecords = [];

  for(const doc of (progressDocs || [])){
    const cards = doc && doc.state && doc.state.cards;
    if(!cards) continue;
    const coverage = engine.computeAiEvaluationCoverage(cards);
    totalConstructedAttempts += coverage.totalConstructedAttempts;
    attemptsWithAiEvaluation += coverage.attemptsWithAiEvaluation;
    const records = engine.collectAiAgreementRecords(cards, concepts || []);
    allRecords = allRecords.concat(records);
  }

  const agreement = engine.computeAiAgreementStats(allRecords);
  const byDomain = engine.aggregateAiAgreementByDomain(allRecords, minSampleSize);
  const divergences = engine.findAiAgreementDivergences(allRecords);
  const critical = engine.findCriticalAiAgreementCombinations(allRecords);

  return {
    documentsScanned: (progressDocs || []).length,
    volume: {
      totalConstructedAttempts,
      attemptsWithAiEvaluation,
      coverageRate: totalConstructedAttempts ? attemptsWithAiEvaluation / totalConstructedAttempts : null
    },
    agreement,
    byDomain,
    divergences,
    critical
  };
}

function pct(x){ return x == null ? "—" : `${(x * 100).toFixed(1)}%`; }
function fmtConf(x){ return Number.isFinite(x) ? x.toFixed(3) : "—"; }

/**
 * Formata o relatório em texto — nunca inclui responseText, referenceText,
 * reason completo, uid, e-mail ou nome. Só classes/confidence/conceptId/
 * domínio/timestamps (ver buildAiAgreementRecord em assets/engine.js).
 */
export function formatAiAgreementReport(report){
  const lines = [];
  lines.push("# Relatório — concordância autoavaliação x avaliação semântica da IA");
  lines.push("");
  lines.push("IMPORTANTE: esta matriz mede concordância IA x autoavaliação do usuário,");
  lines.push("NÃO accuracy objetiva da IA — o usuário também pode se autoavaliar errado.");
  lines.push("Dado complementar ao benchmark controlado (test/benchmark/), não substituto.");
  lines.push("");
  lines.push(`Documentos de progresso lidos: ${report.documentsScanned}`);
  lines.push("");

  lines.push("## Volume");
  lines.push(`- totalConstructedAttempts: ${report.volume.totalConstructedAttempts}`);
  lines.push(`- attemptsWithAiEvaluation: ${report.volume.attemptsWithAiEvaluation}`);
  lines.push(`- coverageRate: ${pct(report.volume.coverageRate)}`);
  lines.push("");

  lines.push("## Concordância");
  lines.push(`- agreementRate: ${pct(report.agreement.agreementRate)}`);
  lines.push(`- disagreementRate: ${pct(report.agreement.disagreementRate)}`);
  lines.push(`- aiMoreGenerousRate: ${pct(report.agreement.aiMoreGenerousRate)}`);
  lines.push(`- aiMoreStrictRate: ${pct(report.agreement.aiMoreStrictRate)}`);
  lines.push("");

  lines.push("## Matriz 3x3 (linha = usuário, coluna = IA)");
  lines.push("|              | IA incorrect | IA partial | IA correct |");
  lines.push("| --- | --- | --- | --- |");
  for(const u of ["incorrect", "partial", "correct"]){
    const row = report.agreement.confusionMatrix[u];
    lines.push(`| Usuário ${u} | ${row.incorrect} | ${row.partial} | ${row.correct} |`);
  }
  lines.push("");

  lines.push("## Confidence");
  lines.push(`- média nos acordos: ${fmtConf(report.agreement.avgConfidenceAgreement)}`);
  lines.push(`- média nas divergências: ${fmtConf(report.agreement.avgConfidenceDisagreement)}`);
  lines.push(`- média quando IA é mais generosa: ${fmtConf(report.agreement.avgConfidenceAiMoreGenerous)}`);
  lines.push(`- média quando IA é mais rígida: ${fmtConf(report.agreement.avgConfidenceAiMoreStrict)}`);
  lines.push("");

  lines.push("## Agregação por domínio/tag");
  const domains = Object.keys(report.byDomain);
  if(!domains.length){
    lines.push("(nenhum registro com domínio disponível)");
  } else {
    lines.push("| domínio | n | agreementRate | aiMoreGenerousRate | aiMoreStrictRate |");
    lines.push("| --- | --- | --- | --- | --- |");
    for(const domain of domains){
      const d = report.byDomain[domain];
      const flag = d.insufficientSample ? " (amostra insuficiente, n<10)" : "";
      lines.push(`| ${domain}${flag} | ${d.n} | ${pct(d.agreementRate)} | ${pct(d.aiMoreGenerousRate)} | ${pct(d.aiMoreStrictRate)} |`);
    }
  }
  lines.push("");

  lines.push("## Combinações críticas (só para análise futura — não alteram comportamento)");
  const criticalGroups = [
    ["user incorrect -> AI correct (potencial superestimação da aprendizagem)", report.critical.userIncorrectAiCorrect],
    ["user partial -> AI correct", report.critical.userPartialAiCorrect],
    ["user correct -> AI incorrect", report.critical.userCorrectAiIncorrect]
  ];
  for(const [label, list] of criticalGroups){
    lines.push(`### ${label}: ${list.length} caso(s)`);
    for(const r of list){
      lines.push(`- conceptId=${r.conceptId} domain=${r.domain || "—"} confidence=${fmtConf(r.confidence)} at=${r.at || "—"}`);
    }
  }
  lines.push("");

  lines.push(`## Todas as divergências (${report.divergences.length})`);
  for(const r of report.divergences){
    lines.push(`- conceptId=${r.conceptId} domain=${r.domain || "—"} userClass=${r.userClass} aiClass=${r.aiClass} confidence=${fmtConf(r.confidence)} at=${r.at || "—"}`);
  }
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------
// CLI — só executa se este arquivo for chamado diretamente.
// ---------------------------------------------------------------------
const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if(isMainModule){
  (async () => {
    const uidArg = process.argv.find(a => a.startsWith("--uid="));
    const uid = uidArg ? uidArg.slice("--uid=".length) : null;

    const db = adminDb();
    const engine = loadEngineFsrs();

    const staticTags = loadStaticConceptTags();
    const userTags = await loadUserModuleConceptTags(db, uid);
    const concepts = conceptsArrayFromTagMap({ ...staticTags, ...userTags });

    const progressDocs = await fetchProgressDocs(db, uid);
    const report = buildAiAgreementReportFromDocs({ progressDocs, concepts, engine });
    const text = formatAiAgreementReport(report);

    console.log(text);

    const outDir = path.resolve(__dirname, "../test/benchmark/results");
    mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `ai-agreement-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
    writeFileSync(outPath, text, "utf8");
    console.log(`Relatório salvo em: ${outPath}`);
  })().catch((e) => {
    console.error("Falha ao gerar o relatório de concordância:", e);
    process.exit(1);
  });
}

/* =====================================================================
   COMO EXECUTAR:

     node scripts/reportAiAgreement.js

   Requer FIREBASE_SERVICE_ACCOUNT (mesma credencial admin usada pelas
   funções serverless — ver api/_lib/firebaseAdmin.js) OU
   FIRESTORE_EMULATOR_HOST (para rodar contra o Firestore Emulator local,
   ex.: dentro de `firebase emulators:exec`).

   Opcional: --uid=<uid> restringe a um único usuário e também resolve
   tags de módulos criados por ele (coleção "modules"). Sem --uid, o
   relatório varre toda a coleção "progress" (mesmo padrão de leitura
   ampla já usado por api/enviar-lembretes.js) e só resolve domínio/tag
   para conceptIds do catálogo estático (content/*.json).

   npm run report:ai-agreement   -> atalho para o comando acima.

   Script só de leitura: não grava nada no Firestore, não altera FSRS,
   evidenceStrength, retrievalPassedAt, strongRetrievalPassedAt,
   calibração nem a classificação da autoavaliação de ninguém.
   ===================================================================== */
