/* =====================================================================
   E2E — cadastro e login
   ===================================================================== */
import { SEEDED_USER, loginAsSeededUser, test, expect } from "./fixtures.js";

test("cadastro cria a conta, entra direto no app e mostra o aviso de e-mail não verificado", async ({ page }) => {
  const uniqueEmail = `e2e-signup-${Date.now()}@example.com`;

  await page.goto("/index.html");
  await page.locator("#auth-go-signup").click();
  await page.locator("#auth-email").fill(uniqueEmail);
  await page.locator("#auth-password").fill("senha123456");
  await page.locator("#auth-primary-btn").click();

  // Cadastro não bloqueia o uso do app (só as gerações de IA, no
  // servidor) — a pessoa já cai direto no catálogo, com um aviso.
  await expect(page.locator("#user-email")).toBeVisible({ timeout: 15000 });
  await expect(page.locator("#verify-email-banner")).toContainText(/confirme seu e-mail/i);
});

test("login com conta já verificada entra sem nenhum aviso de e-mail", async ({ page }) => {
  await loginAsSeededUser(page);
  await expect(page.locator("#user-email")).toContainText(SEEDED_USER.email);
  await expect(page.locator("#verify-email-banner")).toHaveCount(0);
});

test("login com senha errada mostra mensagem de erro e não entra", async ({ page }) => {
  await page.goto("/index.html");
  await page.locator("#auth-email").fill(SEEDED_USER.email);
  await page.locator("#auth-password").fill("senha-errada-de-proposito");
  await page.locator("#auth-primary-btn").click();

  await expect(page.locator("#auth-gate")).toContainText(/incorret|inválid/i, { timeout: 10000 });
  // #user-email é um <span> estático que sempre existe no HTML — só ganha
  // texto/fica visível depois de um login bem-sucedido, então aqui
  // continua vazio (não checa "não existe", checa "não foi preenchido").
  await expect(page.locator("#user-email")).toBeEmpty();
  await expect(page.locator("#app-root")).toBeHidden();
});
