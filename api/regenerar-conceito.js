/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — regenera/melhora UM conceito específico
   de um módulo, sem precisar reprocessar o texto-fonte inteiro.
   =====================================================================
   Recebe: { moduleTitle, concept: { tag, title, text, q, options[4], correct }, instruction }
   Retorna: { concept: { tag, title, text, q, options[4], correct } }

   "instruction" é opcional: uma frase livre da pessoa usuária pedindo um
   ajuste específico (ex: "deixe mais simples", "as alternativas estão
   óbvias demais", "foque mais em datas"). Sem instrução, a IA só melhora
   a clareza da explicação e a qualidade das alternativas erradas, usando
   as mesmas regras de qualidade de api/gerar-modulo.js.

   Variáveis de ambiente: mesmas usadas por api/gerar-modulo.js
   (OPENROUTER_API_KEY obrigatória, OPENROUTER_MODEL opcional).
   ===================================================================== */

import { requireUsageQuota, refundUsage } from "./_lib/usage.js";
import { callOpenRouter, statusForOpenRouterError } from "./_lib/openrouter.js";
import { cleanStr } from "./_lib/sanitize.js";
import { withSentry } from "./_lib/sentry.js";

const DEFAULT_MODEL = "openai/gpt-4o-mini";

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const { moduleTitle, concept, instruction } = req.body || {};

  if (!concept || typeof concept !== "object" || !concept.title || !concept.text || !concept.q || !Array.isArray(concept.options) || concept.options.length !== 4) {
    res.status(400).json({ error: "Conceito inválido ou incompleto para regenerar." });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENROUTER_API_KEY não configurada no servidor." });
    return;
  }

  // V3-C: ver comentário equivalente em api/avaliar-explicacao.js.
  const uid = await requireUsageQuota(req, res);
  if (!uid) return;

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const cleanInstruction = cleanStr(instruction, 300);

  const systemPrompt = `Você ajuda a melhorar UMA ficha de estudo (conceito) de um módulo de repetição espaçada. Vai receber a ficha atual e deve devolver uma versão melhorada dela, em português.

Regras OBRIGATÓRIAS:
1. "title": um título curto (até ~8 palavras) que identifica o conceito.
2. "tag": uma categoria/etiqueta curta (1-3 palavras).
3. "text": uma explicação de 2 a 4 frases, clara e direta, com palavras próprias (nunca cópia literal de outro lugar).
4. "q": uma pergunta de múltipla escolha simples que testa se a pessoa entendeu o conceito.
5. "options": exatamente 4 alternativas de resposta. Elas precisam ser difíceis de adivinhar por eliminação, mesmo por quem não domina o assunto. Siga estas regras ao criar as 3 alternativas erradas:
   - Devem ser sobre o MESMO assunto/categoria da resposta certa, nunca de um assunto claramente diferente.
   - Devem ter aproximadamente o mesmo tamanho e nível de detalhe da resposta certa — nunca deixe a opção correta visivelmente mais longa, mais específica ou mais "bem escrita" que as outras.
   - Prefira confusões plausíveis e reais sobre o tema: um conceito parecido mas diferente, uma troca de causa por efeito, uma definição parcialmente certa mas incompleta ou distorcida, um equívoco comum de quem não domina o assunto.
   - Evite palavras absolutas nas opções erradas ("sempre", "nunca", "todos", "nenhum", "impossível").
   - Evite opções vagas, incompletas ou obviamente sem sentido.
6. "correct": o índice (0 a 3) da alternativa correta em "options".

${cleanInstruction ? `A pessoa usuária pediu especificamente este ajuste: "${cleanInstruction}" — priorize atender esse pedido, mantendo a qualidade das outras regras.` : "Sem pedido específico: apenas melhore a clareza da explicação e fortaleça a qualidade das 3 alternativas erradas (evite deixá-las óbvias)."}

Responda SOMENTE em JSON válido, exatamente neste formato, sem nenhum texto antes ou depois:
{ "concept": { "tag": "...", "title": "...", "text": "...", "q": "...", "options": ["...", "...", "...", "..."], "correct": 0 } }`;

  const userPrompt = `Módulo (contexto): ${moduleTitle || "(sem título informado)"}

Ficha atual:
{
  "tag": ${JSON.stringify(concept.tag || "")},
  "title": ${JSON.stringify(concept.title)},
  "text": ${JSON.stringify(concept.text)},
  "q": ${JSON.stringify(concept.q)},
  "options": ${JSON.stringify(concept.options)},
  "correct": ${typeof concept.correct === "number" ? concept.correct : 0}
}`;

  try {
    const parsed = await callOpenRouter({
      apiKey,
      model,
      maxTokens: 1500,
      title: "Metodo Aprender - Regenerar Conceito",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    const c = parsed.concept;
    if (!c || !c.title || !c.text || !c.q || !Array.isArray(c.options) || c.options.length !== 4 || typeof c.correct !== "number") {
      await refundUsage(uid);
      res.status(502).json({ error: "A IA não devolveu um conceito válido. Tente novamente." });
      return;
    }

    const cleanConcept = {
      tag: cleanStr(c.tag || "Geral", 40),
      title: cleanStr(c.title, 120),
      text: cleanStr(c.text, 800),
      q: cleanStr(c.q, 240),
      options: c.options.map(o => cleanStr(o, 160)),
      correct: Math.min(3, Math.max(0, Math.round(c.correct)))
    };

    res.status(200).json({ concept: cleanConcept });
  } catch (e) {
    await refundUsage(uid);
    if (e && e.code) {
      res.status(statusForOpenRouterError(e)).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Erro interno ao regenerar conceito." });
  }
}

export default withSentry(handler);