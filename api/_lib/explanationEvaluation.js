/* =====================================================================
   Avaliação da explicação (Técnica de Feynman) — Prioridade 3.
   =====================================================================
   Extraído de api/avaliar-explicacao.js para ficar testável sem rede
   (mesmo padrão de api/_lib/constructedEvaluation.js): monta o prompt,
   chama a IA via callOpenRouter, e aplica os tetos de nota e a derivação
   de qualidadeSM2/decisaoPedagogica — tudo isso de forma determinística
   em código, nunca confiando cegamente no que o modelo devolve.

   O endpoint (api/avaliar-explicacao.js) fica responsável só por login/
   cota/HTTP; toda a lógica de avaliação em si vive aqui.
   ===================================================================== */
import { callOpenRouter } from "./openrouter.js";
import { cleanStr, cleanList } from "./sanitize.js";

export const DEFAULT_MODEL = "openai/gpt-4o-mini";

// Limiar de aprovação — inalterado nesta tarefa (ver EXPLANATION_PASS_SCORE
// em assets/engine.js, que precisa continuar em sincronia com este valor).
export const EXPLANATION_PASS_SCORE = 70;

// Taxonomia da decisão pedagógica estruturada. "pending_evaluation" NÃO
// aparece aqui de propósito: essa função só roda quando já existe uma
// resposta da IA para avaliar, então a decisão sempre é uma das três
// abaixo — "pending_evaluation" é um estado do ATTEMPT (ver
// assets/engine.js), não algo que este endpoint decide ou retorna.
export const PEDAGOGICAL_DECISIONS = Object.freeze(["passed", "retry_recommended", "return_to_comprehension"]);

// Limites da pergunta de aprofundamento (followUpQuestion) — curta o
// bastante pra não virar uma segunda atividade completa (Aplicar
// continua fora de escopo), longa o bastante pra exigir elaboração real.
export const FOLLOW_UP_MIN_LENGTH = 10;
export const FOLLOW_UP_MAX_LENGTH = 300;

function buildMessages(title, referenceText, studentText) {
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

IMPORTANTE sobre a diferença entre "equivocos" e "imprecisoes": um EQUÍVOCO é uma afirmação
INCOMPATÍVEL com o conceito — algo que, se fosse verdade, contradiria como o conceito realmente
funciona. Uma IMPRECISÃO é uma formulação incompleta, pouco precisa ou tecnicamente imperfeita, mas
que NÃO invalida o núcleo correto do que a pessoa disse — por exemplo, usar um termo de forma vaga,
simplificar demais um detalhe secundário, ou deixar implícito algo que deveria ser dito com mais
precisão, sem que isso vire uma afirmação falsa. O mesmo teste de "equivocos" vale aqui: só inclua em
"imprecisoes" algo que você consegue apontar como frase específica do texto do(a) estudante.

PASSO 4 — PERGUNTA DE APROFUNDAMENTO
Depois de avaliar, formule UMA pergunta adicional sobre o MESMO conceito (campo
"perguntaAprofundamento"). Ela precisa:
- exigir elaboração — nunca ser de múltipla escolha, nunca respondível com "sim"/"não" ou uma
  palavra só;
- não poder ser respondida apenas copiando a explicação de referência;
- não repetir literalmente o nome/título do conceito como pergunta;
- não entregar a resposta implicitamente dentro da própria pergunta.

Explore, preferencialmente nesta ordem, o que a explicação da pessoa ainda não cobriu bem:
1. o mecanismo causal (o "como"/"por quê" do funcionamento, se ainda estiver fraco);
2. a relação entre partes/elementos do conceito;
3. uma consequência do conceito;
4. um limite ou exceção em que ele NÃO se aplica;
5. um exemplo diferente do que a pessoa já usou;
6. uma comparação com um conceito próximo, frequentemente confundido com este.

Esta pergunta NÃO é uma atividade de aplicação prática nem de transferência para um contexto novo —
é mais estreita que isso, só um aprofundamento sobre o mesmo conceito. Calibre pela força da
explicação que você acabou de avaliar: se o mecanismo não apareceu ou apareceu errado, mantenha a
pergunta simples (verificar se a pessoa reconhece o problema, não cobrar mais do que ela já mostrou
conseguir); se a explicação só teve lacunas menores, foque a pergunta na principal lacuna; se a
explicação foi sólida, pode explorar limite/exceção, consequência ou comparação — ir além do que já
foi coberto.

Responda SOMENTE em JSON válido, exatamente neste formato, sem nenhum texto antes ou depois:
{
  "mecanismoCentral": "<uma frase: qual a relação causal que faz este conceito funcionar>",
  "mecanismoNoTexto": "<a frase exata do(a) estudante que enuncia esse mecanismo, ou NAO_ENCONTRADO>",
  "nota": <número inteiro de 0 a 100, respeitando os tetos do PASSO 2>,
  "pontosCobertos": ["...", "..."],
  "pontosFaltando": ["...", "..."],
  "equivocos": ["apenas erros claramente presentes no texto do(a) estudante, incompatíveis com o conceito; [] se nenhum"],
  "imprecisoes": ["apenas formulações incompletas/pouco precisas presentes no texto, que não chegam a ser um equívoco; [] se nenhuma"],
  "feedback": "parágrafo curto (2-3 frases), direto e encorajador, em português",
  "qualidadeSM2": <1, 3, 4 ou 5 — 1 se o mecanismo não aparece ou está errado, 3 se aparece de forma incompleta, 4 se aparece correto com alguma lacuna, 5 se aparece correto e completo>,
  "perguntaAprofundamento": "<uma pergunta que exige elaboração, sobre o mesmo conceito, seguindo o PASSO 4>"
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

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];
}

