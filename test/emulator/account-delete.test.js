/* =====================================================================
   TESTES — api/account.js (exclusão de conta), contra o Firebase Emulator
   =====================================================================
   Fase 3 do plano de testes. Usa Firestore + Storage + Auth Emulator de
   verdade (via FIRESTORE_EMULATOR_HOST/FIREBASE_STORAGE_EMULATOR_HOST/
   FIREBASE_AUTH_EMULATOR_HOST, detectados automaticamente pelo Admin SDK
   — ver api/_lib/firebaseAdmin.js) e um cliente Stripe mockado (nenhuma
   chamada de rede de verdade pra Stripe). verifyUserFromRequest também é
   mockado — validação de token não é o escopo deste arquivo (isso é
   testado em api/_lib/usage.test.js); aqui controlamos diretamente quem
   é "a pessoa logada" chamando o handler.
   ===================================================================== */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Rode via `npm run test:emulator` — este arquivo precisa do Firebase Emulator.");
}

let mockUser = null;
vi.mock("../../api/_lib/usage.js", () => ({
  verifyUserFromRequest: async () => mockUser
}));

let mockStripe;
vi.mock("../../api/_lib/stripe.js", () => ({
  getStripe: () => mockStripe
}));

const { default: handler } = await import("../../api/account.js");
const { adminDb, adminAuth, adminStorage } = await import("../../api/_lib/firebaseAdmin.js");
const { getApps, deleteApp } = await import("firebase-admin/app");

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

function freshStripe(overrides = {}) {
  return {
    customers: { list: vi.fn().mockResolvedValue({ data: [] }), ...overrides.customers },
    subscriptions: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      cancel: vi.fn().mockResolvedValue({}),
      ...overrides.subscriptions
    },
    checkout: {
      sessions: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        expire: vi.fn().mockResolvedValue({}),
        ...overrides.checkoutSessions
      }
    }
  };
}

// Cria um uid único por teste (evita um teste ler dado deixado por outro,
// já que os arquivos deste diretório rodam em sequência mas reaproveitam
// o mesmo emulator entre "it"s).
let uidCounter = 0;
function nextUid() {
  uidCounter += 1;
  return `del-user-${uidCounter}`;
}

async function seedFullAccount(uid) {
  const db = adminDb();
  await db.collection("users").doc(uid).set({ email: `${uid}@x.com`, plan: "premium", stripeCustomerId: `cus_${uid}` });

  const materialRef = db.collection("materials").doc(`mat-${uid}`);
  await materialRef.set({ ownerId: uid, title: "Livro", storagePath: `users/${uid}/materials/mat-${uid}/original.pdf` });
  await materialRef.collection("pages").doc("p1").set({ text: "..." });
  await materialRef.collection("highlights").doc("h1").set({ ownerId: uid, materialId: `mat-${uid}`, color: "yellow" });
  await materialRef.collection("notes").doc("n1").set({ ownerId: uid, materialId: `mat-${uid}`, highlightId: "h1", text: "nota" });

  await db.collection("modules").doc(`mod-${uid}`).set({ ownerId: uid, title: "Módulo" });
  await db.collection("progress").doc(`${uid}_modulo1`).set({ done: true });
  await db.collection("ai_usage").doc(`${uid}_2026-08_explain`).set({ count: 5 });

  await adminStorage().file(`users/${uid}/materials/mat-${uid}/original.pdf`).save(Buffer.from("%PDF-fake"), {
    contentType: "application/pdf"
  });

  await adminAuth().createUser({ uid, email: `${uid}@x.com` });
}

async function accountStillExists(uid) {
  const [usersDoc, materialsSnap, modulesSnap] = await Promise.all([
    adminDb().collection("users").doc(uid).get(),
    adminDb().collection("materials").where("ownerId", "==", uid).get(),
    adminDb().collection("modules").where("ownerId", "==", uid).get()
  ]);
  return { userDocExists: usersDoc.exists, materialsCount: materialsSnap.size, modulesCount: modulesSnap.size };
}

