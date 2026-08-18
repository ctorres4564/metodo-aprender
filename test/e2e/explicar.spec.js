/* =====================================================================
   E2E — Técnica de Feynman (Explicar): histórico por tentativa,
   persistência antes da IA, e comportamento com cota esgotada/falha
   técnica (Prioridade 3, correção crítica).
   =====================================================================
   Não há servidor de API rodando neste ambiente E2E (webServer do
   playwright.config.js é só "npx serve", estático) — /api/avaliar-
   explicacao é interceptado via page.route em cada cenário.
   ===================================================================== */
import { loginAsSeededUser, test, expect } from "./fixtures.js";

async function createModuleAndReachExplainTab(page, title) {
  await loginAsSeededUser(page);
  await page.goto("/criar-modulo.html");
  await expect(page.locator("#user-email")).toBeVisible({ timeout: 15000 });

  await page.locator("#mod-title").fill(title);
  const cards = page.locator(".concept-editor");
  await cards.nth(1).locator(".remove-concept").click();
  await cards.nth(1).locator(".remove-concept").click();

  const editor = cards.first();
  await editor.locator(".c-tag").fill("Explicar E2E");
  await editor.locator(".c-title").fill("Efeito de espaçamento");
  await editor.locator(".c-text").fill("Estudar em sessões espaçadas ao longo do tempo produz memórias mais duradouras do que concentrar tudo numa única sessão.");
  await editor.locator(".c-question").fill("O que produz memórias mais duradouras?");
  const options = editor.locator(".c-opt");
  await options.nth(0).fill("Sessões espaçadas ao longo do tempo");
  await options.nth(1).fill("Estudar tudo de uma vez");
  await options.nth(2).fill("Reler o texto várias vezes seguidas");
  await options.nth(3).fill("Sublinhar frases-chave");
  await editor.locator(".c-correct").nth(0).check();
  await page.locator("#save-module-btn").click();
  await page.waitForURL(/app\.html\?m=/, { timeout: 15000 });
  await expect(page.locator("#app-title")).toHaveText(title);

  await expect(page.locator("#cta-learn")).toBeVisible();
  await page.locator("#cta-learn").click();
  await expect(page.locator("#learn-panel")).toBeVisible();
  await page.locator("#learn-opts .opt", { hasText: "Sessões espaçadas ao longo do tempo" }).click();
  await expect(page.locator("#learn-feedback")).toBeVisible();

  await page.locator('button[data-tab="explicar"]').click();
  const panel = page.locator("#explain-panel");
  await expect(panel.locator("#explain-input")).toBeVisible();
  return panel;
}

test("IA disponível: referência fica oculta até o envio, e a avaliação estruturada (mecanismo/imprecisões/decisão) é exibida", async ({ page }) => {
  test.setTimeout(60000);
  const title = `Explicar IA disponível ${Date.now()}`;

  await page.route("**/api/avaliar-explicacao", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        nota: 82,
        mecanismoCentral: "Revisar perto do momento de esquecer reforça a memória de forma mais eficiente.",
        mecanismoNoTexto: "Espalhar as revisões ao longo do tempo reforça a memória mais do que juntar tudo numa sessão.",
        pontosCobertos: ["menciona sessões espaçadas"],
        pontosFaltando: ["não menciona por que isso acontece"],
        equivocos: [],
        imprecisoes: ["não especifica o que conta como uma 'sessão'"],
        feedback: "Boa explicação, só falta um detalhe.",
        qualidadeSM2: 4
      })
    });
  });

  const panel = await createModuleAndReachExplainTab(page, title);

  // Referência (texto do conceito) nunca aparece no painel antes do envio.
  await expect(panel).not.toContainText("Estudar em sessões espaçadas ao longo do tempo produz memórias");

  const input = panel.locator("#explain-input");
  await input.fill("Espalhar as revisões ao longo do tempo reforça a memória mais do que juntar tudo numa sessão.");
  await panel.locator("#explain-submit").click();

  await expect(panel).toContainText("82/100");
  await expect(panel).toContainText("mecanismo central");
  await expect(panel).toContainText("Você enunciou");
  await expect(panel).toContainText("Imprecisões");
  await expect(panel).toContainText("não especifica o que conta como uma 'sessão'");
  await expect(panel).toContainText("Aprovado");

  // Persistido no explainAttempts real do estado salvo.
  const attempt = await page.evaluate(async () => {
    const moduleId = new URLSearchParams(location.search).get("m");
    const moduleData = await window.AppDB.getUserModule(moduleId);
    await StorageAdapter.flush(moduleData.config.storageKey);
    const state = await StorageAdapter.load(moduleData.config.storageKey);
    const conceptId = moduleData.concepts[0].id;
    return state.cards[conceptId].explainAttempts[0];
  });
  expect(attempt.status).toBe("evaluated");
  expect(attempt.evaluation.score).toBe(82);
  expect(attempt.evaluation.imprecisions).toEqual(["não especifica o que conta como uma 'sessão'"]);
  expect(attempt.evaluation.pedagogicalDecision).toBe("passed");
});

