/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — avalia a explicação do(a) estudante
   usando a Técnica de Feynman.
   =====================================================================
   Recebe: { title, referenceText, studentText }
   Chama a API da OpenRouter (formato compatível com OpenAI) com uma
   chave secreta guardada apenas no servidor (variável de ambiente
   OPENROUTER_API_KEY na Vercel — nunca fica exposta no navegador).
   Retorna: { nota, pontosCobertos, pontosFaltando, equivocos, feedback, qualidadeSM2 }

   Variáveis de ambiente:
   - OPENROUTER_API_KEY (obrigatória) — gerada em openrouter.ai/keys
   - OPENROUTER_MODEL (opcional) — slug do modelo no formato "provedor/modelo"
     (ver lista completa em openrouter.ai/models). Se não definida, usa
     um modelo padrão razoável para esta tarefa.
   ===================================================================== */

import { verifyUserFromRequest, checkAndConsumeUsage, refundUsage } from "./_lib/usage.js";
import { callOpenRouter, statusForOpenRouterError } from "./_lib/openrouter.js";

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

  const systemPrompt = `Você é um tutor que aplica a Técnica de Feynman: avalia se um(a) estudante conseguiu explicar um conceito com as próprias palavras, de forma clara e simples, como se estivesse ensinando alguém que não conhece o assunto.

Compare a explicação do(a) estudante com a explicação de referência fornecida. Avalie:
- Se as ideias centrais do conceito foram cobertas (mesmo com palavras diferentes da referência)
- Se há erros conceituais ou confusões
- Se a explicação está em linguagem simples e própria, e não apenas copiando frases da referência

Seja encorajador(a) mas honesto(a): se a explicação for fraca, diga isso claramente, com gentileza.

IMPORTANTE sobre o campo "equivocos": inclua APENAS erros que estejam claramente escritos no texto do(a)
estudante — nunca invente, presuma ou infira um equívoco que a pessoa não escreveu explicitamente. Se você
não tiver certeza absoluta de que algo é um erro real presente no texto, não o inclua. Na dúvida, prefira
uma lista vazia a apontar um equívoco questionável — um erro falso apontado é pior do que nenhum apontado.

Antes de incluir qualquer item em "equivocos", faça este teste: você consegue citar a frase exata do(a)
estudante que contém o erro? Se não conseguir apontar uma frase específica escrita por ele(a) que esteja
factualmente errada, NÃO inclua esse item — mesmo que pareça uma lacuna ou uma suposição razoável. Omissão
(algo que a pessoa não mencionou) não é equívoco; equívoco é algo que ela escreveu e que está errado.

Responda SOMENTE em JSON válido, exatamente neste formato, sem nenhum texto antes ou depois:
{
  "nota": <número inteiro de 0 a 100>,
  "pontosCobertos": ["...", "..."],
  "pontosFaltando": ["...", "..."],
  "equivocos": ["apenas erros claramente presentes no texto do(a) estudante; [] se nenhum"],
  "feedback": "parágrafo curto (2-3 frases), direto e encorajador, em português",
  "qualidadeSM2": <1, 3, 4 ou 5 — 1 se muito incompleta/incorreta, 3 se cobre parte com lacunas relevantes, 4 se boa e cobre o essencial, 5 se excelente e completa>
}`;

  const userPrompt = `Conceito: ${title}

Explicação de referência (o que o material ensina):
"""
${referenceText}
"""

Explicação escrita pelo(a) estudante, com as próprias palavras:
"""
${studentText}
"""`;

  try {
    const parsed = await callOpenRouter({
      apiKey,
      model,
      maxTokens: 3000,
      title: "Metodo Aprender - Modo Feynman",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

    // SEGURANÇA (SEC-04): valida e limita cada campo antes de devolver ao
    // cliente. A saída do modelo é influenciada pelo texto enviado (prompt
    // injection via PDF) e esses campos são renderizados em HTML no cliente
    // — nunca repassar o JSON do modelo sem filtrar.
    const cleanStr = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
    const cleanList = (v, maxItems, maxLen) =>
      (Array.isArray(v) ? v : []).filter(i => typeof i === "string").slice(0, maxItems).map(i => i.slice(0, maxLen));

    const notaRaw = Number(parsed.nota);
    const nota = Number.isFinite(notaRaw) ? Math.min(100, Math.max(0, Math.round(notaRaw))) : 0;
    // Mesma regra de fallback que o cliente já aplicava (assets/engine.js).
    const qualidadeSM2 = [1, 3, 4, 5].includes(parsed.qualidadeSM2)
      ? parsed.qualidadeSM2
      : (nota >= 85 ? 5 : nota >= 65 ? 4 : nota >= 40 ? 3 : 1);

    res.status(200).json({
      nota,
      pontosCobertos: cleanList(parsed.pontosCobertos, 10, 300),
      pontosFaltando: cleanList(parsed.pontosFaltando, 10, 300),
      equivocos: cleanList(parsed.equivocos, 10, 300),
      feedback: cleanStr(parsed.feedback, 1000),
      qualidadeSM2
    });
  } catch (e) {
    // A1-03: qualquer falha aqui (timeout/rede/HTTP/parse na OpenRouter, ou
    // um erro inesperado na validação abaixo) acontece DEPOIS de já ter
    // consumido 1 unidade da cota mensal (checkAndConsumeUsage, acima) e
    // ANTES de qualquer resposta válida ter chegado à pessoa — por isso
    // sempre estorna, independente da causa.
    await refundUsage(user.uid);
    if (e && e.code) {
      res.status(statusForOpenRouterError(e)).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Erro interno ao avaliar a explicação." });
  }
}
