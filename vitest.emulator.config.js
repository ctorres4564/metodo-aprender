import { defineConfig } from "vitest/config";

// Config só pros testes que dependem do Firebase Emulator (regras do
// Firestore/Storage + concorrência real de usage.js), em test/emulator/.
// Rodado via "npm run test:emulator", que já sobe/derruba o emulator em
// volta do comando (firebase emulators:exec) — nunca rode este arquivo
// direto sem o emulator já rodando, os testes vão falhar tentando
// conectar (ou, pior, tentar falar com o Firebase de produção).
export default defineConfig({
  test: {
    include: ["test/emulator/**/*.test.js"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Todos os arquivos aqui compartilham a MESMA instância do emulator
    // (um processo só, portas fixas em firebase.json) — rodar os arquivos
    // em paralelo (padrão do Vitest) faz um teste pesado (ex.: concorrência
    // real de usage.js) sobrecarregar o emulator o bastante pra derrubar
    // operações de OUTROS arquivos rodando ao mesmo tempo (ex.: clearFirestore()
    // do arquivo de regras, com "Transaction lock timeout"). Sequencial evita isso.
    fileParallelism: false
  }
});