test("cota esgotada preserva a explicação como 'aguardando avaliação' e permite avaliar depois", async ({ page }) => {
  test.setTimeout(60000);
  const title = `Explicar cota esgotada ${Date.now()}`;

  let callCount = 0;
  await page.route("**/api/avaliar-explicacao", async (route) => {
    callCount += 1;
    if (callCount === 1) {
      await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "Limite mensal de avaliações de explicação atingido." }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        nota: 75, mecanismoCentral: "x", mecanismoNoTexto: "Espalhar as revisões ao longo do tempo reforça a memória.",
        pontosCobertos: [], pontosFaltando: [], equivocos: [], imprecisoes: [], feedback: "ok", qualidadeSM2: 4
      })
    });
  });

  const panel = await createModuleAndReachExplainTab(page, title);
  const explanationText = "Espalhar as revisões ao longo do tempo reforça a memória mais do que juntar tudo numa sessão.";
  await panel.locator("#explain-input").fill(explanationText);
  await panel.locator("#explain-submit").click();

  await expect(panel).toContainText("aguardando avaliação");
  await expect(panel).not.toContainText("problema técnico");

  // A tentativa foi persistida com o texto do aluno, mesmo sem avaliação.
  const pending = await page.evaluate(async () => {
    const moduleId = new URLSearchParams(location.search).get("m");
    const moduleData = await window.AppDB.getUserModule(moduleId);
    await StorageAdapter.flush(moduleData.config.storageKey);
    const state = await StorageAdapter.load(moduleData.config.storageKey);
    const conceptId = moduleData.concepts[0].id;
    return state.cards[conceptId].explainAttempts[0];
  });
  expect(pending.status).toBe("pending_evaluation");
  expect(pending.responseText).toBe(explanationText);
  expect(pending.evaluation).toBeNull();

  // Avaliação posterior: clicar em "tentar avaliar novamente" reaproveita a
  // MESMA tentativa (não cria uma segunda) e agora tem sucesso.
  await panel.locator("#explain-retry").click();
  await expect(panel).toContainText("75/100");

  const evaluated = await page.evaluate(async () => {
    const moduleId = new URLSearchParams(location.search).get("m");
    const moduleData = await window.AppDB.getUserModule(moduleId);
    await StorageAdapter.flush(moduleData.config.storageKey);
    const state = await StorageAdapter.load(moduleData.config.storageKey);
    const conceptId = moduleData.concepts[0].id;
    return state.cards[conceptId];
  });
  expect(evaluated.explainAttempts).toHaveLength(1); // não duplicou a tentativa
  expect(evaluated.explainAttempts[0].status).toBe("evaluated");
  expect(evaluated.explainCount).toBe(1); // FSRS/contador aplicado só uma vez
});

test("falha técnica (erro do provedor) preserva a explicação com mensagem distinta de cota esgotada", async ({ page }) => {
  test.setTimeout(60000);
  const title = `Explicar falha técnica ${Date.now()}`;

  await page.route("**/api/avaliar-explicacao", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Erro interno ao avaliar a explicação." }) });
  });

  const panel = await createModuleAndReachExplainTab(page, title);
  const explanationText = "Espalhar as revisões ao longo do tempo reforça a memória mais do que juntar tudo numa sessão.";
  await panel.locator("#explain-input").fill(explanationText);
  await panel.locator("#explain-submit").click();

  await expect(panel).toContainText("problema técnico");
  await expect(panel).not.toContainText("aguardando avaliação");
  await expect(panel.locator("#explain-retry")).toBeVisible();

  const failed = await page.evaluate(async () => {
    const moduleId = new URLSearchParams(location.search).get("m");
    const moduleData = await window.AppDB.getUserModule(moduleId);
    await StorageAdapter.flush(moduleData.config.storageKey);
    const state = await StorageAdapter.load(moduleData.config.storageKey);
    const conceptId = moduleData.concepts[0].id;
    return state.cards[conceptId].explainAttempts[0];
  });
  expect(failed.status).toBe("evaluation_failed");
  expect(failed.responseText).toBe(explanationText);
});

