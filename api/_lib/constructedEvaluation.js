/* =====================================================================
   Avaliação semântica (IA) de resposta construída — Prioridade 3.
   =====================================================================
   Compara a resposta que a pessoa escreveu de memória (sem consultar)
   com o texto de referência do conceito, e devolve uma classificação
   estruturada. Isso é DISTINTO da autoavaliação (que já dirige FSRS,
   retrievalEvidenceStrength e strongRetrievalPassedAt — ver
   recordConstructedResponseAttempt em assets/engine.js): a avaliação
   semântica é uma camada adicional, opcional e melhor-esforço, anexada
   depois via aiEvaluation no attempt já registrado. Nunca substitui nem
   atrasa a autoavaliação.

   Reaproveita callOpenRouter (mesmo helper usado por avaliar-explicacao,
   gerar-analogia etc.) — mesmo tratamento de timeout/rede/HTTP/parse via
   err.code, que o endpoint usa para decidir status HTTP e estornar cota.
   ===================================================================== */
import { callOpenRouter } from "./openrouter.js";
import { cleanStr } from "./sanitize.js";

export const AI_CLASSIFICATIONS = Object.freeze(["incorrect", "partial", "correct"]);
export const DEFAULT_MODEL = "openai/gpt-4o-mini";

function invalidOutputError() {
  const err = new Error("Resposta da IA em formato inesperado.");
  err.code = "parse";
  return err;
}

/**
 * Valida e normaliza a saída bruta do modelo contra o schema esperado:
 * { classification: "incorrect"|"partial"|"correct", confidence: 0..1, reason: string }
 * Lança (code:"parse") se a saída não obedecer ao schema — nunca inventa
 * um valor padrão para classification/confidence, pois isso mascararia
 * uma resposta da IA que não pode ser confiada.
 */
export function validateAiEvaluationOutput(parsed) {
  if (!parsed || typeof parsed !== "object") throw invalidOutputError();
  if (!AI_CLASSIFICATIONS.includes(parsed.classification)) throw invalidOutputError();

  const confidenceRaw = Number(parsed.confidence);
  if (!Number.isFinite(confidenceRaw)) throw invalidOutputError();
  const confidence = Math.min(1, Math.max(0, confidenceRaw));

  return {
    classification: parsed.classification,
    confidence,
    reason: cleanStr(parsed.reason, 400)
  };
}

