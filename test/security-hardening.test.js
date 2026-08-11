import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { extractFunctionSource } from "./helpers/extractFunctionSource.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoPath = (file) => path.resolve(__dirname, "..", file);
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

// Carrega a implementação REAL de escapeHtml() de cada arquivo — não uma
// reimplementação no teste — do mesmo jeito que test/helpers/loadEngineFsrs.js
// já faz para as funções do FSRS: roda o texto extraído num contexto isolado
// do Node (vm), sem modificar nem duplicar a lógica de produção.
function loadRealEscapeHtml(file) {
  const src = extractFunctionSource(repoPath(file), "escapeHtml");
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: file });
  return sandbox.escapeHtml;
}

const FILES_WITH_ESCAPE_HTML = ["index.html", "biblioteca.html", "criar-modulo.html", "importar-livro.html", "assets/engine.js"];

// Payloads de injeção que qualquer um dos dois "sinks" HTML usados em
// produção (texto de elemento e valor de atributo entre aspas duplas)
// precisa neutralizar. Testa o comportamento renderizado de verdade (via
// jsdom), não o texto-fonte — sobrevive a reformatação, só quebra se a
// função realmente parar de escapar corretamente.
const XSS_PAYLOADS = [
  '<img src=x onerror="window.__pwned=1">',
  "<script>window.__pwned=1</script>",
  '"><svg onload="window.__pwned=1">',
  "</h3><b>injetado</b>"
];

describe("security hardening regressions", () => {
  describe.each(FILES_WITH_ESCAPE_HTML)("escapeHtml() real de %s", (file) => {
    const escapeHtml = loadRealEscapeHtml(file);

    it.each(XSS_PAYLOADS)("neutraliza \"%s\" em contexto de texto de elemento", (payload) => {
      const dom = new JSDOM("<!doctype html><div id=\"c\"></div>");
      const container = dom.window.document.getElementById("c");
      // Mesmo padrão usado em produção: `<h3>${escapeHtml(valor)}</h3>`.
      container.innerHTML = `<h3>${escapeHtml(payload)}</h3>`;

      // Nenhum elemento executável/injetado deve ter sido criado — o
      // payload inteiro deve ter virado texto literal dentro do <h3>.
      expect(container.querySelectorAll("script, img, svg, b").length).toBe(0);
      expect(container.textContent).toContain(payload);
    });

    it.each(XSS_PAYLOADS)("neutraliza \"%s\" em contexto de atributo entre aspas duplas", (payload) => {
      const dom = new JSDOM("<!doctype html><div id=\"c\"></div>");
      const container = dom.window.document.getElementById("c");
      // Mesmo padrão usado em produção: `data-id="${escapeHtml(valor)}"`.
      container.innerHTML = `<span data-id="${escapeHtml(payload)}"></span>`;
      const span = container.querySelector("span");

      // O payload não deve ter escapado do atributo criando um elemento
      // novo, nem introduzido um atributo extra (ex.: onerror/onload).
      expect(container.querySelectorAll("script, img, svg, b").length).toBe(0);
      expect(span.attributes.length).toBe(1);
      expect(span.getAttribute("data-id")).toBe(payload);
    });
  });

  it("enforces baseline browser security headers", () => {
    const config = JSON.parse(read("vercel.json"));
    const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
    expect(headers["Strict-Transport-Security"]).toContain("max-age=");
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });

  it("reserves material quota and creates the material in one transaction", () => {
    const source = read("api/material.js");
    expect(source).toContain("await db.runTransaction");
    expect(source).toContain("activeMaterialCount: current + 1");
    expect(source).toContain("tx.create(ref, data)");
    expect(source).not.toContain("permitindo a criação");
  });

  it("requires human review before an imported module is persisted", () => {
    const importer = read("importar-livro.html");
    const editor = read("criar-modulo.html");
    expect(importer).not.toContain("await window.AppDB.saveUserModule(moduleId, moduleData)");
    expect(importer).toContain("window.ModuleDrafts.save(moduleId");
    expect(importer).toContain("criar-modulo.html?draft=");
    expect(editor).toContain("Existe um rascunho não salvo. Restaurar?");
    expect(editor).toContain("window.ModuleDrafts.remove(activeDraft.draftId)");
  });

  it("registers imported modules idempotently after save", () => {
    const materialApi = read("api/material.js");
    expect(materialApi).toContain('collection("generatedModules").doc(moduleId)');
    expect(materialApi).toContain("if (markerSnap.exists)");
    expect(materialApi).toContain("tx.create(markerRef");
  });
});
