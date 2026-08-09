/* =====================================================================
   TESTES — api/stripe-webhook.js, contra o Firebase Emulator
   =====================================================================
   Fase 3 do plano de testes. A verificação de assinatura do webhook
   (stripe.webhooks.constructEvent) é a parte mais crítica de segurança
   deste arquivo — testada aqui com uma instância REAL do SDK da Stripe
   (constructEvent/generateTestHeaderString são criptografia local, não
   fazem nenhuma chamada de rede, então dá pra testar de verdade sem
   precisar de uma chave de API real). As demais chamadas à Stripe
   (cancelar assinatura órfã) são mockadas.
   ===================================================================== */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("Rode via `npm run test:emulator` — este arquivo precisa do Firebase Emulator.");
}

const WEBHOOK_SECRET = "whsec_test_secret_para_os_testes";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

// Instância real só pra assinar/verificar localmente (nenhuma chamada de
// rede acontece por causa disso — constructEvent é HMAC puro).
const signingStripe = new Stripe("sk_test_fake_key_local_only");

let mockStripe;
vi.mock("../../api/_lib/stripe.js", () => ({
  getStripe: () => mockStripe
}));

const { default: handler } = await import("../../api/stripe-webhook.js");
const { adminDb, adminAuth } = await import("../../api/_lib/firebaseAdmin.js");
const { getApps, deleteApp } = await import("firebase-admin/app");

function freshStripe() {
  return {
    webhooks: signingStripe.webhooks,
    subscriptions: { cancel: vi.fn().mockResolvedValue({}) }
  };
}

// Constrói um req fake assíncrono-iterável (o handler lê o corpo bruto via
// `for await (const chunk of req)`, igual um IncomingMessage de verdade).
function makeReq(payload, { validSignature = true, headerOverride } = {}) {
  const sig = headerOverride !== undefined
    ? headerOverride
    : validSignature
      ? signingStripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
      : signingStripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_outra_chave_bem_diferente" });

  return {
    method: "POST",
    headers: { "stripe-signature": sig },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload);
    }
  };
}

function makeRes() {
  return {
    statusCode: null,
    body: null,
    _rawBody: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(text) { this._rawBody = text; return this; },
    end() { return this; }
  };
}

let uidCounter = 0;
function nextUid() {
  uidCounter += 1;
  return `wh-user-${uidCounter}`;
}

function stripeEvent(type, dataObject) {
  return JSON.stringify({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    data: { object: dataObject }
  });
}

afterAll(async () => {
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("api/stripe-webhook.js (Firebase Emulator)", () => {
  beforeEach(() => {
    mockStripe = freshStripe();
  });

  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  it("assinatura inválida → 400, evento nunca processado", async () => {
    const payload = stripeEvent("customer.subscription.deleted", { metadata: { uid: "alguem" }, status: "canceled" });
    const req = makeReq(payload, { validSignature: false });
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  it("assinatura válida → 200, evento processado normalmente", async () => {
    const uid = nextUid();
    await adminDb().collection("users").doc(uid).set({ email: `${uid}@x.com`, plan: "free" });

    const payload = stripeEvent("customer.subscription.updated", { metadata: { uid }, status: "active" });
    const res = makeRes();
    await handler(makeReq(payload), res);

    expect(res.statusCode).toBe(200);
    const snap = await adminDb().collection("users").doc(uid).get();
    expect(snap.data().plan).toBe("premium");
  });

  describe("customer.subscription.updated/deleted — conta já excluída não ressuscita", () => {
    it("evento pra um uid sem documento users/{uid} é ignorado (não cria o documento)", async () => {
      const uid = nextUid(); // nunca criado no Firestore
      const payload = stripeEvent("customer.subscription.updated", { metadata: { uid }, status: "active" });
      const res = makeRes();
      await handler(makeReq(payload), res);

      expect(res.statusCode).toBe(200);
      const snap = await adminDb().collection("users").doc(uid).get();
      expect(snap.exists).toBe(false);
    });

    it("subscription.deleted também não recria conta excluída", async () => {
      const uid = nextUid();
      const payload = stripeEvent("customer.subscription.deleted", { metadata: { uid }, status: "canceled" });
      const res = makeRes();
      await handler(makeReq(payload), res);

      expect(res.statusCode).toBe(200);
      const snap = await adminDb().collection("users").doc(uid).get();
      expect(snap.exists).toBe(false);
    });
  });

  describe("checkout.session.completed", () => {
    it("conta ativa: grava o stripeCustomerId normalmente", async () => {
      const uid = nextUid();
      await adminDb().collection("users").doc(uid).set({ email: `${uid}@x.com` });
      await adminAuth().createUser({ uid, email: `${uid}@x.com` });

      const payload = stripeEvent("checkout.session.completed", {
        client_reference_id: uid,
        customer: `cus_${uid}`,
        subscription: `sub_${uid}`
      });
      const res = makeRes();
      await handler(makeReq(payload), res);

      expect(res.statusCode).toBe(200);
      const snap = await adminDb().collection("users").doc(uid).get();
      expect(snap.data().stripeCustomerId).toBe(`cus_${uid}`);
      expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
    });

    it("checkout concluído DEPOIS de excluir a conta: não recria o documento e cancela a assinatura órfã", async () => {
      const uid = nextUid(); // sem doc no Firestore e sem usuário no Auth — conta já excluída

      const payload = stripeEvent("checkout.session.completed", {
        client_reference_id: uid,
        customer: `cus_${uid}`,
        subscription: `sub_${uid}`
      });
      const res = makeRes();
      await handler(makeReq(payload), res);

      expect(res.statusCode).toBe(200);
      const snap = await adminDb().collection("users").doc(uid).get();
      expect(snap.exists).toBe(false); // documento NÃO foi recriado

      expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith(`sub_${uid}`);
    });

    it("Auth existe mas o documento Firestore não (exclusão parcial/corrida): também trata como conta excluída", async () => {
      const uid = nextUid();
      await adminAuth().createUser({ uid, email: `${uid}@x.com` }); // só o Auth, sem doc

      const payload = stripeEvent("checkout.session.completed", {
        client_reference_id: uid,
        customer: `cus_${uid}`,
        subscription: `sub_${uid}`
      });
      const res = makeRes();
      await handler(makeReq(payload), res);

      expect(res.statusCode).toBe(200);
      const snap = await adminDb().collection("users").doc(uid).get();
      expect(snap.exists).toBe(false);
      expect(mockStripe.subscriptions.cancel).toHaveBeenCalledWith(`sub_${uid}`);
    });
  });
});
