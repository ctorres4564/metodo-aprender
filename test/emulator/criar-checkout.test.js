/* =====================================================================
   TESTES — api/criar-checkout.js, contra o Firebase Emulator
   =====================================================================
   Foco: o lock anti-corrida (checkoutInProgress, transação + TTL) e a
   checagem de assinatura duplicada (ativa/trialing bloqueia, incomplete
   recente bloqueia, incomplete antiga é cancelada e libera o caminho).
   Usa Firestore de verdade (via FIRESTORE_EMULATOR_HOST, detectado pelo
   Admin SDK — ver api/_lib/firebaseAdmin.js) e um cliente Stripe mockado
   (nenhuma chamada de rede real). verifyUserFromRequest também é
   mockado — validação de token é escopo de api/_lib/usage.test.js.
   ===================================================================== */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { default: handler } = await import("../../api/criar-checkout.js");
const { adminDb } = await import("../../api/_lib/firebaseAdmin.js");
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
    subscriptions: {
      list: vi.fn().mockResolvedValue({ data: [] }),
      cancel: vi.fn().mockResolvedValue({}),
      ...overrides.subscriptions
    },
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({ url: "https://checkout.stripe.com/fake-session" }),
        ...overrides.checkoutSessions
      }
    }
  };
}

let uidCounter = 0;
function nextUid() {
  uidCounter += 1;
  return `chk-user-${uidCounter}`;
}

const ORIGINAL_ENV_PRICE = process.env.STRIPE_PRICE_ID;

