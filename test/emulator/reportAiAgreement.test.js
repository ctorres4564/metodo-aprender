/* =====================================================================
   TESTES — scripts/reportAiAgreement.js, contra o Firebase Emulator
   =====================================================================
   Cobre a camada de I/O (fetchProgressDocs, loadUserModuleConceptTags)
   que o teste unitário não pode cobrir sem rede: lê de verdade da
   coleção "progress" (e "modules") do Firestore Emulator. A matemática
   em si (buildAiAgreementReportFromDocs) já é coberta sem emulator em
   test/unit/reportAiAgreement.test.js — aqui só confirmamos que os dados
   chegam corretos do Firestore até essas funções.

   Script é só leitura: nenhum teste aqui espera nem verifica escrita —
   só criamos os documentos de fixture (setup do teste), nunca através do
   próprio script.
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Rode via `npm run test:emulator` — este arquivo precisa do Firebase Emulator.");
}

const { adminDb } = await import("../../api/_lib/firebaseAdmin.js");
const {
  fetchProgressDocs,
  loadUserModuleConceptTags,
  conceptsArrayFromTagMap,
  buildAiAgreementReportFromDocs
} = await import("../../scripts/reportAiAgreement.js");
const { loadEngineFsrs } = await import("../helpers/loadEngineFsrs.js");

const engine = loadEngineFsrs();

const UID_A = "e2e-report-uid-a";
const UID_B = "e2e-report-uid-b";

function constructedAttempt(overrides = {}){
  return Object.assign({
    at:"2026-01-01T00:00:00.000Z", source:"constructed_response", passed:true, quality:4,
    confidence:2, intervalDays:3, responseType:"constructed", evidenceStrength:"strong"
  }, overrides);
}

async function cleanup(){
  const db = adminDb();
  const progressSnap = await db.collection("progress").where("uid", "in", [UID_A, UID_B]).get();
  await Promise.all(progressSnap.docs.map((d) => d.ref.delete()));
  const modulesSnap = await db.collection("modules").where("ownerId", "in", [UID_A, UID_B]).get();
  await Promise.all(modulesSnap.docs.map((d) => d.ref.delete()));
}

beforeEach(cleanup);
afterEach(cleanup);

describe("fetchProgressDocs — lê a coleção progress de verdade", () => {
  it("sem uid, retorna todos os docs de progresso existentes", async () => {
    const db = adminDb();
    await db.collection("progress").doc(`${UID_A}_modulo1`).set({
      uid: UID_A,
      state: { cards: { c1: { retrievalAttempts: [constructedAttempt({ quality:4, aiEvaluation:{ classification:"correct", confidence:0.9 } })] } } }
    });
    await db.collection("progress").doc(`${UID_B}_modulo1`).set({
      uid: UID_B,
      state: { cards: { c2: { retrievalAttempts: [constructedAttempt({ quality:3, aiEvaluation:{ classification:"correct", confidence:0.8 } })] } } }
    });

    const docs = await fetchProgressDocs(db, null);
    const relevant = docs.filter((d) => d.uid === UID_A || d.uid === UID_B);
    expect(relevant).toHaveLength(2);
  });

  it("com uid, filtra só os docs daquele usuário", async () => {
    const db = adminDb();
    await db.collection("progress").doc(`${UID_A}_modulo1`).set({
      uid: UID_A,
      state: { cards: { c1: { retrievalAttempts: [constructedAttempt({ quality:4, aiEvaluation:{ classification:"correct", confidence:0.9 } })] } } }
    });
    await db.collection("progress").doc(`${UID_B}_modulo1`).set({
      uid: UID_B,
      state: { cards: { c2: { retrievalAttempts: [constructedAttempt({ quality:3, aiEvaluation:{ classification:"correct", confidence:0.8 } })] } } }
    });

    const docs = await fetchProgressDocs(db, UID_A);
    expect(docs).toHaveLength(1);
    expect(docs[0].uid).toBe(UID_A);
  });
});

describe("loadUserModuleConceptTags — lê a coleção modules de verdade", () => {
  it("resolve tag de conceitos de um módulo criado pelo usuário", async () => {
    const db = adminDb();
    await db.collection("modules").doc("mod-teste-report").set({
      ownerId: UID_A,
      concepts: [{ id:"custom-1", tag:"Domínio Customizado" }, { id:"custom-2", tag:"Outro Domínio" }]
    });

    const tags = await loadUserModuleConceptTags(db, UID_A);
    expect(tags["custom-1"]).toBe("Domínio Customizado");
    expect(tags["custom-2"]).toBe("Outro Domínio");
  });

  it("sem uid, retorna mapa vazio sem consultar o Firestore", async () => {
    const db = adminDb();
    expect(await loadUserModuleConceptTags(db, null)).toEqual({});
  });
});

describe("pipeline completo: Firestore -> buildAiAgreementReportFromDocs", () => {
  it("lê progress + modules reais e produz um relatório agregado correto", async () => {
    const db = adminDb();
    await db.collection("modules").doc("mod-teste-report-2").set({
      ownerId: UID_A,
      concepts: [{ id:"custom-3", tag:"Domínio Real" }]
    });
    await db.collection("progress").doc(`${UID_A}_modulo2`).set({
      uid: UID_A,
      state: {
        cards: {
          "custom-3": {
            retrievalAttempts: [
              constructedAttempt({ quality:1, aiEvaluation:{ classification:"correct", confidence:0.9, evaluatedAt:"2026-01-01T00:00:00Z" } }) // incorrect -> correct
            ]
          }
        }
      }
    });

    const progressDocs = await fetchProgressDocs(db, UID_A);
    const userTags = await loadUserModuleConceptTags(db, UID_A);
    const concepts = conceptsArrayFromTagMap(userTags);
    const report = buildAiAgreementReportFromDocs({ progressDocs, concepts, engine });

    expect(report.volume.totalConstructedAttempts).toBe(1);
    expect(report.volume.attemptsWithAiEvaluation).toBe(1);
    expect(report.critical.userIncorrectAiCorrect).toHaveLength(1);
    expect(report.critical.userIncorrectAiCorrect[0].domain).toBe("Domínio Real");
  });

  it("script é só leitura: rodar o pipeline não grava nada no Firestore", async () => {
    const db = adminDb();
    await db.collection("progress").doc(`${UID_A}_modulo3`).set({
      uid: UID_A,
      state: { cards: { c1: { retrievalAttempts: [constructedAttempt({ quality:4, aiEvaluation:{ classification:"correct", confidence:0.9 } })] } } }
    });

    const before = await db.collection("progress").doc(`${UID_A}_modulo3`).get();
    const beforeData = JSON.stringify(before.data());

    const progressDocs = await fetchProgressDocs(db, UID_A);
    buildAiAgreementReportFromDocs({ progressDocs, concepts:[], engine });

    const after = await db.collection("progress").doc(`${UID_A}_modulo3`).get();
    expect(JSON.stringify(after.data())).toBe(beforeData);
  });
});