/**
 * Decisão pedagógica estruturada, derivada em código (nunca pedida ao
 * modelo) a partir de critérios objetivos: nota e presença de erro
 * conceitual. O mecanismo central já influencia a nota via o teto
 * aplicado em buildExplanationEvaluationResult, então não precisa ser
 * checado de novo aqui — é coerente com nota/mecanismo/erros por
 * construção, não por coincidência.
 *
 * "pending_evaluation" nunca é retornado por esta função — só existe
 * como status de ATTEMPT ainda não avaliado (ver assets/engine.js).
 * Nesta etapa a decisão só é PERSISTIDA, sem roteamento automático.
 */
export function derivePedagogicalDecision(nota, equivocos) {
  if (nota >= EXPLANATION_PASS_SCORE) return "passed";
  if (Array.isArray(equivocos) && equivocos.length > 0) return "return_to_comprehension";
  return "retry_recommended";
}

/**
 * Valida a pergunta de aprofundamento bruta do modelo: precisa ser uma
 * string não vazia, de tamanho razoável, e não pode duplicar literalmente
 * o título do conceito (a interpretação mais direta e verificável de
 * "não duplicar a pergunta original" com os dados que este endpoint
 * recebe hoje — Explicar não tem uma "pergunta original" própria como o
 * Quiz/resposta construída, o estímulo é sempre "explique o conceito X").
 */
export function isValidFollowUpQuestion(raw, title) {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (trimmed.length < FOLLOW_UP_MIN_LENGTH || trimmed.length > FOLLOW_UP_MAX_LENGTH) return false;
  if (title && trimmed.toLowerCase() === String(title).trim().toLowerCase()) return false;
  return true;
}

/**
 * Pergunta de aprofundamento determinística, usada quando a saída do
 * modelo não passa em isValidFollowUpQuestion — a garantia de "toda
 * avaliação bem-sucedida tem pelo menos uma followUpQuestion" nunca pode
 * depender só do modelo, mesmo padrão de nunca confiar cegamente na nota/
 * qualidadeSM2. Calibrada pela mesma decisaoPedagogica (ver PASSO 4).
 */
export function buildFallbackFollowUpQuestion(decisaoPedagogica) {
  if (decisaoPedagogica === "return_to_comprehension") {
    return "Reveja sua explicação: qual parte específica dela você acha que pode estar equivocada, e por quê?";
  }
  if (decisaoPedagogica === "retry_recommended") {
    return "O que acontece, passo a passo, entre os elementos que você mencionou — o que faz um levar ao outro?";
  }
  return "Existe alguma situação em que esse mecanismo não se aplicaria, ou algum limite dele? Explique.";
}

