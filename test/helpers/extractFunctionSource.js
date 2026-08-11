/* =====================================================================
   Extrai o texto-fonte de uma função nomeada de um arquivo, sem
   modificá-lo — mesmo espírito de test/helpers/loadEngineFsrs.js (roda
   o código de verdade num contexto isolado, em vez de duplicar/reescrever
   a lógica no teste).
   =====================================================================
   Usa contagem de chaves (balanceada) em vez de regex de "linha única",
   porque as implementações de escapeHtml() nos arquivos deste projeto têm
   formatações diferentes (uma linha em alguns arquivos, várias em outros)
   — uma regex ingênua acopla o teste ao estilo de formatação de cada
   arquivo, exatamente o tipo de fragilidade que este helper existe para
   evitar. Não interpreta strings/regex — seguro apenas porque nenhuma das
   funções extraídas por este helper tem chaves dentro de literais.
   ===================================================================== */
import { readFileSync } from "node:fs";

export function extractFunctionSource(filePath, functionName) {
  const src = readFileSync(filePath, "utf8");
  const marker = `function ${functionName}(`;
  const start = src.indexOf(marker);
  if (start === -1) {
    throw new Error(`Função "${functionName}" não encontrada em ${filePath}.`);
  }
  const braceStart = src.indexOf("{", start);
  if (braceStart === -1) {
    throw new Error(`Corpo de "${functionName}" não encontrado em ${filePath}.`);
  }

  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error(`Chave de fechamento de "${functionName}" não encontrada em ${filePath}.`);
  }

  return src.slice(start, end + 1);
}
