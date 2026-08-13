/* =====================================================================
   TESTES — assets/module-drafts.js
   =====================================================================
   Os rascunhos são o único lugar onde o progresso de criação de módulo
   sobrevive a fechar a aba antes de salvar. Perder um rascunho é perder
   horas de trabalho — estes testes protegem as invariantes do
   armazenamento, migração e limpeza.
   ===================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const src = readFileSync(resolve(__dirname, "../../assets/module-drafts.js"), "utf8");

function setupDrafts(uid) {
  const dom = new JSDOM("<!doctype html>", { url: "http://localhost" });
  const win = dom.window;
  win.AppAuth = { currentUser: () => (uid ? { uid } : null) };
  const sandbox = vm.createContext({
    window: win,
    localStorage: win.localStorage,
    // module-drafts.js usa Date.now() — fake timers também fakeiam Date
    Date: globalThis.Date,
  });
  vm.runInContext(src, sandbox, { filename: "module-drafts.js" });
  return { win, ModuleDrafts: sandbox.window.ModuleDrafts };
}

beforeEach(() => {
  // Fake timers também fakeiam Date.now()/new Date() no ambiente de teste.
  // Cada setupDrafts cria um JSDOM isolado, então não precisamos limpar
  // localStorage manualmente entre testes.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-06-15T12:00:00.000Z"));
});

describe("ModuleDrafts", () => {
  describe("save e load — ida e volta", () => {
    it("salva e recupera o payload completo, com campos de envelope", () => {
      const { ModuleDrafts } = setupDrafts("test-user-1");
      const payload = { title: "Módulo Teste", concepts: [{ id: "c1", title: "Teste" }], hasContent: true };
      const saved = ModuleDrafts.save("draft-1", payload);

      expect(saved.title).toBe("Módulo Teste");
      expect(saved.draftId).toBe("draft-1");
      expect(saved.uid).toBe("test-user-1");
      expect(saved.version).toBe(1);
      expect(saved.createdAt).toBeGreaterThan(0);
      expect(saved.updatedAt).toBeGreaterThan(0);
      expect(saved.createdAt).toBeLessThanOrEqual(saved.updatedAt);

      const loaded = ModuleDrafts.load("draft-1");
      expect(loaded.title).toBe("Módulo Teste");
      expect(loaded.draftId).toBe("draft-1");
    });

    it("re-save mantém createdAt original mas atualiza updatedAt", () => {
      const { ModuleDrafts } = setupDrafts("test-user-1");
      const first = ModuleDrafts.save("draft-1", { title: "V1", hasContent: true });

      // Avança o relógio para que o segundo save tenha updatedAt diferente
      vi.setSystemTime(new Date("2025-06-15T12:00:05.000Z"));
      const second = ModuleDrafts.save("draft-1", { title: "V2", hasContent: true });

      expect(second.createdAt).toBe(first.createdAt);
      expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
      expect(second.title).toBe("V2");
    });
  });

  describe("isolamento entre usuários", () => {
    it("usuário A não enxerga rascunho do usuário B", () => {
      const { ModuleDrafts: mdA } = setupDrafts("user-a");
      mdA.save("draft-1", { title: "A" });

      const { ModuleDrafts: mdB } = setupDrafts("user-b");
      expect(mdB.load("draft-1")).toBeNull();
    });

    it("mesmo draftId em usuários diferentes são rascunhos independentes", () => {
      const { ModuleDrafts: mdA } = setupDrafts("user-a");
      mdA.save("shared-id", { title: "Do usuário A" });

      const { ModuleDrafts: mdB } = setupDrafts("user-b");
      mdB.save("shared-id", { title: "Do usuário B" });

      expect(mdA.load("shared-id").title).toBe("Do usuário A");
      expect(mdB.load("shared-id").title).toBe("Do usuário B");
    });
  });

  describe("remove", () => {
    it("remove o rascunho do localStorage", () => {
      const { ModuleDrafts } = setupDrafts("test-user");
      ModuleDrafts.save("to-remove", { title: "Temporário", hasContent: true });
      expect(ModuleDrafts.load("to-remove")).not.toBeNull();

      ModuleDrafts.remove("to-remove");
      expect(ModuleDrafts.load("to-remove")).toBeNull();
    });

    it("remove de draft que não existe não quebra", () => {
      const { ModuleDrafts } = setupDrafts("test-user");
      expect(() => ModuleDrafts.remove("never-saved")).not.toThrow();
    });
  });

  describe("latest", () => {
    it("retorna o rascunho com updatedAt mais recente", () => {
      const { ModuleDrafts } = setupDrafts("test-user");
      ModuleDrafts.save("old", { title: "Velho", hasContent: true });

      // Avança o relógio para o "novo" ser inequivocamente mais recente
      vi.setSystemTime(new Date("2025-06-15T12:01:00.000Z"));
      ModuleDrafts.save("new", { title: "Novo", hasContent: true });

      expect(ModuleDrafts.latest().title).toBe("Novo");
    });

    it("ignora rascunhos sem hasContent", () => {
      const { ModuleDrafts } = setupDrafts("test-user");
      ModuleDrafts.save("empty", { title: "Vazio", hasContent: false });

      expect(ModuleDrafts.latest()).toBeNull();
    });

    it("retorna null quando não há rascunhos", () => {
      const { ModuleDrafts } = setupDrafts("test-user");
      expect(ModuleDrafts.latest()).toBeNull();
    });

    it("retorna null sem usuário autenticado", () => {
      const { ModuleDrafts } = setupDrafts(null);
      expect(ModuleDrafts.latest()).toBeNull();
    });
  });

  describe("cleanup", () => {
    it("remove rascunhos com mais de 30 dias", () => {
      const { ModuleDrafts, win } = setupDrafts("test-user");
      const now = Date.now();
      const thirtyOneDaysAgo = now - (31 * 24 * 60 * 60 * 1000) - 1000;

      const storageKey = "metodo-aprender:module-draft:v1:test-user:expired";
      win.localStorage.setItem(storageKey, JSON.stringify({
        hasContent: true,
        updatedAt: thirtyOneDaysAgo,
        uid: "test-user",
        draftId: "expired",
        version: 1
      }));

      ModuleDrafts.cleanup();
      expect(win.localStorage.getItem(storageKey)).toBeNull();
    });

    it("mantém rascunhos com menos de 30 dias", () => {
      const { ModuleDrafts } = setupDrafts("test-user");
      ModuleDrafts.save("recent", { title: "Recente", hasContent: true });

      expect(ModuleDrafts.load("recent")).not.toBeNull();

      ModuleDrafts.cleanup();
      expect(ModuleDrafts.load("recent")).not.toBeNull();
    });

    it("remove rascunho corrompido (JSON inválido)", () => {
      const { ModuleDrafts, win } = setupDrafts("test-user");
      const storageKey = "metodo-aprender:module-draft:v1:test-user:corrupt";
      win.localStorage.setItem(storageKey, "não é JSON {{{");

      ModuleDrafts.cleanup();
      expect(win.localStorage.getItem(storageKey)).toBeNull();
    });

    it("remove rascunho sem updatedAt", () => {
      const { ModuleDrafts, win } = setupDrafts("test-user");
      const storageKey = "metodo-aprender:module-draft:v1:test-user:no-date";
      win.localStorage.setItem(storageKey, JSON.stringify({ hasContent: true }));

      ModuleDrafts.cleanup();
      expect(win.localStorage.getItem(storageKey)).toBeNull();
    });
  });

  describe("segurança e bordas", () => {
    it("sanitiza caracteres especiais no draftId", () => {
      const { ModuleDrafts } = setupDrafts("test-user");
      ModuleDrafts.save("draft/with:bad*chars", { title: "Sanitized", hasContent: true });

      expect(ModuleDrafts.load("draft/with:bad*chars")).not.toBeNull();
      expect(ModuleDrafts.load("draft/with:bad*chars").title).toBe("Sanitized");
    });

    it("load retorna null quando draftId é null/undefined/vazio", () => {
      const { ModuleDrafts } = setupDrafts("test-user");
      expect(ModuleDrafts.load(null)).toBeNull();
      expect(ModuleDrafts.load(undefined)).toBeNull();
      expect(ModuleDrafts.load("")).toBeNull();
    });

    it("save lança erro quando não há usuário autenticado", () => {
      const { ModuleDrafts } = setupDrafts(null);
      expect(() => ModuleDrafts.save("any", {})).toThrow();
    });

    it("load não quebra com localStorage corrompido", () => {
      const { ModuleDrafts, win } = setupDrafts("test-user");
      const storageKey = "metodo-aprender:module-draft:v1:test-user:corrupt-load";

      win.localStorage.setItem(storageKey, "não é JSON {{{");
      expect(ModuleDrafts.load("corrupt-load")).toBeNull();
      // Deve ter limpado o item corrompido
      expect(win.localStorage.getItem(storageKey)).toBeNull();
    });

    it("load expirado retorna null e limpa", () => {
      const { ModuleDrafts, win } = setupDrafts("test-user");
      const now = Date.now();
      const thirtyOneDaysAgo = now - (31 * 24 * 60 * 60 * 1000) - 1000;

      const storageKey = "metodo-aprender:module-draft:v1:test-user:expired-on-load";
      win.localStorage.setItem(storageKey, JSON.stringify({
        hasContent: true,
        updatedAt: thirtyOneDaysAgo,
        uid: "test-user",
        draftId: "expired-on-load",
        version: 1
      }));

      expect(ModuleDrafts.load("expired-on-load")).toBeNull();
      expect(win.localStorage.getItem(storageKey)).toBeNull();
    });
  });
});
