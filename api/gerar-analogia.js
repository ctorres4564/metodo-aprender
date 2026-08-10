/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — gera uma explicação alternativa de um
   conceito usando analogia/metáfora, para ajudar na fixação (aba Aprender).
   =====================================================================
   Recebe: { title, referenceText }
   Retorna: { analogia }

   Variáveis de ambiente: mesmas usadas pelas outras funções em api/
   (OPENROUTER_API_KEY obrigatória, OPENROUTER_MODEL opcional).
   ===================================================================== */

import { requireUsageQuota, refundUsage } from "./_lib/usage.js";
import { callOpenRouter, statusForOpenRouterError } from "./_lib/openrouter.js";
import { withSentry } from "./_lib/sentry.js";

const DEFAULT_MODEL = "openai/gpt-4o-mini";

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const { title, referenceText } = req.body || {};

  if (!title || !referenceText) {
    res.status(400).json({ error: "Requisição incompleta." });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENROUTER_API_KEY não configurada no servidor." });
    return;
  }

  // V3-C: ver comentário equivalente em api/avaliar-explicacao.js.
  const uid = await requireUsageQuota(req, res, "explain");
  if (!uid) return;

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const systemPrompt = `Você ajuda estudantes a fixar conceitos criando explicações alternativas baseadas em ANALOGIAS e METÁFORAS do dia a dia.

Dado um conceito e sua explicação original, crie uma explicação alternativa curta (2 a 4 frases, em português) que:
- Use uma analogia ou comparação concreta e familiar (situações do cotidiano, objetos comuns, experiências universais) para tornar o conceito mais fácil de visualizar e lembrar.
- NÃO repita a explicação original com outras palavras — a analogia deve ser um ângulo genuinamente diferente de olhar para o mesmo conceito.
- Seja fiel ao conceito: a analogia não pode distorcer ou simplificar a ponto de ficar errada.
- Tenha um tom leve e envolvente, como um bom professor contando uma história rápida.

Responda SOMENTE em JSON válido, exatamente neste formato, sem nenhum texto antes ou depois:
{ "analogia": "..." }`;

  const userPrompt = `Conceito: ${title}

Explicação original:
"""
${referenceText}
"""`;

  try {
    const parsed = await callOpenRouter({
      apiKey,
      model,
      maxTokens: 1800,
      title: "Metodo Aprender - Analogias",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const analogia = typeof parsed.analogia === "string" ? parsed.analogia.slice(0, 900) : "";
    if (!analogia) {
      // A1-03: resposta "vazia" da IA também é uma falha (nada útil foi
      // entregue) — estorna a cota consumida, igual às falhas de rede/parse.
      await refundUsage(uid, "explain");
      res.status(502).json({ error: "Não foi possível gerar uma analogia agora." });
      return;
    }

    res.status(200).json({ analogia });
  } catch (e) {
    await refundUsage(uid, "explain");
    if (e && e.code) {
      res.status(statusForOpenRouterError(e)).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Erro interno ao gerar analogia." });
  }
}

export default withSentry(handler);
