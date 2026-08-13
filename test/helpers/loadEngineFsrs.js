/* =====================================================================
   Carrega assets/engine.js — SEM modificá-lo — pra testar as funções
   FSRS e de estado de dentro dele.

   engine.js declara `let STATE = null` e `let CONCEPTS = []`. No
   navegador, isso funciona porque são globais; no vm do Node, `let`
   cria binding lexical (não vira propriedade do sandbox), então os
   testes não conseguem injetar STATE/CONCEPTS. A solução: substituir
   `let STATE` e `let CONCEPTS` por `var` no source antes de rodar —
   `var` vira propriedade do sandbox, igual as functions.

   loadEngineFsrsAndSetConcepts(concepts):
     - Substitui `let CONCEPTS = []` pelos conceitos injetados
     - Substitui `let STATE = null` por `var STATE = null`
     - Substitui `let CONFIG = null` por `var CONFIG = null`
     - Retorna o sandbox, onde engine.STATE / engine.conceptStatus
       agora funcionam como esperado.
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

/**
 * Carrega o engine com CONCEPTS populada e STATE/var exposto ao sandbox.
 */
export function loadEngineFsrsAndSetConcepts(concepts) {
  let engineSrc = readFileSync(ENGINE_PATH, "utf8");

  // Substitui CONCEPTS pelos conceitos injetados
  const conceptsJson = JSON.stringify(concepts);
  engineSrc = engineSrc.replace(
    "let CONCEPTS = [];",
    `var CONCEPTS = ${conceptsJson};`
  );

  // Substitui let STATE = null por var STATE = null
  // (var vira propriedade do sandbox; let não)
  engineSrc = engineSrc.replace(
    "let STATE = null;",
    "var STATE = null;"
  );

  // CONFIG também é acessado por algumas funções
  engineSrc = engineSrc.replace(
    "let CONFIG = null;",
    "var CONFIG = null;"
  );

  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(engineSrc, sandbox, { filename: "assets/engine.js" });
  return sandbox;
}