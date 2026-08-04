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

// Exportado porque também é usado em api/material.js, pra checar o limite
// de materiais na Biblioteca por plano (mesmo princípio do limite de IA).
export async function getUserPlan(uid) {
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
// Recebe o usuário decodificado (não só o uid) porque também bloqueia
// e-mail não verificado aqui — ver comentário abaixo.
// Retorna { allowed, current, limit, plan, reason? }.
export async function checkAndConsumeUsage(user) {
  const uid = user.uid;

  // Bloqueio de e-mail não verificado: sem isso, qualquer pessoa pode criar
  // contas descartáveis pra sempre ter uma cota mensal de IA "nova", sem
  // nunca pagar. `email_verified` já vem no token decodificado pelo
  // Firebase (claim padrão) — não precisa de leitura extra no Firestore.
  // Contas que já existiam antes desta checagem existir também caem aqui
  // até a pessoa verificar o e-mail (ver botão "reenviar e-mail de
  // verificação" no app).
  if (user.email_verified === false) {
    return { allowed: false, current: 0, limit: 0, plan: null, reason: "email_not_verified" };
  }

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

  const usage = await checkAndConsumeUsage(user);
  if (!usage.allowed) {
    if (usage.reason === "email_not_verified") {
      res.status(403).json({
        error: "Confirme seu e-mail antes de gerar conteúdo com IA. Reenvie o e-mail de verificação na tela inicial se não o recebeu.",
        code: "email_not_verified"
      });
    } else {
      res.status(429).json({
        error: `Limite mensal de gerações por IA atingido (${usage.current}/${usage.limit} no plano ${usage.plan}). O limite é renovado no início do próximo mês.`
      });
    }
    return null;
  }

  return user.uid;
}
