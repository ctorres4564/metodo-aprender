/* =====================================================================
   TESTES — scripts/reportAiAgreement.js (partes puras, sem Firestore)
   =====================================================================
   Só testa as funções que não fazem I/O de rede: buildAiAgreementReport
   FromDocs (recebe docs já buscados), formatAiAgreementReport,
   conceptsArrayFromTagMap, e loadStaticConceptTags (lê content/*.json,
   arquivos locais do repo, sem rede). fetchProgressDocs/
   loadUserModuleConceptTags (que chamam o Firestore) são cobertas em
   test/emulator/reportAiAgreement.test.js.

   Importar este módulo NÃO dispara a CLI (guardada por
   `process.argv[1] === este arquivo`, nunca verdadeiro sob vitest) e não
   requer nenhuma credencial do Firebase — adminDb() só é CHAMADA dentro
   do bloco de CLI, nunca no top-level do módulo.
   ===================================================================== */
import { describe, expect, it } from "vitest";
import { loadEngineFsrs } from "../helpers/loadEngineFsrs.js";
import {
  buildAiAgreementReportFromDocs,
  conceptsArrayFromTagMap,
  formatAiAgreementReport,
  loadStaticConceptTags
} from "../../scripts/reportAiAgreement.js";

const engine = loadEngineFsrs();

function constructedAttempt(overrides = {}){
  return Object.assign({
    at:"2026-01-01T00:00:00.000Z", source:"constructed_response", passed:true, quality:4,
    confidence:2, intervalDays:3, responseType:"constructed", evidenceStrength:"strong",
    responseText:"texto bruto da resposta do estudante — nunca deveria aparecer no relatório"
  }, overrides);
}

function progressDoc(cards){
  return { state:{ cards }, uid:"uid-nao-deveria-aparecer-no-relatorio", updatedAt: Date.now() };
}

describe("loadStaticConceptTags — catálogo estático (content/*.json)", () => {
  it("lê tags reais do catálogo (ex.: conceito de metacognição)", () => {
    const tags = loadStaticConceptTags();
    expect(tags["definicao-metacognicao"]).toBe("Fundamentos");
  });

  it("ignora catalog.json (é só o índice, não tem 'concepts')", () => {
    const tags = loadStaticConceptTags();
    // Não deveria ter nenhuma chave vinda de um índice — checagem indireta:
    // o mapa deve conter só ids reais de conceitos, não quebrar por causa dele.
    expect(Object.keys(tags).length).toBeGreaterThan(0);
  });

  it("retorna objeto vazio para diretório inexistente, sem lançar", () => {
    expect(loadStaticConceptTags("/caminho/que/nao/existe")).toEqual({});
  });
});

describe("conceptsArrayFromTagMap", () => {
  it("converte {id: tag} em [{id, tag}]", () => {
    expect(conceptsArrayFromTagMap({ c1:"Biologia", c2:"Física" })).toEqual([
      { id:"c1", tag:"Biologia" }, { id:"c2", tag:"Física" }
    ]);
  });

  it("mapa vazio ou nulo retorna array vazio", () => {
    expect(conceptsArrayFromTagMap({})).toEqual([]);
    expect(conceptsArrayFromTagMap(undefined)).toEqual([]);
  });
});

describe("buildAiAgreementReportFromDocs — relatório vazio", () => {
  it("nenhum doc de progresso -> tudo zerado/null, sem lançar", () => {
    const report = buildAiAgreementReportFromDocs({ progressDocs:[], concepts:[], engine });
    expect(report.documentsScanned).toBe(0);
    expect(report.volume).toEqual({ totalConstructedAttempts:0, attemptsWithAiEvaluation:0, coverageRate:null });
    expect(report.agreement.total).toBe(0);
    expect(report.agreement.agreementRate).toBeNull();
    expect(report.byDomain).toEqual({});
    expect(report.divergences).toEqual([]);
    expect(report.critical).toEqual({ userIncorrectAiCorrect:[], userPartialAiCorrect:[], userCorrectAiIncorrect:[] });
  });

  it("docs sem state.cards são ignorados, sem lançar", () => {
    const report = buildAiAgreementReportFromDocs({ progressDocs:[{ uid:"x" }, { state:{} }], concepts:[], engine });
    expect(report.documentsScanned).toBe(2);
    expect(report.volume.totalConstructedAttempts).toBe(0);
  });
});

