/* =====================================================================
   Fixtures compartilhadas dos testes E2E — usuário semeado (ver
   global-setup.js) e o helper que aponta o SDK do cliente Firebase pros
   emuladores locais antes de qualquer página carregar.
   ===================================================================== */
import { test as base } from "@playwright/test";

export const SEEDED_USER = {
  uid: "e2e-seeded-user",
  email: "e2e-seeded-user@example.com",
  password: "senha123456"
};

export const SEEDED_MATERIAL_ID = "e2e-seeded-material";

// Estende o "test" padrão do Playwright: toda página nova já nasce com
// window.__USE_FIREBASE_EMULATOR__ = true ANTES de qualquer script da
// página rodar (addInitScript roda antes do document.currentScript da
// própria página) — é isso que faz assets/firebase-init.js conectar nos
// emuladores locais em vez do Firebase de produção real.
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.__USE_FIREBASE_EMULATOR__ = true;
    });
    await use(page);
  }
});

export const expect = base.expect;

// Faz login pela UI de verdade (não pula pra dentro da sessão via token)
// — cobre o mesmo fluxo que uma pessoa usaria, com o usuário pré-semeado
// (já com e-mail verificado) em global-setup.js.
export async function loginAsSeededUser(page) {
  await page.goto("/index.html");
  await page.locator("#auth-email").fill(SEEDED_USER.email);
  await page.locator("#auth-password").fill(SEEDED_USER.password);
  await page.locator("#auth-primary-btn").click();
  await page.locator("#user-email").waitFor({ state: "visible", timeout: 15000 });

  // Corrida conhecida (e documentada) entre o SDK do Firebase e o
  // Emulator: logo após o login, "request.auth" pode avaliar como nulo
  // nas regras do Firestore/Storage na PRIMEIRA chamada, mesmo com
  // auth.currentUser já preenchido — só acontece contra o emulator, nunca
  // em produção contra o Firebase de verdade (é por isso que esse
  // problema nunca apareceu nas fases anteriores do plano de testes, que
  // usam o Admin SDK, sempre ignora as regras). Forçar um refresh do
  // token aqui garante que ele já está "quente" antes de qualquer
  // navegação que dependa de regra do Firestore/Storage.
  await page.evaluate(() => window.AppAuth.currentUser().getIdToken(true));
}
