/* =====================================================================
   TESTES — assets/storage.js (StorageAdapter)
   =====================================================================
   Testa o adaptador de persistência que salva no localStorage
   (imediato) e no Firestore (debounced, com fila serial por key).
   Cobre: save/load, debounce, flush, fila serial, fallback offline,
   migração de chaves antigas e isolamento entre usuários.
   ===================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const src = readFileSync(resolve(__dirname, "../../assets/storage.js"), "utf8");

/**
 * Cria uma instância isolada do StorageAdapter.
 *
 * REGRAS DO vm.createContext:
 * 1. `const StorageAdapter` não vira propriedade do sandbox → trocamos
 *    por `var` no source ANTES de executar.
 * 2. Monkey-patches no localStorage do JSDOM não atravessam a fronteira
 *    do vm (o vm "contextifica" o objeto, criando wrappers internos).
 *    Para testar localStorage quebrado, injetamos um objeto falso
 *    COMPLETO (não o do JSDOM) com a interface Storage e setItem que
 *    lança. O sandbox recebe esse objeto como `localStorage` e o usa
 *    normalmente — sem depender de monkey-patches pós-execução.
 *
 * @param {string|null} uid
 * @param {{loadProgress,saveProgress}|null} appDB
 * @param {{brokenSetItem?:boolean}} opts
 */
function setupStorage(uid, appDB, opts) {
  const dom = new JSDOM("<!doctype html>", { url: "http://localhost" });
  const win = dom.window;

  // localStorage a injetar no sandbox. Se brokenSetItem, usamos um
  // objeto falso em vez do localStorage do JSDOM.
  const storage = (opts && opts.brokenSetItem)
    ? makeBrokenStorage()
    : win.localStorage;

  win.AppAuth = { currentUser: () => (uid ? { uid } : null) };
  if (appDB) win.AppDB = appDB;

  const patchedSrc = src.replace("const StorageAdapter = {", "var StorageAdapter = {");

  const sandbox = vm.createContext({
    window: win,
    localStorage: storage,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  });
  vm.runInContext(patchedSrc, sandbox, { filename: "storage.js" });

  return {
    win,
    localStorage: storage,
    StorageAdapter: sandbox.StorageAdapter,
    dom,
  };
}

/**
 * Objeto que implementa a interface básica de Storage, mas com setItem
 * que sempre lança QuotaExceededError. Usado para testar o caminho de
 * falha do save() sem depender de monkey-patches na fronteira vm.
 * Implementa getItem/setItem/removeItem/key/length para que o storage.js
 * (que acessa localStorage.getItem no load()) não quebre com undefined.
 */
function makeBrokenStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem() { throw new Error("QuotaExceededError"); },
    removeItem(key) { store.delete(key); },
    get length() { return store.size; },
    key(n) { return [...store.keys()][n] || null; },
    clear() { store.clear(); },
  };
}

/**
 * Objeto Storage completo, igual ao do JSDOM, mas sem os wrappers do vm.
 * Usado nos testes que precisam de um localStorage funcional E que querem
 * inspecionar as chaves diretamente sem depender da referência do JSDOM.
 */
function makeGoodStorage() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, value); },
    removeItem(key) { store.delete(key); },
    get length() { return store.size; },
    key(n) { return [...store.keys()][n] || null; },
    clear() { store.clear(); },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

// ---- _key -------------------------------------------------------------

describe("_key", () => {
  it("prefixa com uid quando logado", () => {
    const { StorageAdapter } = setupStorage("abc123");
    expect(StorageAdapter._key("my-module")).toBe("u:abc123:my-module");
  });

  it("retorna key original quando sem uid", () => {
    const { StorageAdapter } = setupStorage(null);
    expect(StorageAdapter._key("my-module")).toBe("my-module");
  });
});

// ---- save / load (localStorage) ---------------------------------------

describe("save e load — localStorage", () => {
  it("salva e recupera dados via localStorage (sem Firestore)", async () => {
    const { StorageAdapter } = setupStorage("test-user");
    await StorageAdapter.save("mod1", { xp: 42, streak: 3 });
    const loaded = await StorageAdapter.load("mod1");
    expect(loaded.xp).toBe(42);
    expect(loaded.streak).toBe(3);
  });

  it("salva com chave prefixada por uid", async () => {
    const { StorageAdapter } = setupStorage("user-x");
    await StorageAdapter.save("mod2", { data: "hello" });
    const loaded = await StorageAdapter.load("mod2");
    expect(loaded).not.toBeNull();
    expect(loaded.data).toBe("hello");

    const { StorageAdapter: saOther } = setupStorage("user-y");
    expect(await saOther.load("mod2")).toBeNull();
  });

  it("load retorna null para chave inexistente", async () => {
    const { StorageAdapter } = setupStorage("test-user");
    expect(await StorageAdapter.load("nonexistent")).toBeNull();
  });

  it("save retorna false quando localStorage falha", async () => {
    // Usa storage falso com setItem quebrado — sem monkey-patch.
    const { StorageAdapter } = setupStorage("test-user", null, { brokenSetItem: true });
    const ok = await StorageAdapter.save("full", { data: "x" });
    expect(ok).toBe(false);
  });
});

