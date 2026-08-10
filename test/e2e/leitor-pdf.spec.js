/* =====================================================================
   E2E — abrir um material em PDF, navegar, zoom e modo escuro
   =====================================================================
   Usa o material semeado em global-setup.js (PDF mínimo de 1 página) —
   não depende de nenhum fluxo de importação/IA.
   ===================================================================== */
import { SEEDED_MATERIAL_ID, loginAsSeededUser, test, expect } from "./fixtures.js";

test("abre o PDF, mostra a página e permite ativar o modo escuro", async ({ page }) => {
  await loginAsSeededUser(page);
  await page.goto(`/leitor.html?material=${SEEDED_MATERIAL_ID}`);

  // #reader-shell só fica visível depois que o PDF terminou de carregar
  // (ver boot() em leitor.html) — sinal real, ao contrário do texto
  // estático "Página 1 de 1" que já vem no HTML antes de qualquer JS rodar.
  await expect(page.locator("#reader-shell")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#pdf-canvas")).toBeVisible();

  // Botões de página anterior/seguinte desabilitados (só 1 página).
  await expect(page.locator("#prev-page-btn")).toBeDisabled();
  await expect(page.locator("#next-page-btn")).toBeDisabled();

  // Modo escuro: inverte as cores do canvas via classe no contêiner.
  const container = page.locator("#pdf-page-container");
  await expect(container).not.toHaveClass(/pdf-dark/);
  await page.locator("#dark-mode-btn").click();
  await expect(container).toHaveClass(/pdf-dark/);
  await expect(page.locator("#dark-mode-btn")).toContainText("Claro");

  await page.locator("#dark-mode-btn").click();
  await expect(container).not.toHaveClass(/pdf-dark/);

  // Zoom: aumentar deve crescer a largura do canvas. Ajusta pro tamanho
  // mínimo primeiro (zoom-out algumas vezes) pra ter uma base estável e
  // conhecida antes de medir — o clique de "+" dispara um renderPage()
  // assíncrono (baixa a página de novo, redesenha o canvas), por isso o
  // poll com uma janela generosa em vez de comparar direto.
  await page.locator("#zoom-out-btn").click();
  await page.locator("#zoom-out-btn").click();
  await page.waitForTimeout(300); // deixa os dois re-renders assentarem
  const widthBefore = await page.locator("#pdf-canvas").evaluate((el) => el.width);

  await page.locator("#zoom-in-btn").click();
  await expect
    .poll(async () => page.locator("#pdf-canvas").evaluate((el) => el.width), { timeout: 10000 })
    .toBeGreaterThan(widthBefore);
});