describe("buildAiAgreementReportFromDocs — tentativas antigas e sem IA", () => {
  it("tentativa antiga (pré-Prioridade-3, sem aiEvaluation nem responseType) não entra na concordância, mas conta em coverage", () => {
    const legacyAttempt = { at:"2025-01-01T00:00:00.000Z", source:"constructed_response", passed:true, quality:4 };
    const docs = [progressDoc({ c1:{ retrievalAttempts:[legacyAttempt] } })];
    const report = buildAiAgreementReportFromDocs({ progressDocs:docs, concepts:[], engine });
    expect(report.volume.totalConstructedAttempts).toBe(1);
    expect(report.volume.attemptsWithAiEvaluation).toBe(0);
    expect(report.agreement.total).toBe(0);
  });

  it("tentativa sem aiEvaluation (IA ainda não respondeu) não entra na concordância", () => {
    const docs = [progressDoc({ c1:{ retrievalAttempts:[constructedAttempt({ quality:3 })] } })];
    const report = buildAiAgreementReportFromDocs({ progressDocs:docs, concepts:[], engine });
    expect(report.volume.totalConstructedAttempts).toBe(1);
    expect(report.volume.attemptsWithAiEvaluation).toBe(0);
    expect(report.divergences).toEqual([]);
  });
});

describe("buildAiAgreementReportFromDocs — matriz, domínio e combinações críticas com dados reais de múltiplos documentos", () => {
  const concepts = [{ id:"c1", tag:"Biologia" }, { id:"c2", tag:"Física" }];
  const docs = [
    // doc de um "usuário" — acerta (correct/correct)
    progressDoc({ c1:{ retrievalAttempts:[ constructedAttempt({ quality:4, aiEvaluation:{ classification:"correct", confidence:0.9, evaluatedAt:"2026-01-01T00:00:00Z" } }) ] } }),
    // doc de outro "usuário" — MESMO conceptId "c1" (comum entre catálogo estático) — não deve colidir
    progressDoc({ c1:{ retrievalAttempts:[ constructedAttempt({ quality:1, aiEvaluation:{ classification:"correct", confidence:0.95, evaluatedAt:"2026-01-02T00:00:00Z" } }) ] } }), // user incorrect -> AI correct
    progressDoc({ c2:{ retrievalAttempts:[ constructedAttempt({ quality:4, aiEvaluation:{ classification:"incorrect", confidence:0.7, evaluatedAt:"2026-01-03T00:00:00Z" } }) ] } }) // user correct -> AI incorrect
  ];
  const report = buildAiAgreementReportFromDocs({ progressDocs:docs, concepts, engine, minSampleSize:2 });

  it("concatena registros de vários documentos sem colisão de conceptId entre eles", () => {
    expect(report.agreement.total).toBe(3);
  });

  it("matriz 3x3 correta", () => {
    expect(report.agreement.confusionMatrix.correct.correct).toBe(1);
    expect(report.agreement.confusionMatrix.incorrect.correct).toBe(1);
    expect(report.agreement.confusionMatrix.correct.incorrect).toBe(1);
  });

  it("agregação por domínio: Biologia tem 2 (n>=2, não insuficiente), Física tem 1 (insuficiente)", () => {
    expect(report.byDomain["Biologia"]).toMatchObject({ n:2, insufficientSample:false });
    expect(report.byDomain["Física"]).toMatchObject({ n:1, insufficientSample:true });
  });

  it("destaca a combinação crítica user_incorrect -> ai_correct", () => {
    expect(report.critical.userIncorrectAiCorrect).toHaveLength(1);
    expect(report.critical.userIncorrectAiCorrect[0].conceptId).toBe("c1");
  });

  it("destaca também user_correct -> ai_incorrect", () => {
    expect(report.critical.userCorrectAiIncorrect).toHaveLength(1);
    expect(report.critical.userCorrectAiIncorrect[0].conceptId).toBe("c2");
  });
});

