/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — gera sugestões de conceitos (fichas de
   estudo) a partir de um texto-fonte (capítulo de livro, artigo etc.),
   usando um modelo de linguagem via OpenRouter.
   =====================================================================
   Recebe: { title, sourceText }
   Retorna: { concepts: [{ tag, title, text, q, options[4], correct }] }

   Importante: o texto retornado por "text" deve ser uma explicação em
   linguagem própria/paraseada do conceito — não uma cópia literal do
   texto-fonte — para não incentivar plágio de material com direitos
   autorais. O prompt abaixo instrui isso explicitamente.

   Variáveis de ambiente: mesmas usadas por api/avaliar-explicacao.js
   (OPENROUTER_API_KEY obrigatória, OPENROUTER_MODEL opcional).
   ===================================================================== */

import { verifyUserFromRequest, checkAndConsumeUsage } from "./_lib/usage.js";
import { extractJson } from "./_lib/parseJson.js";

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const MAX_SOURCE_CHARS = 14000;
const MAX_CONCEPTS = 20;

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

  const { title, sourceText } = req.body || {};

  if (!sourceText || typeof sourceText !== "string" || sourceText.trim().length < 200) {
    res.status(400).json({ error: "Texto muito curto para gerar conceitos. Envie um trecho mais completo." });
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
  const trimmedSource = sourceText.slice(0, MAX_SOURCE_CHARS);

  const systemPrompt = `Você ajuda a criar fichas de estudo (flashcards) de repetição espaçada a partir de um texto-fonte (capítulo de livro, artigo, apostila etc.) fornecido por um(a) usuário(a).

Sua tarefa: ler o texto-fonte e extrair os conceitos mais importantes e independentes entre si (ideias que fazem sentido sozinhas, sem depender de outra ficha para serem entendidas). Gere no máximo ${MAX_CONCEPTS} conceitos, priorizando qualidade e cobertura das ideias centrais em vez de quantidade.

Regras OBRIGATÓRIAS para cada conceito:
1. "title": um título curto (até ~8 palavras) que identifica o conceito.
2. "tag": uma categoria/etiqueta curta (1-3 palavras) para agrupar conceitos relacionados.
3. "text": uma explicação de 2 a 4 frases, em português, escrita com SUAS PRÓPRIAS PALAVRAS — nunca copie frases inteiras do texto-fonte. Parafraseie e simplifique como um bom professor explicaria, em linguagem clara e direta. Isso é importante por direitos autorais: o texto gerado deve ser uma síntese original, não uma cópia.
4. "q": uma pergunta de múltipla escolha simples que testa se a pessoa entendeu o conceito.
5. "options": exatamente 4 alternativas de resposta (strings curtas), sendo só uma correta. As alternativas erradas devem ser plausíveis, não absurdas.
6. "correct": o índice (0 a 3) da alternativa correta em "options".

Se o texto-fonte for muito curto, genérico demais, ou não tiver conteúdo suficiente para extrair conceitos de qualidade, gere quantos conceitos de qualidade forem possíveis (pode ser menos que ${MAX_CONCEPTS}, inclusive 0 se o texto não permitir nenhum).

Responda SOMENTE em JSON válido, exatamente neste formato, sem nenhum texto antes ou depois:
{
  "concepts": [
    { "tag": "...", "title": "...", "text": "...", "q": "...", "options": ["...", "...", "...", "..."], "correct": 0 }
  ]
}`;

  const userPrompt = `Título do módulo (contexto): ${title || "(sem título informado)"}

Texto-fonte:
"""
${trimmedSource}
"""`;

  try {
    const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.APP_URL || "https://metodo-aprender.vercel.app",
        "X-Title": "Metodo Aprender - Gerar Modulo"
      },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        reasoning: { effort: "low", exclude: true },
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
      res.status(502).json({ error: "Falha ao consultar o gerador de IA." });
      return;
    }

    const data = await orRes.json();
    const rawText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";

    let parsed;
    try {
      parsed = extractJson(rawText);
    } catch (parseErr) {
      console.error("Falha ao parsear JSON do modelo. Texto bruto:", rawText);
      res.status(502).json({ error: "Resposta do gerador em formato inesperado." });
      return;
    }

    const concepts = Array.isArray(parsed.concepts) ? parsed.concepts : [];

    // Validação/limpeza básica antes de devolver ao cliente
    const cleanConcepts = concepts
      .filter(c => c && c.title && c.text && c.q && Array.isArray(c.options) && c.options.length === 4 && typeof c.correct === "number")
      .slice(0, MAX_CONCEPTS)
      .map(c => ({
        tag: String(c.tag || "Geral").slice(0, 40),
        title: String(c.title).slice(0, 120),
        text: String(c.text).slice(0, 800),
        q: String(c.q).slice(0, 240),
        options: c.options.map(o => String(o).slice(0, 160)),
        correct: Math.min(3, Math.max(0, Math.round(c.correct)))
      }));

    res.status(200).json({ concepts: cleanConcepts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro interno ao gerar conceitos." });
  }
}
