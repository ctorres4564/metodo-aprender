import { sha256Hex } from "./redditConversions.js";

const COLLECTION = "reddit_purchase_events";
const LEASE_MS = 2 * 60 * 1000;

function eventRef(db, conversionId) {
  return db.collection(COLLECTION).doc(sha256Hex(conversionId));
}

export async function claimPurchaseEvent(db, conversionId, now = Date.now()) {
  const ref = eventRef(db, conversionId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data() : null;
    if (current?.status === "sent") return { status: "duplicate", ref };
    if (current?.status === "processing" && current.leaseUntil > now) {
      return { status: "in_progress", ref };
    }

    tx.set(ref, {
      conversionId,
      status: "processing",
      leaseUntil: now + LEASE_MS,
      attempts: (current?.attempts || 0) + 1,
      updatedAt: now,
    }, { merge: true });
    return { status: "claimed", ref };
  });
}

export async function markPurchaseSent(ref, now = Date.now()) {
  await ref.set({ status: "sent", sentAt: now, leaseUntil: 0, updatedAt: now }, { merge: true });
}

export async function markPurchaseFailed(ref, errorCode, now = Date.now()) {
  await ref.set({
    status: "retryable_error",
    errorCode: String(errorCode || "unknown").slice(0, 100),
    leaseUntil: 0,
    updatedAt: now,
  }, { merge: true });
}
