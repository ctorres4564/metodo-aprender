import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

describe("security hardening regressions", () => {
  it("does not interpolate untrusted API and document values into known HTML sinks", () => {
    const sources = [
      read("index.html"),
      read("biblioteca.html"),
      read("criar-modulo.html"),
      read("importar-livro.html"),
      read("assets/engine.js")
    ].join("\n");

    expect(sources).not.toContain("<h3>${m.title}</h3>");
    expect(sources).not.toMatch(/innerHTML\s*=.*\$\{data\.error/);
    expect(sources).not.toMatch(/innerHTML\s*=.*\$\{e\.message/);
    expect(sources).not.toContain('"${target}" não encontrada');
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
