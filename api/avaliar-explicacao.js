/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — avalia a explicação do(a) estudante
   usando a Técnica de Feynman.
   =====================================================================
   Recebe: { title, referenceText, studentText }
   Chama a API da OpenRouter (formato compatível com OpenAI) com uma
   chave secreta guardada apenas no servidor (variável de ambiente
   OPENROUTER_API_KEY na Vercel — nunca fica exposta no navegador).
   Retorna: { nota, mecanismoCentral, mecanismoNoTexto, pontosCobertos,
   pontosFaltando, equivocos, imprecisoes, feedback, qualidadeSM2,
   decisaoPedagogica, perguntaAprofundamento }

   Toda a lógica de prompt/teto/derivação de decisão pedagógica vive em
   api/_lib/explanationEvaluation.js (extraído para ficar testável sem
   rede) — este arquivo só cuida de método HTTP, validação de entrada,
   login/cota e status de resposta.

   O cliente (assets/engine.js) já persiste o `explainAttempt` do
   estudante ANTES de chamar este endpoint (status "pending_evaluation")
   — uma falha aqui (cota esgotada, timeout, erro do provedor) nunca
   apaga o texto que a pessoa escreveu; ver createExplainAttempt/
   evaluateExplainAttempt em assets/engine.js.

   Variáveis de ambiente:
   - OPENROUTER_API_KEY (obrigatória) — gerada em openrouter.ai/keys
   - OPENROUTER_MODEL (opcional) — slug do modelo no formato "provedor/modelo"
     (ver lista completa em openrouter.ai/models). Se não definida, usa
     um modelo padrão razoável para esta tarefa.
   ===================================================================== */

import { requireUsageQuota, refundUsage } from "./_lib/usage.js";
import { statusForOpenRouterError } from "./_lib/openrouter.js";
import { evaluateExplanation } from "./_lib/explanationEvaluation.js";
import { withSentry } from "./_lib/sentry.js";

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const { title, referenceText, studentText } = req.body || {};

  if (!studentText || typeof studentText !== "string" || studentText.trim().length < 20) {
    res.status(400).json({ error: "Escreva uma explicação mais completa antes de avaliar." });
    return;
  }
  if (!referenceText || !title) {
    res.status(400).json({ error: "Requisição incompleta." });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENROUTER_API_KEY não configurada no servidor." });
    return;
  }

  // V3-C: requireUsageQuota concentra login (401) + cota (403/429) numa
  // única chamada — antes esse bloco (checar login, depois checar/consumir
  // cota) era copiado quase idêntico nos 5 endpoints de IA. Fica DEPOIS da
  // validação do corpo e da checagem de OPENROUTER_API_KEY de propósito:
  // requisição malformada ou servidor mal configurado não deve consumir
  // 1 unidade da cota de ninguém. O 429 desta chamada é o sinal que o
  // cliente usa para manter o explainAttempt em "pending_evaluation" em
  // vez de "evaluation_failed" — ver evaluateExplainAttempt em engine.js.
  const uid = await requireUsageQuota(req, res, "explain");
  if (!uid) return;

  const model = process.env.OPENROUTER_MODEL;

  try {
    const result = await evaluateExplanation({ apiKey, model, title, referenceText, studentText });
    res.status(200).json(result);
  } catch (e) {
    // A1-03: qualquer falha aqui (timeout/rede/HTTP/parse na OpenRouter, ou
    // um erro inesperado na validação abaixo) acontece DEPOIS de já ter
    // consumido 1 unidade da cota mensal (requireUsageQuota, acima) e
    // ANTES de qualquer resposta válida ter chegado à pessoa — por isso
    // sempre estorna, independente da causa.
    await refundUsage(uid, "explain");
    if (e && e.code) {
      res.status(statusForOpenRouterError(e)).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Erro interno ao avaliar a explicação." });
  }
}

export default withSentry(handler);
