/* =====================================================================
   Carrega assets/engine.js — SEM modificá-lo — pra testar as funções
   FSRS de dentro dele.
   =====================================================================
   engine.js é um <script> comum (não um módulo ES: sem import/export),
   carregado direto pelo navegador em app.html. Transformá-lo num módulo
   só pra testar sairia do escopo de "escrever testes" (mudaria como o
   app inteiro carrega o motor). Em vez disso, roda o arquivo de verdade
   num contexto isolado do Node (vm), igual o navegador rodaria um
   <script> comum: declarações "function" no topo do arquivo viram
   propriedades do objeto global desse contexto, então dá pra pegar
   fsrsUpdate/etc. depois de rodar o arquivo — sem precisar duplicar ou
   reescrever a lógica aqui.

   Seguro porque engine.js não tem NENHUM código que roda imediatamente
   no carregamento (só declarações de função/variável — initApp() só é
   chamada de fora, por app.html); nada aqui toca em `document`/`window`.
   ===================================================================== */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_PATH = path.resolve(__dirname, "../../assets/engine.js");

export function loadEngineFsrs() {
  const src = readFileSync(ENGINE_PATH, "utf8");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "assets/engine.js" });
  return sandbox;
}
