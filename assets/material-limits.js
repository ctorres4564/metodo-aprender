/* =====================================================================
   Limites centralizados para a Biblioteca de Materiais (Etapa 1) — cópia
   usada pelo navegador. Mantenha sincronizado com api/_lib/materialLimits.js.
   ===================================================================== */
window.MaterialLimits = {
  maxPdfSizeBytes: 50 * 1024 * 1024,   // 50 MB
  maxPdfPages: 600,
  maxOcrPages: 80,
  maxTextCharsPerPage: 6000,           // acima disso, a página é dividida em partes (pageId "NNNNNN-PPP")
  maxPagesPerGeneration: 100,          // limite de páginas buscadas do Firestore por pedido de módulo
  maxSourceCharsPerGeneration: 14000   // mesmo valor usado em api/gerar-modulo.js (MAX_SOURCE_CHARS)
};