// ---- Isolamento entre usuários ----------------------------------------

describe("isolamento entre usuários", () => {
  it("usuário A não lê dados do usuário B", async () => {
    const { StorageAdapter: saA } = setupStorage("user-a");
    await saA.save("shared-key", { value: "A" });
    const { StorageAdapter: saB } = setupStorage("user-b");
    expect(await saB.load("shared-key")).toBeNull();
  });

  it("mesma key, usuários diferentes → dados independentes", async () => {
    const { StorageAdapter: saA } = setupStorage("user-a");
    await saA.save("indep", { v: 1 });
    const { StorageAdapter: saB } = setupStorage("user-b");
    await saB.save("indep", { v: 2 });
    expect((await saA.load("indep")).v).toBe(1);
    expect((await saB.load("indep")).v).toBe(2);
  });
});

// ---- Debounce para Firestore ------------------------------------------

describe("save — debounce para Firestore", () => {
  it("localStorage é imediato, Firestore é agendado (debounce 4s)", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const { StorageAdapter } = setupStorage("test-user", {
      loadProgress: vi.fn().mockResolvedValue(null),
      saveProgress: saveMock,
    });

    await StorageAdapter.save("mod3", { value: 1 });
    expect((await StorageAdapter.load("mod3")).value).toBe(1);
    expect(saveMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(4000);
    await vi.runAllTimersAsync();
    await (StorageAdapter._queues && StorageAdapter._queues["mod3"]);
    expect(saveMock).toHaveBeenCalledWith("mod3", { value: 1 });
  });

  it("múltiplos saves: só a última versão vai para o Firestore", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const { StorageAdapter } = setupStorage("test-user", {
      loadProgress: vi.fn().mockResolvedValue(null),
      saveProgress: saveMock,
    });

    await StorageAdapter.save("mod4", { v: 1 });
    await StorageAdapter.save("mod4", { v: 2 });
    await StorageAdapter.save("mod4", { v: 3 });

    vi.advanceTimersByTime(4000);
    await vi.runAllTimersAsync();
    await (StorageAdapter._queues && StorageAdapter._queues["mod4"]);

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(saveMock).toHaveBeenCalledWith("mod4", { v: 3 });
  });
});

// ---- flush ------------------------------------------------------------

describe("flush", () => {
  it("flush(key) força gravação imediata no Firestore", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const { StorageAdapter } = setupStorage("test-user", {
      loadProgress: vi.fn().mockResolvedValue(null),
      saveProgress: saveMock,
    });

    await StorageAdapter.save("mod5", { v: 99 });
    await StorageAdapter.flush("mod5");
    expect(saveMock).toHaveBeenCalledWith("mod5", { v: 99 });
  });

  it("flush() sem argumento grava todas as keys pendentes", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const { StorageAdapter } = setupStorage("test-user", {
      loadProgress: vi.fn().mockResolvedValue(null),
      saveProgress: saveMock,
    });

    await StorageAdapter.save("a", { n: 1 });
    await StorageAdapter.save("b", { n: 2 });
    await StorageAdapter.flush();
    expect(saveMock).toHaveBeenCalledWith("a", { n: 1 });
    expect(saveMock).toHaveBeenCalledWith("b", { n: 2 });
  });

  it("flush de key sem pendência não quebra", async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const { StorageAdapter } = setupStorage("test-user", {
      loadProgress: vi.fn().mockResolvedValue(null),
      saveProgress: saveMock,
    });

    await StorageAdapter.flush("nunca-salva");
    expect(saveMock).not.toHaveBeenCalled();
  });
});

// ---- Fila serial ------------------------------------------------------

