/* =====================================================================
   Categorias fixas para a Biblioteca de Materiais.
   =====================================================================
   Fonte de verdade do lado do servidor. O espelho usado pelo navegador
   fica em assets/material-categories.js — mantenha os dois sincronizados
   (não é possível compartilhar o mesmo arquivo entre servidor e cliente
   neste projeto, que não usa bundler).
   ===================================================================== */
export const MATERIAL_CATEGORIES = [
  { id: "historia", label: "📜 História" },
  { id: "sociologia", label: "👥 Sociologia" },
  { id: "filosofia", label: "🧠 Filosofia" },
  { id: "ciencias", label: "🔬 Ciências" },
  { id: "matematica", label: "➗ Matemática" },
  { id: "portugues", label: "📖 Português/Literatura" },
  { id: "geografia", label: "🌍 Geografia" },
  { id: "concursos", label: "📝 Concursos" },
  { id: "idiomas", label: "🌐 Idiomas" },
  { id: "outros", label: "📁 Outros" }
];

export const DEFAULT_MATERIAL_CATEGORY = "outros";

export const MATERIAL_CATEGORY_IDS = MATERIAL_CATEGORIES.map((c) => c.id);
