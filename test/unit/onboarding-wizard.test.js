/* =====================================================================
   TESTES — assets/onboarding-wizard.js
   =====================================================================
   Testa o wizard que aparece para novos usuários: decisão de mostrar,
   renderização dos cards, eventos de clique e acessibilidade.
   ===================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const src = readFileSync(resolve(__dirname, "../../assets/onboarding-wizard.js"), "utf8");

function setupWizard() {
  const dom = new JSDOM("<!doctype html><div id=\"container\"></div>", { url: "http://localhost" });
  const win = dom.window;
  const sandbox = vm.createContext({ window: win, localStorage: win.localStorage });
  vm.runInContext(src, sandbox, { filename: "onboarding-wizard.js" });
  return { win, dom, OnboardingWizard: sandbox.window.OnboardingWizard };
}

beforeEach(() => {
  // Não precisa limpar localStorage globalmente — cada setupWizard cria um
  // JSDOM novo (localStorage isolado). Os testes que simulam localStorage
  // bloqueado fazem monkey-patch no win da própria instância.
});

describe("OnboardingWizard", () => {
  describe("shouldShow", () => {
    it("retorna true para usuário sem módulos na primeira visita", () => {
      const { OnboardingWizard } = setupWizard();
      expect(OnboardingWizard.shouldShow(0)).toBe(true);
    });

    it("retorna false se userModuleCount > 0", () => {
      const { OnboardingWizard } = setupWizard();
      expect(OnboardingWizard.shouldShow(5)).toBe(false);
      expect(OnboardingWizard.shouldShow(1)).toBe(false);
    });

    it("retorna false se já viu o wizard (marcado no localStorage)", () => {
      const { OnboardingWizard } = setupWizard();
      OnboardingWizard.markSeen();
      expect(OnboardingWizard.shouldShow(0)).toBe(false);
    });

    it("retorna true mesmo com localStorage bloqueado (fallback)", () => {
      const { OnboardingWizard, win } = setupWizard();

      // Monkey-patch no localStorage do JSDOM para simular getItem lançando
      // erro (ex.: política de privacidade do navegador bloqueando storage).
      const originalGetItem = win.localStorage.getItem;
      win.localStorage.getItem = vi.fn(() => {
        throw new Error("SecurityError: access denied");
      });

      // O try/catch em shouldShow deve capturar e retornar true
      expect(OnboardingWizard.shouldShow(0)).toBe(true);

      win.localStorage.getItem = originalGetItem;
    });
  });

  describe("markSeen", () => {
    it("grava '1' no localStorage", () => {
      const { OnboardingWizard } = setupWizard();
      OnboardingWizard.markSeen();
      // Verifica que o localStorage do JSDOM foi usado
      expect(OnboardingWizard.shouldShow(0)).toBe(false); // já foi marcado
    });

    it("não quebra com localStorage bloqueado", () => {
      const { OnboardingWizard, win } = setupWizard();

      // Monkey-patch no setItem para lançar erro
      const originalSetItem = win.localStorage.setItem;
      win.localStorage.setItem = vi.fn(() => {
        throw new Error("SecurityError: access denied");
      });

      // O try/catch no markSeen garante que não lança exceção
      expect(() => OnboardingWizard.markSeen()).not.toThrow();

      win.localStorage.setItem = originalSetItem;
    });
  });

  describe("render", () => {
    it("injeta HTML com os dois cards principais", () => {
      const { OnboardingWizard, dom } = setupWizard();
      const container = dom.window.document.getElementById("container");
      OnboardingWizard.render(container);

      expect(container.innerHTML).toContain("Tenho um PDF ou texto");
      expect(container.innerHTML).toContain("Sei o que quero estudar");
      expect(container.innerHTML).toContain("Quero importar um livro grande");
    });

    it("card 'import-text' marca como visto ao clicar", () => {
      const { OnboardingWizard, dom } = setupWizard();
      const container = dom.window.document.getElementById("container");
      OnboardingWizard.render(container);

      const btn = container.querySelector('[data-action="import-text"]');
      expect(btn).not.toBeNull();

      btn.click();
      expect(OnboardingWizard.shouldShow(0)).toBe(false);
    });

    it("card 'create-manual' marca como visto ao clicar", () => {
      const { OnboardingWizard, dom } = setupWizard();
      const container = dom.window.document.getElementById("container");
      OnboardingWizard.render(container);

      const btn = container.querySelector('[data-action="create-manual"]');
      btn.click();
      expect(OnboardingWizard.shouldShow(0)).toBe(false);
    });

    it("link 'livro grande' marca como visto ao clicar", () => {
      const { OnboardingWizard, dom } = setupWizard();
      const container = dom.window.document.getElementById("container");
      OnboardingWizard.render(container);

      const link = container.querySelector('a[href="importar-livro.html"]');
      expect(link).not.toBeNull();
      link.click();
      expect(OnboardingWizard.shouldShow(0)).toBe(false);
    });

    it("não quebra com container nulo", () => {
      const { OnboardingWizard } = setupWizard();
      expect(() => OnboardingWizard.render(null)).not.toThrow();
    });

    it("não quebra com container vazio (sem os botões esperados)", () => {
      const { OnboardingWizard, dom } = setupWizard();
      const container = dom.window.document.getElementById("container");
      container.innerHTML = "";
      expect(() => OnboardingWizard.render(container)).not.toThrow();
    });

    it("ícones de emoji têm aria-hidden", () => {
      const { OnboardingWizard, dom } = setupWizard();
      const container = dom.window.document.getElementById("container");
      OnboardingWizard.render(container);

      const hiddenElements = container.querySelectorAll('[aria-hidden="true"]');
      expect(hiddenElements.length).toBeGreaterThanOrEqual(3); // 👋 + 📄 + ✍️
    });

    it("tem heading hierárquico (h3)", () => {
      const { OnboardingWizard, dom } = setupWizard();
      const container = dom.window.document.getElementById("container");
      OnboardingWizard.render(container);

      const heading = container.querySelector("h3");
      expect(heading).not.toBeNull();
      expect(heading.textContent).toContain("Bem-vindo(a)");
    });

    it("retorna o container para encadeamento", () => {
      const { OnboardingWizard, dom } = setupWizard();
      const container = dom.window.document.getElementById("container");
      const result = OnboardingWizard.render(container);
      expect(result).toBe(container);
    });
  });
});
