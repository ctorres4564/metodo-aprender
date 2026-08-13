/* =====================================================================
   SANITIZE — helpers de sanitização e limite de tamanho para endpoints
   =====================================================================
   Extraídos dos 5 endpoints de IA que antes os definiam inline (V3-C).
   Centralizar aqui garante consistência entre todos os endpoints e
   evita divergência acidental quando um endpoint atualiza a lógica de
   sanitização e os outros ficam com a versão antiga.
   ===================================================================== */

/**
 * Trunca string até `max` caracteres. Retorna string vazia se o valor
 * não for string (nunca retorna null/undefined — seguro pra injetar
 * direto na resposta JSON sem checagem extra).
 */
export const cleanStr = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Filtra e trunca uma lista de strings: remove itens que não são string,
 * corta no máximo `maxItems` itens e cada item em no máximo `maxLen`.
 */
export const cleanList = (v, maxItems, maxLen) =>
  (Array.isArray(v) ? v : []).filter(i => typeof i === "string").slice(0, maxItems).map(i => i.slice(0, maxLen));