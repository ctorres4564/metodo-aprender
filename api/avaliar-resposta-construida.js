/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — avaliação semântica por IA de uma
   resposta construída (recuperação ativa sem consulta, Prioridade 2).
   =====================================================================
   Recebe: { conceptTitle, referenceText, responseText }
   Chama a API da OpenRouter (mesma chave secreta server-side usada por
   api/avaliar-explicacao.js — nunca exposta no navegador) e devolve uma
   classificação estruturada:
   { classification: "incorrect"|"partial"|"correct", confidence: 0..1, reason, model }

   Esta chamada é estritamente adicional: o cliente já registrou a
   autoavaliação (recordConstructedResponseAttempt), atualizou FSRS e
   persistiu a tentativa ANTES de chamar este endpoint (ver
   requestConstructedAiEvaluation em assets/engine.js). Uma falha aqui
   (timeout, provedor fora do ar, saída inválida) não deve e não pode
   desfazer nada disso — o cliente trata qualquer erro/timeout como
   "avaliação semântica indisponível" e segue.

   Cota: balde PRÓPRIO "constructed_eval" (ver api/_lib/usage.js) — não
   compartilha nem disputa a cota mensal de "explain" (avaliar-explicacao.js).

   Variáveis de ambiente: mesmas de avaliar-explicacao.js
   (OPENROUTER_API_KEY obrigatória, OPENROUTER_MODEL opcional).
   ===================================================================== */
import { requireUsageQuota, refundUsage } from "./_lib/usage.js";
import { statusForOpenRouterError } from "./_lib/openrouter.js";
import { evaluateConstructedResponse } from "./_lib/constructedEvaluation.js";
import { withSentry } from "./_lib/sentry.js";

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const { conceptTitle, referenceText, responseText } = req.body || {};

  if (!responseText || typeof responseText !== "string" || responseText.trim().length < 10) {
    res.status(400).json({ error: "Resposta muito curta para avaliação semântica." });
    return;
  }
  if (!referenceText || !conceptTitle) {
    res.status(400).json({ error: "Requisição incompleta." });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENROUTER_API_KEY não configurada no servidor." });
    return;
  }

  // Balde PRÓPRIO ("constructed_eval", ver api/_lib/usage.js): a avaliação
  // semântica da resposta construída é um recurso pedagógico distinto do
  // modo Feynman e não pode consumir nem disputar a cota mensal de
  // "explain" — quem usa muito um dos dois não pode bloquear o outro.
  const uid = await requireUsageQuota(req, res, "constructed_eval");
  if (!uid) return;

  const model = process.env.OPENROUTER_MODEL;

  try {
    const result = await evaluateConstructedResponse({
      apiKey,
      model,
      conceptTitle: String(conceptTitle).slice(0, 300),
      referenceText: String(referenceText).slice(0, 4000),
      responseText: String(responseText).slice(0, 4000)
    });
    res.status(200).json(result);
  } catch (e) {
    // Mesma disciplina de estorno que os outros endpoints de IA: a cota
    // já foi consumida acima, então qualquer falha daqui em diante devolve
    // a unidade — a pessoa não recebeu avaliação nenhuma em troca.
    await refundUsage(uid, "constructed_eval");
    if (e && e.code) {
      res.status(statusForOpenRouterError(e)).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Erro interno ao avaliar semanticamente a resposta." });
  }
}

export default withSentry(handler);
