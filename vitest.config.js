import { defineConfig } from "vitest/config";

// Config padrão (usado por "npm test"): tudo, EXCETO os testes que
// exigem o Firebase Emulator rodando (test/emulator/**) — esses têm
// config e script próprios (vitest.emulator.config.js + "npm run
// test:emulator"), pra "npm test" continuar rápido e sem dependências
// externas no dia a dia.
export default defineConfig({
  test: {
    exclude: ["node_modules/**", "test/emulator/**"]
  }
});