afterAll(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("api/account.js — exclusão de conta (Firebase Emulator)", () => {
  beforeEach(() => {
    mockStripe = freshStripe();
  });

  afterEach(() => {
    mockUser = null;
  });

  it("exclui dados (Firestore + Storage), cancela assinatura Stripe e remove o Auth por último", async () => {
    const uid = nextUid();
    await seedFullAccount(uid);
    mockUser = { uid, email: `${uid}@x.com` };

    mockStripe = freshStripe({
      subscriptions: { list: vi.fn().mockResolvedValue({ data: [{ id: `sub_${uid}`, status: "active" }] }) }
    });

    const res = makeRes();
    await handler({ method: "POST", body: { action: "delete" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Assinatura cancelada ANTES de qualquer coisa (ver próximo teste pra
    // prova de que uma falha aqui aborta a exclusão inteira).
    expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith(`sub_${uid}`);

    // Todos os dados sumiram.
    const state = await accountStillExists(uid);
    expect(state.userDocExists).toBe(false);
    expect(state.materialsCount).toBe(0);
    expect(state.modulesCount).toBe(0);

    const materialRef = adminDb().collection("materials").doc(`mat-${uid}`);
    const [pages, highlights, notes] = await Promise.all([
      materialRef.collection("pages").get(),
      materialRef.collection("highlights").get(),
      materialRef.collection("notes").get()
    ]);
    expect(pages.empty && highlights.empty && notes.empty).toBe(true);

    const [progressSnap, usageSnap] = await Promise.all([
      adminDb().collection("progress").doc(`${uid}_modulo1`).get(),
      adminDb().collection("ai_usage").doc(`${uid}_2026-08_explain`).get()
    ]);
    expect(progressSnap.exists).toBe(false);
    expect(usageSnap.exists).toBe(false);

    // Storage também limpo.
    const [exists] = await adminStorage().file(`users/${uid}/materials/mat-${uid}/original.pdf`).exists();
    expect(exists).toBe(false);

    // Auth removido por último — e removido de verdade.
    await expect(adminAuth().getUser(uid)).rejects.toMatchObject({ code: "auth/user-not-found" });
  });

  it("uma falha ao cancelar a assinatura na Stripe aborta a exclusão ANTES de apagar qualquer dado", async () => {
    const uid = nextUid();
    await seedFullAccount(uid);
    mockUser = { uid, email: `${uid}@x.com` };

    mockStripe = freshStripe({
      customers: { list: vi.fn().mockRejectedValue(new Error("Stripe indisponível (simulado)")) }
    });

    const res = makeRes();
    await handler({ method: "POST", body: { action: "delete" } }, res);

    expect(res.statusCode).toBe(500);

    // Nada foi apagado — nem os dados, nem a conta de login.
    const state = await accountStillExists(uid);
    expect(state.userDocExists).toBe(true);
    expect(state.materialsCount).toBe(1);
    await expect(adminAuth().getUser(uid)).resolves.toBeDefined();
  });

  it("se a conta nunca teve stripeCustomerId nem assinatura, busca por e-mail na Stripe (2ª camada), não acha nada, não cancela nada — e ainda assim exclui tudo", async () => {
    const uid = nextUid();
    const db = adminDb();
    await db.collection("users").doc(uid).set({ email: `${uid}@x.com`, plan: "free" }); // sem stripeCustomerId
    await adminAuth().createUser({ uid, email: `${uid}@x.com` });
    mockUser = { uid, email: `${uid}@x.com` };

    const res = makeRes();
    await handler({ method: "POST", body: { action: "delete" } }, res);

    expect(res.statusCode).toBe(200);
    // A busca por e-mail SEMPRE roda quando há e-mail (2ª camada contra
    // assinatura órfã sem stripeCustomerId salvo — ver findStripeCustomerIds)...
    expect(mockStripe.customers.list).toHaveBeenCalledWith({ email: `${uid}@x.com`, limit: 100 });
    // ...mas como não achou nenhum customer, não há nada pra cancelar.
    expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
    await expect(adminAuth().getUser(uid)).rejects.toMatchObject({ code: "auth/user-not-found" });
  });

  it("se o Auth já estava sem o usuário (removido por outro motivo), os dados ainda são apagados e a resposta explica o problema específico do login", async () => {
    const uid = nextUid();
    await seedFullAccount(uid);
    mockUser = { uid, email: `${uid}@x.com` };
    // Simula "Auth já tinha sumido antes" — a exclusão de dados deve
    // continuar funcionando de qualquer forma, só o passo 7 (Auth) falha.
    await adminAuth().deleteUser(uid);

    const res = makeRes();
    await handler({ method: "POST", body: { action: "delete" } }, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/dados foram apagados/i);

    const state = await accountStillExists(uid);
    expect(state.userDocExists).toBe(false);
    expect(state.materialsCount).toBe(0);
  });

  it("rejeita quem não está logado (401) e não mexe em nada", async () => {
    mockUser = null;
    const res = makeRes();
    await handler({ method: "POST", body: { action: "delete" } }, res);
    expect(res.statusCode).toBe(401);
  });

  it("nunca aceita um uid arbitrário no corpo — sempre age sobre quem está logado", async () => {
    const uid = nextUid();
    const otherUid = nextUid();
    await seedFullAccount(uid);
    await seedFullAccount(otherUid);
    mockUser = { uid, email: `${uid}@x.com` }; // logado como "uid"

    const res = makeRes();
    // Tenta (sem sucesso, a API nem aceita esse campo) apagar "otherUid".
    await handler({ method: "POST", body: { action: "delete", uid: otherUid, targetUid: otherUid } }, res);

    expect(res.statusCode).toBe(200);
    const deletedAccount = await accountStillExists(uid);
    const untouchedAccount = await accountStillExists(otherUid);
    expect(deletedAccount.userDocExists).toBe(false); // a própria conta, sim
    expect(untouchedAccount.userDocExists).toBe(true); // a de outra pessoa, intocada
  });
});