test("fluxo completo: resposta -> avaliação -> follow-up -> resposta ao follow-up -> nova tentativa ligada", async ({ page }) => {
  test.setTimeout(60000);
  const title = `Explicar fluxo completo ${Date.now()}`;

  let callCount = 0;
  await page.route("**/api/avaliar-explicacao", async (route) => {
    callCount += 1;
    if (callCount === 1) {
      // Primeira tentativa: fraca, sem mecanismo -> retry_recommended.
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          nota: 40, mecanismoCentral: "Revisar perto do momento de esquecer reforça a memória.",
          mecanismoNoTexto: "NAO_ENCONTRADO",
          pontosCobertos: ["menciona sessões espaçadas"], pontosFaltando: ["não explica por que isso funciona"],
          equivocos: [], imprecisoes: [], feedback: "Bom começo, mas falta o mecanismo.", qualidadeSM2: 1,
          perguntaAprofundamento: "Por que espalhar as revisões ao longo do tempo reforça a memória mais do que revisar tudo de uma vez?"
        })
      });
      return;
    }
    // Segunda tentativa (após "Tentar explicar novamente"): mais forte -> passed.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        nota: 88, mecanismoCentral: "Revisar perto do momento de esquecer reforça a memória.",
        mecanismoNoTexto: "Isso funciona porque revisar perto de esquecer reforça a trilha de memória antes que ela se perca.",
        pontosCobertos: ["menciona sessões espaçadas", "explica o mecanismo"], pontosFaltando: [],
        equivocos: [], imprecisoes: [], feedback: "Agora sim, explicação completa.", qualidadeSM2: 5,
        perguntaAprofundamento: "Existe algum limite de intervalo entre revisões a partir do qual esse efeito para de funcionar?"
      })
    });
  });

  const panel = await createModuleAndReachExplainTab(page, title);

  // 1) Resposta (primeira tentativa, fraca).
  await panel.locator("#explain-input").fill("Espalhar as revisões ao longo do tempo ajuda a lembrar melhor depois.");
  await panel.locator("#explain-submit").click();

  // 2) Avaliação exibida, com decisão "vale tentar de novo".
  await expect(panel).toContainText("40/100");
  await expect(panel).toContainText("Vale tentar de novo");

  // 3) Follow-up exibido e obrigatório (textarea + botão desabilitado até digitar).
  const followUpInput = panel.locator("#explain-followup-input");
  await expect(followUpInput).toBeVisible();
  await expect(panel).toContainText("Por que espalhar as revisões ao longo do tempo reforça a memória");
  const followUpSubmit = panel.locator("#explain-followup-submit");
  await expect(followUpSubmit).toBeDisabled();

  // 4) Resposta ao follow-up.
  await followUpInput.fill("Porque a memória vai enfraquecendo com o tempo, e revisar perto desse ponto reforça a trilha antes que ela suma de vez.");
  await expect(followUpSubmit).toBeEnabled();
  await followUpSubmit.click();
  await expect(panel).toContainText("Sua resposta:");
  await expect(panel).toContainText("Porque a memória vai enfraquecendo com o tempo");

  // 5) Nova tentativa: clicar em "Tentar explicar novamente" limpa o textarea
  // original e permite escrever uma segunda explicação para o MESMO conceito,
  // sem que a referência apareça em nenhum momento.
  await expect(panel).not.toContainText("produz memórias mais duradouras do que concentrar tudo");
  await panel.locator("#explain-retry-attempt").click();
  const input = panel.locator("#explain-input");
  await expect(input).toHaveValue("");
  await input.fill("Isso funciona porque revisar perto de esquecer reforça a trilha de memória antes que ela se perca.");
  await panel.locator("#explain-submit").click();

  await expect(panel).toContainText("88/100");
  await expect(panel).toContainText("Aprovado");
  await expect(panel).not.toContainText("produz memórias mais duradouras do que concentrar tudo");

  // Persistência final: 2 attempts, ligados, cada um com seu próprio
  // diagnóstico e follow-up preservados — nada foi sobrescrito.
  const cardState = await page.evaluate(async () => {
    const moduleId = new URLSearchParams(location.search).get("m");
    const moduleData = await window.AppDB.getUserModule(moduleId);
    await StorageAdapter.flush(moduleData.config.storageKey);
    const state = await StorageAdapter.load(moduleData.config.storageKey);
    const conceptId = moduleData.concepts[0].id;
    return state.cards[conceptId];
  });

  expect(cardState.explainAttempts).toHaveLength(2);
  const [attempt1, attempt2] = cardState.explainAttempts;

  expect(attempt1.attemptNumber).toBe(1);
  expect(attempt1.previousAttemptId).toBeNull();
  expect(attempt1.evaluation.score).toBe(40);
  expect(attempt1.evaluation.pedagogicalDecision).toBe("retry_recommended");
  expect(attempt1.followUp).not.toBeNull();
  expect(attempt1.followUp.responseText).toContain("a memória vai enfraquecendo");

  expect(attempt2.attemptNumber).toBe(2);
  expect(attempt2.previousAttemptId).toBe(attempt1.id);
  expect(attempt2.evaluation.score).toBe(88);
  expect(attempt2.evaluation.pedagogicalDecision).toBe("passed");

  expect(cardState.explainCount).toBe(2); // FSRS/contador aplicado uma vez por avaliação, nunca duplicado
});
