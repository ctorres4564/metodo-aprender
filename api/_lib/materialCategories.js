/* =====================================================================
   Categorias fixas para a Biblioteca de Materiais.
   =====================================================================
   Fonte de verdade do lado do servidor. O espelho usado pelo navegador
   fica em assets/material-categories.js — mantenha os dois sincronizados
   (não é possível compartilhar o mesmo arquivo entre servidor e cliente
   neste projeto, que não usa bundler).
   ===================================================================== */
export const MATERIAL_CATEGORIES = [
  { id: "faculdade", label: "🎓 Faculdade" },
  { id: "concursos", label: "📝 Concursos" },
  { id: "trabalho", label: "💼 Trabalho" },
  { id: "idiomas", label: "🌐 Idiomas" },
  { id: "geral", label: "📁 Geral" }
];

export const DEFAULT_MATERIAL_CATEGORY = "geral";

export const MATERIAL_CATEGORY_IDS = MATERIAL_CATEGORIES.map((c) => c.id);
