import { defineConfig } from "vitest/config";

// Config padrão (usado por "npm test"): tudo, EXCETO os testes que
// exigem o Firebase Emulator rodando (test/emulator/**, config e script
// próprios: vitest.emulator.config.js + "npm run test:emulator") e os
// specs do Playwright (test/e2e/**, "npm run test:e2e") — o Playwright
// usa a extensão ".spec.js", que o Vitest também pega por padrão, mas
// os dois frameworks não são compatíveis entre si (test()/expect() de
// cada um vêm de APIs diferentes).
export default defineConfig({
  test: {
    exclude: ["node_modules/**", "test/emulator/**", "test/e2e/**"]
  }
});
