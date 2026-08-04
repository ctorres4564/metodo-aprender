/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — detecta a estrutura (capítulos/seções) de
   um documento longo (livro, artigo com várias seções etc.) usando IA,
   em vez de depender de um padrão fixo de texto tipo "Capítulo N".
   =====================================================================
   Recebe: { content, mode }
     - mode "text": content é o texto completo do documento (usado quando
       é curto o suficiente para caber inteiro numa única chamada).
     - mode "previews": content é uma versão compacta, com o início de
       cada página marcado como "[[PAGE N]] <primeiros ~150 caracteres>",
       usada para documentos longos (livros), para manter o custo/latência
       previsíveis independente do tamanho do livro.

   Retorna: { sections: [{ title, anchor }] }
     "anchor" é um trecho curto copiado EXATAMENTE do "content" enviado,
     que marca onde aquela seção começa — o cliente localiza a posição
     real com um indexOf/busca aproximada, em vez de depender de a IA
     acertar índices de caractere (isso é pouco confiável em LLMs).

   Variáveis de ambiente: mesmas usadas pelas outras funções em api/
   (OPENROUTER_API_KEY obrigatória, OPENROUTER_MODEL opcional).
   ===================================================================== */

import { verifyUserFromRequest, checkAndConsumeUsage } from "./_lib/usage.js";
import { extractJson } from "./_lib/parseJson.js";

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const MAX_CONTENT_CHARS = 45000;
const MAX_SECTIONS = 40;

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

  const { content, mode } = req.body || {};

  if (!content || typeof content !== "string" || content.trim().length < 500) {
    res.status(400).json({ error: "Conteúdo insuficiente para detectar a estrutura do documento." });
    return;
  }
  if (mode !== "text" && mode !== "previews") {
    res.status(400).json({ error: "Parâmetro 'mode' inválido." });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENROUTER_API_KEY não configurada no servidor." });
    return;
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
    return;
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const trimmedContent = content.slice(0, MAX_CONTENT_CHARS);

  const modeExplanation = mode === "text"
    ? `O texto abaixo é o CONTEÚDO COMPLETO de um documento (artigo, capítulo avulso etc.).`
    : `O texto abaixo NÃO é o conteúdo completo — é uma versão compacta de um livro longo, mostrando apenas
o início de cada página, marcado como "[[PAGE N]]" seguido de um trecho curto daquela página. Use essas
marcações para identificar em qual página cada capítulo/seção nova começa.`;

  const systemPrompt = `Você identifica a estrutura de divisão (capítulos, seções, partes) de um documento de estudo.

${modeExplanation}

Sua tarefa: identificar os pontos onde uma nova divisão principal começa (ex: "Capítulo 1", "Parte II", "Introdução",
"1. Método", nomes de seção sem numeração, qualquer convenção que o documento usar). Ignore títulos de subseções
menores (ex: não separe cada subtópico dentro de um capítulo, só as divisões principais). Se o documento for um
artigo simples sem divisões internas claras, retorne uma lista com 1 único item cobrindo o documento inteiro.

Para cada divisão encontrada, retorne:
- "title": o título dessa divisão/capítulo/seção, limpo (sem numeração de página, sem lixo de formatação).
- "anchor": ${mode === "text"
    ? `um trecho de 8 a 15 palavras, copiado EXATAMENTE (character by character) do texto fornecido, do ponto exato onde essa divisão começa. Precisa ser uma cópia literal — não parafraseie.`
    : `a marcação exata "[[PAGE N]]" (substituindo N pelo número correto) da página onde essa divisão começa, copiada exatamente como aparece no texto fornecido.`}

Gere no máximo ${MAX_SECTIONS} divisões, priorizando as divisões principais e reais do documento.

Responda SOMENTE em JSON válido, exatamente neste formato, sem nenhum texto antes ou depois:
{ "sections": [ { "title": "...", "anchor": "..." } ] }`;

  const userPrompt = `Conteúdo:\n"""\n${trimmedContent}\n"""`;

  try {
    const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.APP_URL || "https://metodo-aprender.vercel.app",
        "X-Title": "Metodo Aprender - Detectar Capitulos"
      },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        // Alguns modelos (ex: DeepSeek V4 Pro) usam tokens extras "raciocinando" antes
        // de responder. Essa tarefa não precisa disso — pedimos esforço baixo e para
        // não misturar o raciocínio dentro do texto de resposta (o que quebraria o JSON).
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
      res.status(502).json({ error: "Falha ao consultar o detector de estrutura." });
      return;
    }

    const data = await orRes.json();
    const rawText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";

    let parsed;
    try {
      parsed = extractJson(rawText);
    } catch (parseErr) {
      console.error("Falha ao parsear JSON do modelo. Texto bruto:", rawText);
      res.status(502).json({ error: "Resposta do detector em formato inesperado." });
      return;
    }

    const sections = Array.isArray(parsed.sections) ? parsed.sections : [];
    const cleanSections = sections
      .filter(s => s && typeof s.title === "string" && typeof s.anchor === "string" && s.anchor.trim().length > 0)
      .slice(0, MAX_SECTIONS)
      .map(s => ({ title: s.title.slice(0, 160), anchor: s.anchor.slice(0, 300) }));

    res.status(200).json({ sections: cleanSections });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro interno ao detectar estrutura do documento." });
  }
}
