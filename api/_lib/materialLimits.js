/* =====================================================================
   Limites centralizados para a Biblioteca de Materiais (Etapa 1).
   =====================================================================
   Fonte de verdade do lado do servidor. O espelho usado pelo navegador
   fica em assets/material-limits.js — mantenha os dois sincronizados
   (não é possível compartilhar o mesmo arquivo entre servidor e cliente
   neste projeto, que não usa bundler).
   ===================================================================== */
export const MATERIAL_LIMITS = {
  maxPdfSizeBytes: 50 * 1024 * 1024,   // 50 MB
  maxPdfPages: 600,
  maxOcrPages: 80,
  maxTextCharsPerPage: 6000,           // acima disso, a página é dividida em partes (pageId "NNNNNN-PPP")
  maxPagesPerGeneration: 100,          // limite de páginas buscadas do Firestore por pedido de módulo
  maxSourceCharsPerGeneration: 14000   // mesmo valor usado em api/gerar-modulo.js (MAX_SOURCE_CHARS)
};