function buildMessages(conceptTitle, referenceText, responseText) {
  // v2 do prompt (auditoria do Benchmark v1 — accuracy 79.7%, sem falsos
  // "correct" graves, mas com 3 padrões sistemáticos de erro): a v1 dava
  // crédito parcial demais quando havia sobreposição de vocabulário do
  // domínio mesmo com relação causal invertida ou conceito trocado, e era
  // inconsistente ao julgar "exemplo sem definição geral" (ora supercreditava
  // como "correct", ora subcreditava como "incorrect" o mesmo padrão). A v2
  // torna cada um desses critérios explícito em vez de depender de uma
  // definição vaga de "captura a ideia central".
  const systemPrompt = `Você compara a resposta que uma pessoa escreveu DE MEMÓRIA, sem consultar nada, com o texto de referência de um conceito de estudo. Seu papel é apenas classificar a recuperação, não reensinar o conceito.

Classifique em uma destas três categorias — aplique os critérios abaixo com rigor, não por impressão geral de "parece que a pessoa sabe do que está falando":

CORRECT
Classifique como "correct" quando a resposta expressa corretamente o núcleo conceitual pedido pela pergunta, sem nenhum erro conceitual relevante. Pode usar outras palavras, outra ordem ou exemplos; não precisa repetir a resposta de referência nem citar detalhes acessórios. Uma resposta curta pode ser "correct" se o pouco que ela diz for suficiente e preciso.
NÃO penalize por: concisão, uso de sinônimos, linguagem simples/informal, ou ausência de detalhes que não são essenciais para responder à pergunta.

PARTIAL
Classifique como "partial" quando a resposta contém conhecimento verdadeiro e diretamente relevante para a pergunta, mas falta uma parte importante necessária para responder adequadamente, OU contém uma pequena imprecisão que não destrói o núcleo correto do que foi dito.
"partial" exige evidência REAL de entendimento correto de pelo menos uma parte relevante — não classifique como "partial" só porque a resposta usa palavras do domínio ou soa relacionada ao assunto. Se a resposta não contém nenhum elemento verdadeiro e específico da referência, ela não é "partial", é "incorrect".

INCORRECT
Classifique como "incorrect" quando houver qualquer um destes problemas, mesmo que o resto da resposta pareça bem escrito ou use vocabulário técnico correto:
- conceito errado ou troca de conceitos — inclui o caso em que a resposta descreve com precisão um conceito ADJACENTE em vez do conceito perguntado (ex.: descrever mitose quando a pergunta era sobre meiose; descrever o processo A quando foi perguntado sobre o processo B);
- inversão causal: se a relação correta é "B causa A" e a resposta afirma "A causa B" (ou qualquer inversão da direção causal/lógica central), isso é um erro conceitual central. Sobreposição de palavras-chave do domínio NÃO dá crédito parcial quando a relação lógica está invertida;
- mecanismo inventado: a resposta descreve como o processo funciona usando uma explicação que não existe ou contradiz a referência, mesmo que soe plausível ou tecnicamente convincente;
- resposta sobre um assunto adjacente em vez do que foi perguntado — responde a uma pergunta relacionada, mas diferente da que foi feita, sem de fato abordar o que a pergunta pede;
- contradição central ou negação do ponto principal da referência;
- conclusão factual central falsa: se a resposta começa corretamente mas termina com uma afirmação central falsa, invertida ou incompatível com a referência, essa falsidade final DOMINA a classificação — nunca deixe uma abertura correta "compensar" um erro conceitual central no fechamento da resposta;
- resposta vaga, genérica ou plausível demais, sem nenhum conteúdo conceitual específico e verificável da referência (ex.: "é quando a natureza escolhe quem sobrevive, por várias razões" não demonstra recuperação de nada específico, mesmo sendo uma frase plausível sobre o tema).

REGRA PARA REFERÊNCIAS COM VÁRIOS COMPONENTES
Quando a resposta de referência contiver vários componentes distintos, a resposta do estudante não precisa citar todos literalmente. Avalie quais componentes são ESSENCIAIS para responder ao núcleo da pergunta específica — nem todos os componentes têm o mesmo peso:
- se a resposta demonstra apenas um componente e omite outro(s) que são essenciais para responder à pergunta → "partial";
- se o componente fornecido já é, sozinho, suficiente para responder ao núcleo do que foi perguntado → "correct";
- se a resposta dá um exemplo relacionado ao tema, mas que não responde ao que foi perguntado → "incorrect".
NÃO infira completude automaticamente só porque um exemplo é vívido, específico ou convincente — um exemplo bem contado não é, por si, evidência de que a pessoa entende a estrutura geral do conceito. Avalie se o exemplo, sozinho, já responde ao núcleo pedido (então "correct"), cobre só parte dele (então "partial"), ou não responde ao que foi pedido (então "incorrect").

CONFIDENCE
O campo "confidence" deve refletir o quão claro é o seu julgamento desta classificação específica, com estas âncoras:
- 0.90–1.00: classificação muito clara, pouca ou nenhuma ambiguidade.
- 0.75–0.89: classificação provável, com pequena margem de interpretação.
- 0.55–0.74: fronteira real entre duas categorias adjacentes (ex.: você hesitou entre "partial" e "correct", ou entre "partial" e "incorrect").
- abaixo de 0.55: alta ambiguidade ou informação insuficiente para decidir com segurança.
NÃO use 0.9 como valor automático/padrão — escolha o valor que reflete a dificuldade real DESTE julgamento. Se houver dúvida real entre duas categorias, o confidence deve refletir essa incerteza, não a sua confiança geral sobre o assunto do conceito.

Responda SOMENTE em JSON válido, exatamente neste formato, sem nenhum texto antes ou depois:
{
  "classification": "incorrect" | "partial" | "correct",
  "confidence": <número entre 0.0 e 1.0, seguindo as âncoras acima>,
  "reason": "<justificativa curta, 1-2 frases, em português>"
}`;

  const userPrompt = `Conceito: ${conceptTitle}

Resposta de referência:
"""
${referenceText}
"""

Resposta escrita pela pessoa, de memória, sem consultar:
"""
${responseText}
"""`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];
}

/**
 * Chama a IA e devolve { classification, confidence, reason } já validados.
 * Lança erro com ".code" ("timeout"|"network"|"http"|"parse") em qualquer
 * falha — o endpoint (api/avaliar-resposta-construida.js) decide o status
 * HTTP e estorna a cota; o cliente (assets/engine.js) trata qualquer
 * rejeição desta função como "avaliação semântica indisponível" e segue
 * o fluxo normalmente (revelação, autoavaliação, FSRS e persistência já
 * aconteceram antes desta chamada ser sequer disparada).
 */
export async function evaluateConstructedResponse({ apiKey, model, conceptTitle, referenceText, responseText }) {
  const resolvedModel = model || DEFAULT_MODEL;
  const parsed = await callOpenRouter({
    apiKey,
    model: resolvedModel,
    maxTokens: 300,
    title: "Metodo Aprender - Avaliação semântica",
    messages: buildMessages(conceptTitle, referenceText, responseText)
  });
  const validated = validateAiEvaluationOutput(parsed);
  // "model" é o slug requisitado a esta chamada (env OPENROUTER_MODEL ou
  // DEFAULT_MODEL) — não vem do JSON do modelo (que só devolve classification/
  // confidence/reason). callOpenRouter monta uma lista de fallback (ver
  // openrouter.js) e não expõe qual modelo da lista de fato respondeu; então
  // este campo registra o modelo solicitado, para fins de auditoria/análise
  // futura, não uma garantia de qual modelo processou a chamada.
  return { ...validated, model: resolvedModel };
}
