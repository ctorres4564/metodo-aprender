/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — gera uma explicação alternativa de um
   conceito usando analogia/metáfora, para ajudar na fixação (aba Aprender).
   =====================================================================
   Recebe: { title, referenceText }
   Retorna: { analogia }

   Variáveis de ambiente: mesmas usadas pelas outras funções em api/
   (OPENROUTER_API_KEY obrigatória, OPENROUTER_MODEL opcional).
   ===================================================================== */

import { verifyUserFromRequest, checkAndConsumeUsage } from "./_lib/usage.js";

const DEFAULT_MODEL = "openai/gpt-4o-mini";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const user = await verifyUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Sessão expirada ou inválida. Faça login novamente e tente de novo." });
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

  const usage = await checkAndConsumeUsage(user.uid);
  if (!usage.allowed) {
    res.status(429).json({
      error: `Limite mensal de gerações por IA atingido (${usage.current}/${usage.limit} no plano ${usage.plan}). O limite é renovado no início do próximo mês.`
    });
    return;
  }

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
    const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.APP_URL || "https://metodo-aprender.vercel.app",
        "X-Title": "Metodo Aprender - Analogias"
      },
      body: JSON.stringify({
        model,
        max_tokens: 400,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!orRes.ok) {
      const errText = await orRes.text();
      console.error("Erro OpenRouter:", orRes.status, errText);
      res.status(502).json({ error: "Falha ao consultar o gerador de analogias." });
      return;
    }

    const data = await orRes.json();
    const rawText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";

    let parsed;
    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : rawText);
    } catch (parseErr) {
      console.error("Falha ao parsear JSON do modelo:", rawText);
      res.status(502).json({ error: "Resposta do gerador em formato inesperado." });
      return;
    }

    const analogia = typeof parsed.analogia === "string" ? parsed.analogia.slice(0, 900) : "";
    if (!analogia) {
      res.status(502).json({ error: "Não foi possível gerar uma analogia agora." });
      return;
    }

    res.status(200).json({ analogia });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro interno ao gerar analogia." });
  }
}
