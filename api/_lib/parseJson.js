/* =====================================================================
   Extrai um objeto JSON da resposta em texto de um modelo de linguagem,
   tolerando os formatos mais comuns que os modelos retornam mesmo quando
   pedimos JSON puro: cercado por ```json ... ```, com espaços/quebras de
   linha antes/depois, ou com algum texto solto ao redor.
   Lança erro se não conseguir extrair nada válido.
   ===================================================================== */
export function extractJson(rawText) {
  if (!rawText || typeof rawText !== "string") {
    throw new Error("Resposta vazia do modelo.");
  }

  let text = rawText.trim();

  // Remove cercas de bloco de código (```json ... ``` ou ``` ... ```)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  // Tenta o texto inteiro primeiro (caso já seja JSON limpo)
  try {
    return JSON.parse(text);
  } catch (e) {
    // segue para a próxima tentativa
  }

  // Última tentativa: pega do primeiro "{" ao último "}" da string
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]);
  }

  throw new Error("Não foi possível extrair JSON da resposta.");
}
