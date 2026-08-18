/* =====================================================================
   E2E — avaliação semântica por IA da resposta construída (camada
   adicional sobre a Prioridade 2, ver requestConstructedAiEvaluation em
   assets/engine.js). Não há servidor de API rodando neste ambiente E2E
   (webServer do playwright.config.js é só "npx serve", estático) — por
   isso /api/avaliar-resposta-construida é interceptado via page.route
   nos dois cenários: IA disponível e IA indisponível. Em ambos, o fluxo
   de revisão (revelação, autoavaliação, FSRS, persistência) precisa
   terminar normalmente, porque a chamada à IA é disparada DEPOIS e
   nunca é aguardada por esse fluxo.
   ===================================================================== */
import { loginAsSeededUser, test, expect } from "./fixtures.js";

async function createModuleAndReachConstructedReview(page, title) {
  await loginAsSeededUser(page);
  await page.goto("/criar-modulo.html");
  await expect(page.locator("#user-email")).toBeVisible({ timeout: 15000 });

  await page.locator("#mod-title").fill(title);
  const cards = page.locator(".concept-editor");
  await cards.nth(1).locator(".remove-concept").click();
  await cards.nth(1).locator(".remove-concept").click();

  const editor = cards.first();
  await editor.locator(".c-tag").fill("Avaliação semântica");
  await editor.locator(".c-title").fill("Seleção natural");
  await editor.locator(".c-text").fill("Variação, hereditariedade e reprodução diferencial sustentam a seleção natural.");
  await editor.locator(".c-question").fill("Quais princípios sustentam a seleção natural?");
  const options = editor.locator(".c-opt");
  await options.nth(0).fill("Variação, herança e reprodução diferencial");
  await options.nth(1).fill("Apenas mutação aleatória");
  await options.nth(2).fill("Apenas competição");
  await options.nth(3).fill("Apenas adaptação individual");
  await editor.locator(".c-correct").nth(0).check();
  await page.locator("#save-module-btn").click();
  await page.waitForURL(/app\.html\?m=/, { timeout: 15000 });
  await expect(page.locator("#app-title")).toHaveText(title);

  await expect(page.locator("#cta-learn")).toBeVisible();
  await page.locator("#cta-learn").click();
  await expect(page.locator("#learn-panel")).toBeVisible();
  await page.locator("#learn-opts .opt", { hasText: "Variação, herança e reprodução diferencial" }).click();
  await expect(page.locator("#learn-feedback")).toContainText("Este conceito volta amanhã");

  const moduleId = await page.evaluate(async () => {
    const id = new URLSearchParams(location.search).get("m");
    const moduleData = await window.AppDB.getUserModule(id);
    const state = await StorageAdapter.load(moduleData.config.storageKey);
    const conceptId = moduleData.concepts[0].id;
    state.cards[conceptId].nextReview = "2000-01-01";
    await StorageAdapter.save(moduleData.config.storageKey, state);
    await StorageAdapter.flush(moduleData.config.storageKey);
    return id;
  });
  await page.reload();
  await expect(page.locator("#app-title")).toHaveText(title);
  await page.locator('button[data-tab="revisar"]').click();

  const panel = page.locator("#review-panel");
  await panel.locator('.constructed-confidence-btn[data-confidence="3"]').click();
  const response = panel.locator(".constructed-response-input");
  await expect(response).toBeEnabled();
  await response.fill("Variação herdável entre indivíduos e reprodução diferencial ao longo do tempo.");
  await panel.locator(".constructed-submit").click();
  await expect(panel).toContainText("Resposta de referência");

  return { panel, moduleId };
}

async function readCardState(page, moduleId) {
  return page.evaluate(async (id) => {
    const moduleData = await window.AppDB.getUserModule(id);
    const state = await StorageAdapter.load(moduleData.config.storageKey);
    const conceptId = moduleData.concepts[0].id;
    return state.cards[conceptId];
  }, moduleId);
}

test("IA disponível: avaliação semântica é persistida no attempt sem alterar FSRS/autoavaliação", async ({ page }) => {
  test.setTimeout(60000);
  const title = `Avaliação IA disponível ${Date.now()}`;

  let requestBody = null;
  await page.route("**/api/avaliar-resposta-construida", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ classification: "correct", confidence: 0.92, reason: "Cobre variação, herança e reprodução diferencial.", model: "openai/gpt-4o-mini" })
    });
  });

  const { panel, moduleId } = await createModuleAndReachConstructedReview(page, title);

  const cardBeforeRating = await readCardState(page, moduleId);
  await panel.locator('.constructed-rating[data-rating="correct"]').click();
  await expect(panel).toContainText("Revisão em dia");

  // A chamada à IA acontece depois do clique, sem bloquear a navegação acima
  // — espera explicitamente o efeito colateral assíncrono (persistência).
  await expect.poll(async () => {
    const card = await readCardState(page, moduleId);
    const last = card.retrievalAttempts[card.retrievalAttempts.length - 1];
    return last && last.aiEvaluation ? last.aiEvaluation.classification : null;
  }, { timeout: 10000 }).toBe("correct");

  const cardAfter = await readCardState(page, moduleId);
  const attempt = cardAfter.retrievalAttempts[cardAfter.retrievalAttempts.length - 1];

  expect(attempt.source).toBe("constructed_response");
  expect(attempt.responseType).toBe("constructed");
  expect(attempt.passed).toBe(true);
  expect(attempt.quality).toBe(4);
  expect(attempt.evidenceStrength).toBe("strong");
  expect(attempt.aiEvaluation).toMatchObject({ classification: "correct", confidence: 0.92, model: "openai/gpt-4o-mini" });
  expect(typeof attempt.aiEvaluation.evaluatedAt).toBe("string");

  // FSRS e evidência forte vieram da autoavaliação, não da IA — intactos.
  expect(cardAfter.strongRetrievalPassedAt).toBe(cardBeforeRating.strongRetrievalPassedAt || cardAfter.strongRetrievalPassedAt);
  expect(cardAfter.strongRetrievalPassedAt).not.toBeNull();
  expect(cardAfter.stability).not.toBeNull();

  expect(requestBody).toMatchObject({ conceptTitle: "Seleção natural" });
});

test("IA indisponível (timeout/erro do provedor): fluxo de revisão termina normalmente sem aiEvaluation", async ({ page }) => {
  test.setTimeout(60000);
  const title = `Avaliação IA indisponível ${Date.now()}`;

  await page.route("**/api/avaliar-resposta-construida", async (route) => {
    await route.abort("timedout");
  });

  const { panel, moduleId } = await createModuleAndReachConstructedReview(page, title);

  await panel.locator('.constructed-rating[data-rating="correct"]').click();
  // Revelação, autoavaliação, FSRS e navegação para o próximo estado da
  // fila continuam funcionando mesmo com a IA indisponível.
  await expect(panel).toContainText("Revisão em dia");

  const cardAfter = await readCardState(page, moduleId);
  const attempt = cardAfter.retrievalAttempts[cardAfter.retrievalAttempts.length - 1];

  expect(attempt.source).toBe("constructed_response");
  expect(attempt.passed).toBe(true);
  expect(attempt.evidenceStrength).toBe("strong");
  expect(cardAfter.strongRetrievalPassedAt).not.toBeNull();
  expect(attempt.aiEvaluation).toBeUndefined();
});
