import { describe, expect, it } from "vitest";
import {
  claimPurchaseEvent,
  markPurchaseFailed,
  markPurchaseSent,
} from "./redditPurchaseStore.js";
import { sha256Hex } from "./redditConversions.js";

function createStoreDb() {
  const store = new Map();
  let queue = Promise.resolve();
  const docRef = (path) => ({
    path,
    async set(data, options) {
      const previous = options?.merge ? (store.get(path) || {}) : {};
      store.set(path, { ...previous, ...data });
    },
  });
  const db = {
    collection(name) {
      return { doc: (id) => docRef(`${name}/${id}`) };
    },
    runTransaction(fn) {
      const result = queue.then(() => fn({
        get: async (ref) => ({
          exists: store.has(ref.path),
          data: () => store.get(ref.path),
        }),
        set: (ref, data, options) => ref.set(data, options),
      }));
      queue = result.catch(() => {});
      return result;
    },
    get(conversionId) {
      return store.get(`reddit_purchase_events/${sha256Hex(conversionId)}`);
    },
  };
  return db;
}

describe("idempotência de Purchase", () => {
  it("permite um claim e bloqueia processamento concorrente", async () => {
    const db = createStoreDb();
    const first = await claimPurchaseEvent(db, "eduzz:1:purchase", 1000);
    const second = await claimPurchaseEvent(db, "eduzz:1:purchase", 1001);
    expect(first.status).toBe("claimed");
    expect(second.status).toBe("in_progress");
  });

  it("marca envio e trata reentrega como duplicada", async () => {
    const db = createStoreDb();
    const claim = await claimPurchaseEvent(db, "eduzz:2:purchase", 1000);
    await markPurchaseSent(claim.ref, 1100);
    expect((await claimPurchaseEvent(db, "eduzz:2:purchase", 1200)).status).toBe("duplicate");
  });

  it("libera nova tentativa após falha", async () => {
    const db = createStoreDb();
    const claim = await claimPurchaseEvent(db, "eduzz:3:purchase", 1000);
    await markPurchaseFailed(claim.ref, "reddit_timeout", 1100);
    expect((await claimPurchaseEvent(db, "eduzz:3:purchase", 1200)).status).toBe("claimed");
    expect(db.get("eduzz:3:purchase").attempts).toBe(2);
  });
});
