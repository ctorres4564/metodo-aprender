import { defineConfig, devices } from "@playwright/test";

// E2E — Fase 5 do plano de testes. Roda contra o app estático real
// (sem build), servido localmente, com o SDK do cliente Firebase
// apontado pros mesmos emuladores usados nas Fases 2/3 (ver
// assets/firebase-init.js: window.__USE_FIREBASE_EMULATOR__, injetada
// pelo fixture em test/e2e/fixtures.js). Sempre rodado dentro de
// `firebase emulators:exec` (ver package.json: "test:e2e") — nunca
// direto, senão os emuladores não estariam de pé.
export default defineConfig({
  testDir: "./test/e2e",
  globalSetup: "./test/e2e/global-setup.js",
  timeout: 30000,
  fullyParallel: false, // todos os specs usam o mesmo usuário/emulator semeado — evita corrida entre eles
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5050",
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } }
  ],
  webServer: {
    command: "npx serve -l 5050 .",
    url: "http://127.0.0.1:5050",
    reuseExistingServer: false,
    timeout: 30000
  }
});
