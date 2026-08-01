/* =====================================================================
   Verificação de login + controle de uso mensal de IA por usuário.
   =====================================================================
   Usado por todas as funções que chamam a OpenRouter (avaliar-explicacao,
   gerar-modulo, detectar-capitulos, gerar-analogia) para garantir que:
   1. Só quem tem conta (login válido) consegue gastar créditos de IA.
   2. Cada pessoa tem um limite mensal de gerações, por plano.

   Ainda não existe cobrança de verdade (isso é a Fase 2) — por enquanto
   todo mundo cai no plano "free", mas a estrutura já fica pronta: quando
   houver um plano pago, basta gravar plan:"premium" no documento
   users/{uid} (o que o webhook do Stripe vai fazer) que o limite maior
   passa a valer automaticamente, sem mudar mais nada aqui.
   ===================================================================== */
import { adminAuth, adminDb } from "./firebaseAdmin.js";

const PLAN_LIMITS = {
  free: 40,
  premium: 400
};

function currentMonthKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Extrai e valida o token de login enviado pelo cliente no header
// "Authorization: Bearer <idToken>". Retorna o usuário decodificado (uid,
// email...) ou null se não houver token válido.
export async function verifyUserFromRequest(req) {
  const header = req.headers["authorization"] || req.headers["Authorization"];
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  try {
    return await adminAuth().verifyIdToken(token);
  } catch (e) {
    console.error("Token de login inválido:", e.message);
    return null;
  }
}

async function getUserPlan(uid) {
  try {
    const snap = await adminDb().collection("users").doc(uid).get();
    if (snap.exists && snap.data().plan) return snap.data().plan;
  } catch (e) {
    console.error("Falha ao ler plano do usuário, usando 'free':", e.message);
  }
  return "free";
}

// Verifica se o usuário ainda tem cota disponível no mês e, se tiver,
// já consome 1 unidade (operação atômica via transação do Firestore).
// Retorna { allowed, current, limit, plan }.
export async function checkAndConsumeUsage(uid) {
  const plan = await getUserPlan(uid);
  const limit = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  const db = adminDb();
  const ref = db.collection("ai_usage").doc(`${uid}_${currentMonthKey()}`);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? snap.data().count || 0 : 0;
    if (current >= limit) {
      return { allowed: false, current, limit, plan };
    }
    tx.set(ref, { count: current + 1, uid, updatedAt: Date.now() }, { merge: true });
    return { allowed: true, current: current + 1, limit, plan };
  });

  return result;
}

// Atalho usado no início de cada handler de IA: garante login + cota,
// e já escreve a resposta de erro (401/429) se algo bloquear. Retorna o
// uid se estiver tudo certo, ou null se já respondeu com erro.
export async function requireUsageQuota(req, res) {
  const user = await verifyUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Sessão expirada ou inválida. Faça login novamente e tente de novo." });
    return null;
  }

  const usage = await checkAndConsumeUsage(user.uid);
  if (!usage.allowed) {
    res.status(429).json({
      error: `Limite mensal de gerações por IA atingido (${usage.current}/${usage.limit} no plano ${usage.plan}). O limite é renovado no início do próximo mês.`
    });
    return null;
  }

  return user.uid;
}
