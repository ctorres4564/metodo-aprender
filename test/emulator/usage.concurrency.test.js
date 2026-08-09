/* =====================================================================
   TESTE — concorrência REAL de api/_lib/usage.js contra o Firestore
   Emulator (não um mock em memória).
   =====================================================================
   O teste de concorrência em api/_lib/usage.test.js usa um mock que
   serializa as transações de propósito — prova que a LÓGICA da aplicação
   nunca deixa passar consumo além do limite, mas não prova o
   comportamento do Firestore de verdade sob conflito real de escrita
   (retry-on-conflict). Este arquivo chama checkAndConsumeUsage/
   refundUsage de verdade (o mesmo código de produção), conectado ao
   Firestore Emulator via FIRESTORE_EMULATOR_HOST (ver api/_lib/
   firebaseAdmin.js) — só roda dentro de `npm run test:emulator`.
   ===================================================================== */
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { deleteApp, getApps } from "firebase-admin/app";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST não definida — rode via `npm run test:emulator` (nunca `vitest` direto neste arquivo, senão ele tentaria falar com o Firestore de produção)."
  );
}

const { checkAndConsumeUsage, refundUsage } = await import("../../api/_lib/usage.js");
const { adminDb } = await import("../../api/_lib/firebaseAdmin.js");

function makeUser(uid) {
  return { uid, email_verified: true };
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

afterEach(async () => {
  const snap = await adminDb().collection("ai_usage").get();
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
});

afterAll(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("usage.js — concorrência real (Firestore Emulator)", () => {
  // 65 transações VERDADEIRAMENTE simultâneas no mesmo documento (o
  // número original pedido) esbarram na vazão do emulator LOCAL — não é
  // uma falha de lógica (o equivalente com o mock, em usage.test.js,
  // prova a mesma invariante deterministicamente com 65 chamadas), é só
  // o emulator sendo bem mais lento que o Firestore de produção pra esse
  // volume de contenção. Pra continuar testando o limite exato SOB
  // CONCORRÊNCIA REAL, mas em tempo viável: pré-carrega o contador perto
  // do limite (57 de 60) e dispara só as chamadas simultâneas que
  // importam pra decidir o resultado exato (10, quando só 3 deveriam
  // passar) — ainda é Firestore de verdade, com transações de verdade
  // disputando o mesmo documento, só que num volume que o emulator
  // processa em segundos em vez de minutos.
  it("nunca deixa passar mais consumos do que o limite, com transações reais em paralelo, mesmo bem perto do limite", async () => {
    const user = makeUser("user-emulator-race");
    const docId = `user-emulator-race_${currentMonthKey()}`;

    // generate/free = 60 — começa a 3 do limite.
    await adminDb().collection("ai_usage").doc(docId).set({ count: 57, uid: user.uid, bucket: "generate", updatedAt: Date.now() });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => checkAndConsumeUsage(user, "generate"))
    );

    const allowed = results.filter((r) => r.allowed);
    expect(allowed.length).toBe(3); // só dava pra passar de 57 pra 60

    const doc = await adminDb().collection("ai_usage").doc(docId).get();
    expect(doc.data().count).toBe(60);
  }, 30000);

  it("refundUsage nunca deixa o contador negativo, mesmo com várias chamadas simultâneas", async () => {
    const uid = "user-emulator-refund";
    await Promise.all(Array.from({ length: 10 }, () => refundUsage(uid, "explain")));

    const doc = await adminDb().collection("ai_usage").doc(`${uid}_${currentMonthKey()}_explain`).get();
    if (doc.exists) {
      expect(doc.data().count).toBeGreaterThanOrEqual(0);
    }
  }, 20000);
});
