/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — localiza UMA seção específica dentro de um
   documento longo, com base numa descrição em texto livre do(a) usuário(a)
   (ex: "Parte 1", "capítulo 3", "a seção sobre memória de trabalho").
   =====================================================================
   Diferente de api/detectar-capitulos.js (que tenta mapear TODAS as
   divisões do documento de uma vez, custando uma chamada cara por livro),
   esta função só precisa achar UMA seção por vez — muito mais rápida e
   barata, e não depende do documento seguir um padrão fixo de numeração.

   Recebe: { content, mode, target }
     - mode "text": content é o texto completo do documento.
     - mode "previews": content é a versão compacta com marcações
       "[[PAGE N]]" (documentos longos).
     - target: descrição em texto livre do que a pessoa quer (obrigatório).

   Retorna: { title, startAnchor, nextAnchor }
     "startAnchor"/"nextAnchor" são trechos curtos copiados EXATAMENTE do
     "content" enviado (ou a marcação "[[PAGE N]]" no modo previews), que
     o cliente localiza com indexOf/busca aproximada para descobrir onde a
     seção pedida começa e onde a seção seguinte começa (ou seja, onde a
     pedida termina). "nextAnchor" pode vir vazio se for a última seção.

   Variáveis de ambiente: mesmas usadas pelas outras funções em api/
   (OPENROUTER_API_KEY obrigatória, OPENROUTER_MODEL opcional).
   ===================================================================== */
import { verifyUserFromRequest, checkAndConsumeUsage } from "./_lib/usage.js";
import { extractJson } from "./_lib/parseJson.js";

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const MAX_CONTENT_CHARS = 45000;

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

  const { content, mode, target } = req.body || {};

  if (!content || typeof content !== "string" || content.trim().length < 500) {
    res.status(400).json({ error: "Conteúdo insuficiente para localizar a seção." });
    return;
  }
  if (mode !== "text" && mode !== "previews") {
    res.status(400).json({ error: "Parâmetro 'mode' inválido." });
    return;
  }
  if (!target || typeof target !== "string" || target.trim().length < 2) {
    res.status(400).json({ error: "Diga o que você quer transformar em módulo (ex: 'Parte 1', 'capítulo 3', 'a seção sobre memória')." });
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
  const trimmedContent = content.slice(0, MAX_CONTENT_CHARS);

  const modeExplanation = mode === "text"
    ? `O texto abaixo é o CONTEÚDO COMPLETO de um documento.`
    : `O texto abaixo NÃO é o conteúdo completo — é uma versão compacta de um livro longo, mostrando apenas
o início de cada página, marcado como "[[PAGE N]]" seguido de um trecho curto daquela página.`;

  const systemPrompt = `Você localiza uma seção específica dentro de um documento de estudo, com base no que um(a) usuário(a) pediu.

${modeExplanation}

O(a) usuário(a) quer transformar em módulo de estudo a seção descrita como: "${target.trim()}"
Essa descrição pode ser um número/nome de divisão (ex: "Parte 1", "Capítulo 3"), ou uma descrição livre do assunto
(ex: "a parte sobre memória de trabalho"). Encontre, no conteúdo fornecido, onde essa seção começa e onde a
PRÓXIMA seção de mesmo nível começa logo depois (para sabermos onde a pedida termina).

ATENÇÃO: se o documento tiver um Sumário/Índice no início (uma lista de títulos com números de página, geralmente
próxima do começo do conteúdo), NÃO use uma linha desse sumário como o início da seção — o sumário só lista os
títulos, não é o conteúdo real. Você precisa encontrar onde o conteúdo DAQUELA seção de fato começa (normalmente
bem mais adiante no documento, com o título aparecendo de novo seguido do texto real, não de reticências e um
número de página). Se não tiver certeza se um trecho é o sumário ou o conteúdo real, prefira a ocorrência que vem
depois no documento e tem texto corrido narrativo/explicativo na sequência.

Retorne:
- "title": um título curto e limpo para a seção encontrada.
- "startAnchor": ${mode === "text"
    ? `um trecho de 8 a 15 palavras, copiado EXATAMENTE do texto fornecido, do ponto onde a seção pedida começa.`
    : `a marcação exata "[[PAGE N]]" da página onde a seção pedida começa.`}
- "nextAnchor": ${mode === "text"
    ? `mesma regra do startAnchor, mas para o início da seção seguinte (string vazia "" se a seção pedida for a última do documento).`
    : `mesma regra do startAnchor, mas para a página onde a seção seguinte começa (string vazia "" se for a última).`}

Se não conseguir identificar com confiança a seção pedida no conteúdo fornecido, retorne "title", "startAnchor" e "nextAnchor" todos como string vazia "".

Responda SOMENTE em JSON válido, exatamente neste formato, sem nenhum texto antes ou depois:
{ "title": "...", "startAnchor": "...", "nextAnchor": "..." }`;

  const userPrompt = `Conteúdo:\n"""\n${trimmedContent}\n"""`;

  try {
    const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.APP_URL || "https://metodo-aprender.vercel.app",
        "X-Title": "Metodo Aprender - Localizar Secao"
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
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
      res.status(502).json({ error: "Falha ao consultar o localizador de seção." });
      return;
    }

    const data = await orRes.json();
    const rawText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";

    let parsed;
    try {
      parsed = extractJson(rawText);
    } catch (parseErr) {
      console.error("Falha ao parsear JSON do modelo. Texto bruto:", rawText);
      res.status(502).json({ error: "Resposta do localizador em formato inesperado." });
      return;
    }

    if (!parsed.startAnchor) {
      res.status(200).json({ found: false });
      return;
    }

    res.status(200).json({
      found: true,
      title: String(parsed.title || target).slice(0, 160),
      startAnchor: String(parsed.startAnchor).slice(0, 300),
      nextAnchor: parsed.nextAnchor ? String(parsed.nextAnchor).slice(0, 300) : ""
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro interno ao localizar a seção." });
  }
}
