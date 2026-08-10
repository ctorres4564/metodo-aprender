/* =====================================================================
   E2E — criar um módulo manualmente e ver ele aparecer no catálogo
   ===================================================================== */
import { loginAsSeededUser, test, expect } from "./fixtures.js";

test("criar módulo manual (sem IA) salva e aparece em 'Meus Módulos'", async ({ page }) => {
  const title = `Módulo E2E ${Date.now()}`;

  await loginAsSeededUser(page);
  await page.goto("/criar-modulo.html");
  await expect(page.locator("#user-email")).toBeVisible({ timeout: 15000 });

  await page.locator("#mod-title").fill(title);
  await page.locator("#mod-subtitle").fill("Criado pelo teste E2E");
  await page.locator("#mod-icon").fill("🧪");

  // A tela já vem com 3 fichas de conceito em branco por padrão (ver
  // init() em criar-modulo.html) — remove as duas extras e usa só a
  // primeira, em vez de clicar "Adicionar conceito" (que criaria uma 4ª).
  const cards = page.locator(".concept-editor");
  await expect(cards).toHaveCount(3);
  await cards.nth(1).locator(".remove-concept").click();
  await cards.nth(1).locator(".remove-concept").click();
  await expect(cards).toHaveCount(1);

  const card = cards.first();
  await card.locator(".c-tag").fill("Teste");
  await card.locator(".c-title").fill("Conceito de teste");
  await card.locator(".c-text").fill("Explicação curta só pra este teste automatizado.");
  await card.locator(".c-question").fill("Isto é um teste?");
  const opts = card.locator(".c-opt");
  await opts.nth(0).fill("Sim, é um teste");
  await opts.nth(1).fill("Não, é produção");
  await opts.nth(2).fill("Talvez");
  await opts.nth(3).fill("Nenhuma das anteriores");
  await card.locator(".c-correct").nth(0).check();

  await page.locator("#save-module-btn").click();

  // Salvar navega direto pro módulo recém-criado (app.html?m=<id>&src=user).
  await page.waitForURL(/app\.html\?m=/, { timeout: 15000 });
  await expect(page.locator("#app-title")).toContainText(title, { timeout: 10000 });

  // E também aparece listado em "Meus Módulos" no catálogo.
  await page.goto("/index.html");
  await expect(page.locator("#user-modules-grid")).toContainText(title, { timeout: 10000 });
});

test("remover um conceito do meio e adicionar outro não cruza os grupos de alternativa correta", async ({ page }) => {
  // Regressão: addConceptCard() usava container.children.length como idx do
  // grupo de radio (name="correct-N"). Ao remover o card do meio e criar um
  // novo depois, o novo card podia repetir o idx de um card que continuava
  // na tela — os dois passavam a compartilhar o mesmo name, então marcar a
  // alternativa correta num desmarcava a do outro (ver criar-modulo.html,
  // addConceptCard()).
  await loginAsSeededUser(page);
  await page.goto("/criar-modulo.html");
  await expect(page.locator("#user-email")).toBeVisible({ timeout: 15000 });

  const cards = page.locator(".concept-editor");
  await expect(cards).toHaveCount(3); // init() já cria 3 fichas em branco

  // Remove o card do meio (posição 1) — sobram os cards originalmente
  // criados nas posições 0 e 2.
  await cards.nth(1).locator(".remove-concept").click();
  await expect(cards).toHaveCount(2);

  // Adiciona um card novo — é aqui que o idx podia colidir com o card
  // remanescente que antes estava na posição 2.
  await page.locator("#add-concept-btn").click();
  await expect(cards).toHaveCount(3);

  const survivor = cards.nth(1); // o card original que sobrou
  const newcomer = cards.nth(2); // o card recém-adicionado

  await survivor.locator(".c-correct").nth(0).check();
  await newcomer.locator(".c-correct").nth(1).check();

  // Marcar a alternativa do card novo não pode desmarcar a do sobrevivente
  // — só aconteceria se os dois compartilhassem o mesmo name de radio.
  await expect(survivor.locator(".c-correct").nth(0)).toBeChecked();
  await expect(newcomer.locator(".c-correct").nth(1)).toBeChecked();
});