/**
 * Valida/sanitiza a saída bruta do modelo e aplica os tetos de nota —
 * a mesma lógica que já existia inline em api/avaliar-explicacao.js,
 * agora isolada e testável sem rede. Nunca lança: sempre devolve um
 * objeto válido, mesmo que a saída do modelo esteja incompleta (valores
 * ausentes viram nota 0 / listas vazias / strings vazias).
 */
export function buildExplanationEvaluationResult(parsed, { title } = {}) {
  parsed = parsed || {};

  const notaRaw = Number(parsed.nota);
  let nota = Number.isFinite(notaRaw) ? Math.min(100, Math.max(0, Math.round(notaRaw))) : 0;

  // Teto aplicado aqui, e não só no prompt: a instrução do PASSO 2 é uma regra
  // do produto, não uma sugestão ao modelo. Sem mecanismo identificado no texto,
  // a nota não passa de 45 mesmo que o modelo tenha devolvido 90 — é o que
  // impede uma explicação fluente e vazia de ganhar um intervalo longo no FSRS.
  const mecanismoNoTexto = cleanStr(parsed.mecanismoNoTexto, 500).trim();
  const semMecanismo = !mecanismoNoTexto || mecanismoNoTexto.toUpperCase().includes("NAO_ENCONTRADO");
  if (semMecanismo) nota = Math.min(nota, 45);

  // Limiares mais rigorosos que os anteriores (85/65/40): errar para o lado do
  // rigor traz a ficha de volta mais cedo, o que é barato; errar para o lado da
  // generosidade é exatamente a ilusão de aprendizado que o modo Feynman existe
  // para quebrar. O valor do modelo é aceito apenas quando não conflita com a nota.
  const qualidadePelaNota = nota >= 90 ? 5 : nota >= 70 ? 4 : nota >= 45 ? 3 : 1;
  const qualidadeModelo = [1, 3, 4, 5].includes(parsed.qualidadeSM2) ? parsed.qualidadeSM2 : qualidadePelaNota;
  const qualidadeSM2 = Math.min(qualidadeModelo, qualidadePelaNota);

  const equivocos = cleanList(parsed.equivocos, 10, 300);
  const decisaoPedagogica = derivePedagogicalDecision(nota, equivocos);

  const rawFollowUp = typeof parsed.perguntaAprofundamento === "string" ? parsed.perguntaAprofundamento.trim() : "";
  const perguntaAprofundamento = isValidFollowUpQuestion(rawFollowUp, title)
    ? cleanStr(rawFollowUp, FOLLOW_UP_MAX_LENGTH)
    : buildFallbackFollowUpQuestion(decisaoPedagogica);

  return {
    nota,
    mecanismoCentral: cleanStr(parsed.mecanismoCentral, 300),
    mecanismoNoTexto: semMecanismo ? "" : mecanismoNoTexto,
    pontosCobertos: cleanList(parsed.pontosCobertos, 10, 300),
    pontosFaltando: cleanList(parsed.pontosFaltando, 10, 300),
    equivocos,
    imprecisoes: cleanList(parsed.imprecisoes, 10, 300),
    feedback: cleanStr(parsed.feedback, 1000),
    qualidadeSM2,
    decisaoPedagogica,
    perguntaAprofundamento
  };
}

/**
 * Chama a IA e devolve o resultado já validado/com tetos aplicados.
 * Lança erro com ".code" ("timeout"|"network"|"http"|"parse") em
 * qualquer falha — api/avaliar-explicacao.js decide o status HTTP e
 * estorna a cota; assets/engine.js trata qualquer rejeição como
 * "evaluation_failed" e preserva o attempt já persistido.
 */
export async function evaluateExplanation({ apiKey, model, title, referenceText, studentText }) {
  const parsed = await callOpenRouter({
    apiKey,
    model: model || DEFAULT_MODEL,
    maxTokens: 3000,
    title: "Metodo Aprender - Modo Feynman",
    messages: buildMessages(title, referenceText, studentText)
  });
  return buildExplanationEvaluationResult(parsed, { title });
}
