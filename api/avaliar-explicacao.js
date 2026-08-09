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

import { requireUsageQuota, refundUsage } from "./_lib/usage.js";
import { callOpenRouter, statusForOpenRouterError } from "./_lib/openrouter.js";

const DEFAULT_MODEL = "openai/gpt-4o-mini";

export default async function handler(req, res) {
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
  // 1 unidade da cota de ninguém.
  const uid = await requireUsageQuota(req, res, "explain");
  if (!uid) return;

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const systemPrompt = `Você é um tutor que aplica a Técnica de Feynman: avalia se um(a) estudante conseguiu explicar um conceito com as próprias palavras, de forma clara e simples, como se estivesse ensinando alguém que não conhece o assunto.

O propósito desta avaliação é distinguir compreensão real de fluência vazia. Um texto pode ser bem
escrito, usar todo o vocabulário técnico correto e mesmo assim não demonstrar entendimento nenhum.
Sua tarefa mais importante é não se deixar impressionar por isso.

PASSO 1 — IDENTIFICAR O MECANISMO
Antes de qualquer nota, identifique qual é o mecanismo central do conceito: a relação causal que faz
o conceito funcionar. Não são os elementos que ele cita — é o que acontece entre esses elementos.
Depois, procure no texto do(a) estudante uma frase que enuncie esse mecanismo, e copie-a no campo
"mecanismoNoTexto". Se nenhuma frase enunciar o mecanismo, escreva exatamente: NAO_ENCONTRADO.

Citar os elementos não é enunciar o mecanismo. Dizer que o conceito "relaciona custo e benefício"
é citar elementos; dizer o que precisa acontecer entre custo e benefício para o conceito valer é
enunciar o mecanismo.

PASSO 2 — TETOS OBRIGATÓRIOS DE NOTA
Aplique nesta ordem, antes de qualquer outra consideração:
- Se "mecanismoNoTexto" é NAO_ENCONTRADO, a nota NÃO PODE passar de 45, por melhor escrito que
  seja o texto.
- Se o texto é circular — reafirma o nome do conceito com outras palavras, elogia a importância do
  conceito, ou descreve o que ele "permite compreender" sem dizer o que ele afirma —, a nota NÃO
  PODE passar de 30. Um texto assim é fluente e vazio; é o caso mais importante de reconhecer.
- Se o texto enuncia o mecanismo mas de forma incorreta, a nota NÃO PODE passar de 40.
- Notas acima de 85 exigem mecanismo correto E completo, sem lacuna relevante.

Boa escrita, vocabulário técnico correto, extensão do texto e tom seguro NÃO aumentam a nota.
São irrelevantes para a avaliação. O único critério é: a pessoa demonstrou entender como o
conceito funciona?

PASSO 3 — AVALIAR O RESTO
Dentro do teto obtido acima, considere:
- Se as ideias centrais do conceito foram cobertas (mesmo com palavras diferentes da referência)
- Se há erros conceituais ou confusões
- Se a explicação está em linguagem simples e própria, e não apenas copiando frases da referência

Seja encorajador(a) mas honesto(a): se a explicação for fraca, diga isso claramente, com gentileza.
Não suavize a NOTA por gentileza — a gentileza vai no campo "feedback", nunca no número. Uma nota
generosa faz o conceito demorar semanas para voltar a ser revisado, o que prejudica quem confia nela.

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
  "mecanismoCentral": "<uma frase: qual a relação causal que faz este conceito funcionar>",
  "mecanismoNoTexto": "<a frase exata do(a) estudante que enuncia esse mecanismo, ou NAO_ENCONTRADO>",
  "nota": <número inteiro de 0 a 100, respeitando os tetos do PASSO 2>,
  "pontosCobertos": ["...", "..."],
  "pontosFaltando": ["...", "..."],
  "equivocos": ["apenas erros claramente presentes no texto do(a) estudante; [] se nenhum"],
  "feedback": "parágrafo curto (2-3 frases), direto e encorajador, em português",
  "qualidadeSM2": <1, 3, 4 ou 5 — 1 se o mecanismo não aparece ou está errado, 3 se aparece de forma incompleta, 4 se aparece correto com alguma lacuna, 5 se aparece correto e completo>
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
    let nota = Number.isFinite(notaRaw) ? Math.min(100, Math.max(0, Math.round(notaRaw))) : 0;

    // Teto aplicado aqui, e não só no prompt: a instrução do PASSO 2 é uma regra
    // do produto, não uma sugestão ao modelo. Sem mecanismo identificado no texto,
    // a nota não passa de 45 mesmo que o modelo tenha devolvido 90 — é o que
    // impede uma explicação fluente e vazia de ganhar um intervalo longo no FSRS.
    const mecanismoNoTexto = cleanStr(parsed.mecanismoNoTexto, 500).trim();
    const semMecanismo =
      !mecanismoNoTexto || mecanismoNoTexto.toUpperCase().includes("NAO_ENCONTRADO");
    if (semMecanismo) nota = Math.min(nota, 45);

    // Limiares mais rigorosos que os anteriores (85/65/40): errar para o lado do
    // rigor traz a ficha de volta mais cedo, o que é barato; errar para o lado da
    // generosidade é exatamente a ilusão de aprendizado que o modo Feynman existe
    // para quebrar. O valor do modelo é aceito apenas quando não conflita com a nota.
    const qualidadePelaNota = nota >= 90 ? 5 : nota >= 70 ? 4 : nota >= 45 ? 3 : 1;
    const qualidadeModelo = [1, 3, 4, 5].includes(parsed.qualidadeSM2)
      ? parsed.qualidadeSM2
      : qualidadePelaNota;
    const qualidadeSM2 = Math.min(qualidadeModelo, qualidadePelaNota);

    res.status(200).json({
      nota,
      mecanismoCentral: cleanStr(parsed.mecanismoCentral, 300),
      mecanismoNoTexto: semMecanismo ? "" : mecanismoNoTexto,
      pontosCobertos: cleanList(parsed.pontosCobertos, 10, 300),
      pontosFaltando: cleanList(parsed.pontosFaltando, 10, 300),
      equivocos: cleanList(parsed.equivocos, 10, 300),
      feedback: cleanStr(parsed.feedback, 1000),
      qualidadeSM2
    });
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