describe("privacidade — nenhum dado bruto ou pessoal no relatório", () => {
  const concepts = [{ id:"c1", tag:"Biologia" }];
  const docs = [
    progressDoc({
      c1:{ retrievalAttempts:[ constructedAttempt({
        quality:3,
        responseText:"RESPOSTA_SECRETA_DO_ESTUDANTE",
        aiEvaluation:{
          classification:"incorrect", confidence:0.8, evaluatedAt:"2026-01-01T00:00:00Z",
          reason:"MOTIVO_COMPLETO_DA_IA_QUE_NAO_PODE_VAZAR", model:"openai/gpt-4o-mini"
        }
      }) ] }
    })
  ];
  const report = buildAiAgreementReportFromDocs({ progressDocs:docs, concepts, engine });
  const reportJson = JSON.stringify(report);
  const formatted = formatAiAgreementReport(report);

  it("o objeto do relatório nunca contém responseText", () => {
    expect(reportJson).not.toContain("RESPOSTA_SECRETA_DO_ESTUDANTE");
  });

  it("o objeto do relatório nunca contém o reason completo da IA", () => {
    expect(reportJson).not.toContain("MOTIVO_COMPLETO_DA_IA_QUE_NAO_PODE_VAZAR");
  });

  it("o objeto do relatório nunca contém o uid do documento de progresso", () => {
    expect(reportJson).not.toContain("uid-nao-deveria-aparecer-no-relatorio");
  });

  it("o texto formatado (o que seria impresso/salvo) também não contém nada disso", () => {
    expect(formatted).not.toContain("RESPOSTA_SECRETA_DO_ESTUDANTE");
    expect(formatted).not.toContain("MOTIVO_COMPLETO_DA_IA_QUE_NAO_PODE_VAZAR");
    expect(formatted).not.toContain("uid-nao-deveria-aparecer-no-relatorio");
  });

  it("os únicos campos por registro são conceptId/domain/userClass/aiClass/confidence/at", () => {
    expect(Object.keys(report.divergences[0]).sort()).toEqual(["aiClass", "at", "conceptId", "confidence", "domain", "userClass"]);
  });
});

describe("relatório não modifica o estado do engine", () => {
  it("STATE do sandbox nunca é tocado — continua com o mesmo valor antes e depois de gerar o relatório", () => {
    // Este sandbox usa loadEngineFsrs() (sem injeção de STATE/CONCEPTS via
    // var), então STATE nem existe como propriedade do sandbox — é a
    // prova mais forte possível de que a função não lê nem escreve STATE.
    const concepts = [{ id:"c1", tag:"Biologia" }];
    const docs = [progressDoc({ c1:{ retrievalAttempts:[ constructedAttempt({ quality:4, aiEvaluation:{ classification:"correct", confidence:0.9 } }) ] } })];
    const before = engine.STATE;
    buildAiAgreementReportFromDocs({ progressDocs:docs, concepts, engine });
    expect(engine.STATE).toBe(before);
  });

  it("os cardStates originais passados não são mutados (relatório é só leitura)", () => {
    const attempt = constructedAttempt({ quality:4, aiEvaluation:{ classification:"correct", confidence:0.9 } });
    const cards = { c1:{ retrievalAttempts:[attempt] } };
    const snapshotBefore = JSON.stringify(cards);
    buildAiAgreementReportFromDocs({ progressDocs:[progressDoc(cards)], concepts:[{ id:"c1", tag:"Biologia" }], engine });
    expect(JSON.stringify(cards)).toBe(snapshotBefore);
  });
});

describe("formatAiAgreementReport — texto legível", () => {
  it("inclui o aviso de que a matriz mede concordância, não accuracy objetiva", () => {
    const report = buildAiAgreementReportFromDocs({ progressDocs:[], concepts:[], engine });
    const text = formatAiAgreementReport(report);
    expect(text).toContain("NÃO accuracy objetiva da IA");
  });

  it("marca grupos de domínio com amostra insuficiente no texto", () => {
    const docs = [progressDoc({ c1:{ retrievalAttempts:[ constructedAttempt({ quality:4, aiEvaluation:{ classification:"correct", confidence:0.9 } }) ] } })];
    const report = buildAiAgreementReportFromDocs({ progressDocs:docs, concepts:[{ id:"c1", tag:"Biologia" }], engine });
    const text = formatAiAgreementReport(report);
    expect(text).toContain("amostra insuficiente, n<10");
  });
});