describe("fila serial (_queues)", () => {
  it("duas escritas da mesma key são serializadas (não concorrentes)", async () => {
    let running = 0;
    let maxConcurrent = 0;
    const saveMock = vi.fn().mockImplementation(async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
    });

    const { StorageAdapter } = setupStorage("test-user", {
      loadProgress: vi.fn().mockResolvedValue(null),
      saveProgress: saveMock,
    });

    await StorageAdapter.save("serial", { v: 1 });
    await StorageAdapter.save("serial", { v: 2 });

    vi.advanceTimersByTime(4000);
    await vi.runAllTimersAsync();
    await (StorageAdapter._queues && StorageAdapter._queues["serial"]);

    expect(maxConcurrent).toBe(1);
  });

  it("keys diferentes são concorrentes entre si", async () => {
    let running = 0;
    let maxConcurrent = 0;
    const saveMock = vi.fn().mockImplementation(async () => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
    });

    const { StorageAdapter } = setupStorage("test-user", {
      loadProgress: vi.fn().mockResolvedValue(null),
      saveProgress: saveMock,
    });

    await StorageAdapter.save("x", { v: 1 });
    await StorageAdapter.save("y", { v: 2 });

    vi.advanceTimersByTime(4000);
    await vi.runAllTimersAsync();
    await (StorageAdapter._queues && StorageAdapter._queues["x"]);
    await (StorageAdapter._queues && StorageAdapter._queues["y"]);

    expect(maxConcurrent).toBeGreaterThanOrEqual(2);
  });
});

// ---- Fallback offline --------------------------------------------------

describe("fallback offline", () => {
  it("load cai para localStorage quando Firestore falha", async () => {
    const { StorageAdapter, localStorage } = setupStorage("test-user", {
      loadProgress: vi.fn().mockRejectedValue(new Error("Firestore offline")),
      saveProgress: vi.fn(),
    });

    localStorage.setItem("u:test-user:offline", JSON.stringify({ xp: 10 }));
    expect((await StorageAdapter.load("offline")).xp).toBe(10);
  });

  it("save não quebra quando Firestore falha (localStorage já está salvo)", async () => {
    const { StorageAdapter } = setupStorage("test-user", {
      loadProgress: vi.fn().mockResolvedValue(null),
      saveProgress: vi.fn().mockRejectedValue(new Error("Firestore offline")),
    });

    const ok = await StorageAdapter.save("resilient", { v: 1 });
    expect(ok).toBe(true);

    const loaded = await StorageAdapter.load("resilient");
    expect(loaded).not.toBeNull();
    expect(loaded.v).toBe(1);

    vi.advanceTimersByTime(4000);
    await vi.runAllTimersAsync();
  });

  it("load retorna null quando ambos Firestore e localStorage falham", async () => {
    const { StorageAdapter } = setupStorage("test-user", {
      loadProgress: vi.fn().mockRejectedValue(new Error("offline")),
      saveProgress: vi.fn(),
    });
    expect(await StorageAdapter.load("nope")).toBeNull();
  });
});

// ---- Migração de chaves antigas ---------------------------------------

describe("migração de chaves antigas (sem prefixo uid)", () => {
  it("migra chave sem prefixo para chave com prefixo na primeira leitura", async () => {
    const { StorageAdapter, localStorage } = setupStorage("migrate-user");
    localStorage.setItem("old-module", JSON.stringify({ xp: 100 }));

    const result = await StorageAdapter.load("old-module");
    expect(result.xp).toBe(100);
    expect(localStorage.getItem("old-module")).toBeNull();
    expect(JSON.parse(localStorage.getItem("u:migrate-user:old-module")).xp).toBe(100);
  });

  it("não migra se já existe chave prefixada (usa a prefixada)", async () => {
    const { StorageAdapter, localStorage } = setupStorage("no-migrate");
    localStorage.setItem("u:no-migrate:same", JSON.stringify({ xp: 200 }));
    localStorage.setItem("same", JSON.stringify({ xp: 100 }));
    expect((await StorageAdapter.load("same")).xp).toBe(200);
  });

  it("sem uid logado: não migra (não tem uid para prefixar)", async () => {
    const { StorageAdapter, localStorage } = setupStorage(null);
    localStorage.setItem("no-uid-key", JSON.stringify({ xp: 50 }));
    expect((await StorageAdapter.load("no-uid-key")).xp).toBe(50);
    expect(localStorage.getItem("no-uid-key")).not.toBeNull();
  });
});

// ---- Prioridade Firestore > localStorage -------------------------------

describe("prioridade Firestore > localStorage", () => {
  it("load retorna dados do Firestore quando disponível, mesmo com localStorage diferente", async () => {
    const { StorageAdapter, localStorage } = setupStorage("test-user", {
      loadProgress: vi.fn().mockResolvedValue({ v: 99 }),
      saveProgress: vi.fn(),
    });
    localStorage.setItem("u:test-user:conflict", JSON.stringify({ v: 1 }));
    expect((await StorageAdapter.load("conflict")).v).toBe(99);
  });
});