afterAll(async () => {
  process.env.STRIPE_PRICE_ID = ORIGINAL_ENV_PRICE;
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("api/criar-checkout.js (Firebase Emulator)", () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_ID = "price_fake_123";
    mockStripe = freshStripe();
  });

  afterEach(() => {
    mockUser = null;
  });

  it("cria a sessão de checkout e libera o lock ao final", async () => {
    const uid = nextUid();
    mockUser = { uid, email: `${uid}@x.com` };

    const res = makeRes();
    await handler({ method: "POST" }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ url: "https://checkout.stripe.com/fake-session" });
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);

    const doc = await adminDb().collection("users").doc(uid).get();
    expect(doc.data().checkoutInProgress).toBeUndefined();
  });

  it("duas chamadas simultâneas: só uma cria sessão, a outra recebe 409 checkout_in_progress", async () => {
    const uid = nextUid();
    mockUser = { uid, email: `${uid}@x.com` };
    // Pré-cria o doc (sem lock) — um doc com versão já definida faz o
    // conflito de escrita da transação ser detectado de forma confiável;
    // sem isso, duas transações que ambas criam o doc do zero corriam risco
    // de não conflitar de verdade no emulator (falso-negativo do teste).
    await adminDb().collection("users").doc(uid).set({ email: `${uid}@x.com` });

    // A chamada Stripe mockada normalmente resolve instantaneamente — sem
    // atraso, a 1ª chamada pode adquirir e já LIBERAR o lock antes que a 2ª
    // sequer tente ler o documento (nenhuma janela real de corrida no
    // teste). Um atraso artificial aqui mantém o lock "segurado" tempo
    // suficiente pra 2ª chamada de fato colidir com ele — isso testa o
    // lock, não a velocidade do mock.
    mockStripe.checkout.sessions.create = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve({ url: "https://checkout.stripe.com/fake-session" }), 300))
    );

    const res1 = makeRes();
    const res2 = makeRes();
    await Promise.all([
      handler({ method: "POST" }, res1),
      new Promise((resolve) => setTimeout(resolve, 50)).then(() => handler({ method: "POST" }, res2))
    ]);

    const statuses = [res1.statusCode, res2.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const blocked = res1.statusCode === 409 ? res1 : res2;
    expect(blocked.body.code).toBe("checkout_in_progress");

    // Só uma sessão de checkout foi criada de fato.
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);

    // O lock foi liberado no final (o vencedor libera no finally).
    const doc = await adminDb().collection("users").doc(uid).get();
    expect(doc.data().checkoutInProgress).toBeUndefined();
  });

  it("um lock recente (dentro do TTL) bloqueia uma nova tentativa mesmo sem chamada concorrente de verdade", async () => {
    const uid = nextUid();
    mockUser = { uid, email: `${uid}@x.com` };
    await adminDb().collection("users").doc(uid).set({ checkoutInProgress: Date.now() }, { merge: true });

    const res = makeRes();
    await handler({ method: "POST" }, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("checkout_in_progress");
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("um lock expirado (além do TTL) não bloqueia — a chamada segue e cria a sessão normalmente", async () => {
    const uid = nextUid();
    mockUser = { uid, email: `${uid}@x.com` };
    const STALE_LOCK_MS = 5 * 60 * 1000 + 1000; // TTL é 5 min; passa 1s do limite
    await adminDb().collection("users").doc(uid).set({ checkoutInProgress: Date.now() - STALE_LOCK_MS }, { merge: true });

    const res = makeRes();
    await handler({ method: "POST" }, res);

    expect(res.statusCode).toBe(200);
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("assinatura ativa existente bloqueia novo checkout (409 already_subscribed) e não cria sessão", async () => {
    const uid = nextUid();
    mockUser = { uid, email: `${uid}@x.com` };
    await adminDb().collection("users").doc(uid).set({ stripeCustomerId: `cus_${uid}` }, { merge: true });
    mockStripe = freshStripe({
      subscriptions: { list: vi.fn().mockResolvedValue({ data: [{ id: `sub_${uid}`, status: "active" }] }) }
    });

    const res = makeRes();
    await handler({ method: "POST" }, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("already_subscribed");
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();

    // Lock liberado mesmo no caminho de bloqueio.
    const doc = await adminDb().collection("users").doc(uid).get();
    expect(doc.data().checkoutInProgress).toBeUndefined();
  });

  it("assinatura trialing/past_due/unpaid também bloqueia (mesma checagem)", async () => {
    const uid = nextUid();
    mockUser = { uid, email: `${uid}@x.com` };
    await adminDb().collection("users").doc(uid).set({ stripeCustomerId: `cus_${uid}` }, { merge: true });
    mockStripe = freshStripe({
      subscriptions: { list: vi.fn().mockResolvedValue({ data: [{ id: `sub_${uid}`, status: "past_due" }] }) }
    });

    const res = makeRes();
    await handler({ method: "POST" }, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("already_subscribed");
  });

  it("incomplete recente (dentro de 1h) bloqueia como pagamento em andamento", async () => {
    const uid = nextUid();
    mockUser = { uid, email: `${uid}@x.com` };
    await adminDb().collection("users").doc(uid).set({ stripeCustomerId: `cus_${uid}` }, { merge: true });
    mockStripe = freshStripe({
      subscriptions: {
        list: vi.fn().mockResolvedValue({
          data: [{ id: `sub_${uid}`, status: "incomplete", created: Math.floor(Date.now() / 1000) - 60 }]
        })
      }
    });

    const res = makeRes();
    await handler({ method: "POST" }, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe("already_subscribed");
    expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("incomplete antiga (fora de 1h) é cancelada e o checkout segue normalmente", async () => {
    const uid = nextUid();
    mockUser = { uid, email: `${uid}@x.com` };
    await adminDb().collection("users").doc(uid).set({ stripeCustomerId: `cus_${uid}` }, { merge: true });
    const oldCreated = Math.floor(Date.now() / 1000) - 2 * 60 * 60; // 2h atrás
    mockStripe = freshStripe({
      subscriptions: {
        list: vi.fn().mockResolvedValue({
          data: [{ id: `sub_old_${uid}`, status: "incomplete", created: oldCreated }]
        })
      }
    });

    const res = makeRes();
    await handler({ method: "POST" }, res);

    expect(res.statusCode).toBe(200);
    expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith(`sub_old_${uid}`);
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("reaproveita o stripeCustomerId existente em vez de deixar a Stripe criar um novo customer", async () => {
    const uid = nextUid();
    mockUser = { uid, email: `${uid}@x.com` };
    await adminDb().collection("users").doc(uid).set({ stripeCustomerId: `cus_${uid}` }, { merge: true });

    const res = makeRes();
    await handler({ method: "POST" }, res);

    expect(res.statusCode).toBe(200);
    const [args] = mockStripe.checkout.sessions.create.mock.calls[0];
    expect(args.customer).toBe(`cus_${uid}`);
    expect(args.customer_email).toBeUndefined();
  });

  it("sem stripeCustomerId, usa customer_email e deixa a Stripe criar o customer", async () => {
    const uid = nextUid();
    mockUser = { uid, email: `${uid}@x.com` };

    const res = makeRes();
    await handler({ method: "POST" }, res);

    expect(res.statusCode).toBe(200);
    const [args] = mockStripe.checkout.sessions.create.mock.calls[0];
    expect(args.customer).toBeUndefined();
    expect(args.customer_email).toBe(`${uid}@x.com`);
  });

  it("a idempotency key é amarrada ao lock (uid + timestamp do lock)", async () => {
    const uid = nextUid();
    mockUser = { uid, email: `${uid}@x.com` };

    const res = makeRes();
    await handler({ method: "POST" }, res);

    expect(res.statusCode).toBe(200);
    const [, opts] = mockStripe.checkout.sessions.create.mock.calls[0];
    expect(opts.idempotencyKey).toMatch(new RegExp(`^checkout-${uid}-\\d+$`));
  });

  it("uma falha ao criar a sessão na Stripe retorna 500 e ainda assim libera o lock", async () => {
    const uid = nextUid();
    mockUser = { uid, email: `${uid}@x.com` };
    mockStripe = freshStripe({
      checkoutSessions: { create: vi.fn().mockRejectedValue(new Error("Stripe indisponível (simulado)")) }
    });

    const res = makeRes();
    await handler({ method: "POST" }, res);

    expect(res.statusCode).toBe(500);
    const doc = await adminDb().collection("users").doc(uid).get();
    expect(doc.data().checkoutInProgress).toBeUndefined();
  });

  it("rejeita quem não está logado (401) sem tocar em lock nenhum", async () => {
    mockUser = null;
    const res = makeRes();
    await handler({ method: "POST" }, res);
    expect(res.statusCode).toBe(401);
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("rejeita método diferente de POST (405)", async () => {
    const uid = nextUid();
    mockUser = { uid, email: `${uid}@x.com` };
    const res = makeRes();
    await handler({ method: "GET" }, res);
    expect(res.statusCode).toBe(405);
  });

  it("sem STRIPE_PRICE_ID configurado, retorna 500 antes de tocar em lock ou Stripe", async () => {
    const uid = nextUid();
    mockUser = { uid, email: `${uid}@x.com` };
    delete process.env.STRIPE_PRICE_ID;

    const res = makeRes();
    await handler({ method: "POST" }, res);

    expect(res.statusCode).toBe(500);
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
    const doc = await adminDb().collection("users").doc(uid).get();
    expect(doc.exists).toBe(false);
  });
});
