/* =====================================================================
   E2E — recuperação ativa por resposta construída
   ===================================================================== */
import { loginAsSeededUser, test, expect } from "./fixtures.js";

test("referência só aparece depois de confiança e resposta construída válida", async ({ page }) => {
  test.setTimeout(60000);
  const title = `Recuperação ativa E2E ${Date.now()}`;
  await loginAsSeededUser(page);
  await page.goto("/criar-modulo.html");
  await expect(page.locator("#user-email")).toBeVisible({ timeout: 15000 });

  await page.locator("#mod-title").fill(title);
  const cards = page.locator(".concept-editor");
  await cards.nth(1).locator(".remove-concept").click();
  await cards.nth(1).locator(".remove-concept").click();

  const editor = cards.first();
  await editor.locator(".c-tag").fill("Intercalação");
  await editor.locator(".c-title").fill("Prática de recuperação");
  await editor.locator(".c-text").fill("Recuperar é reconstruir uma ideia sem consultar a resposta de referência.");
  await editor.locator(".c-question").fill("O que caracteriza a prática de recuperação?");
  const options = editor.locator(".c-opt");
  await options.nth(0).fill("Reconstruir sem consultar");
  await options.nth(1).fill("Reler várias vezes");
  await options.nth(2).fill("Copiar a resposta");
  await options.nth(3).fill("Sublinhar o texto");
  await editor.locator(".c-correct").nth(0).check();
  await page.locator("#save-module-btn").click();
  await page.waitForURL(/app\.html\?m=/, { timeout: 15000 });
  await expect(page.locator("#app-title")).toHaveText(title);

  // A navegação acontece antes de init() terminar de vincular as abas.
  // Aguardar o CTA renderizado evita clicar no botão ainda sem handler.
  await expect(page.locator("#cta-learn")).toBeVisible();
  await page.locator("#cta-learn").click();
  await expect(page.locator("#learn-panel")).toBeVisible();
  await page.locator("#learn-opts .opt", { hasText: "Reconstruir sem consultar" }).click();
  await expect(page.locator("#learn-feedback")).toContainText("Este conceito volta amanhã");

  // O primeiro estudo agenda amanhã. Antecipamos apenas a data no estado
  // persistido para exercitar a tela de revisão sem depender do relógio.
  await page.evaluate(async () => {
    const moduleId = new URLSearchParams(location.search).get("m");
    const moduleData = await window.AppDB.getUserModule(moduleId);
    const state = await StorageAdapter.load(moduleData.config.storageKey);
    const conceptId = moduleData.concepts[0].id;
    state.cards[conceptId].nextReview = "2000-01-01";
    await StorageAdapter.save(moduleData.config.storageKey, state);
    await StorageAdapter.flush(moduleData.config.storageKey);
  });
  await page.reload();
  await expect(page.locator("#app-title")).toHaveText(title);
  await page.locator('button[data-tab="revisar"]').click();

  const panel = page.locator("#review-panel");
  const response = panel.locator(".constructed-response-input");
  await expect(response).toBeDisabled();
  await expect(panel).not.toContainText("Resposta de referência");
  await expect(panel).not.toContainText("Recuperar é reconstruir");

  await panel.locator('.constructed-confidence-btn[data-confidence="3"]').click();
  await expect(response).toBeEnabled();
  await response.fill("É reconstruir a ideia de memória, antes de consultar qualquer referência.");
  await panel.locator(".constructed-submit").click();

  await expect(panel).toContainText("Resposta de referência");
  await expect(panel).toContainText("Recuperar é reconstruir uma ideia sem consultar");
  await panel.locator('.constructed-rating[data-rating="correct"]').click();
  await expect(panel).toContainText("Revisão em dia");
});
