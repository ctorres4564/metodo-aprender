import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadIdentity(){
  const source = readFileSync("assets/concept-identity.js", "utf8");
  let sequence = 0;
  const sandbox = { crypto:{ randomUUID:vi.fn(() => `uuid-${++sequence}`) } };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.ConceptIdentity;
}

describe("identidade estável de conceitos", () => {
  let identity;
  beforeEach(()=>{
    identity = loadIdentity();
    identity.generateConceptId;
  });

  it("gera ID c- independente de título e índice", () => {
    const first = identity.ensureConceptId({ title:"Mesmo título" });
    const second = identity.ensureConceptId({ title:"Mesmo título" });
    expect(first.id).toMatch(/^c-/);
    expect(second.id).toMatch(/^c-/);
    expect(first.id).not.toBe(second.id);
    expect(first.id).not.toContain("mesmo-titulo");
  });

  it("edição normal e mudança de título preservam ID", () => {
    const edited = identity.ensureConceptId({ id:"c-estavel", title:"Título novo", text:"Texto novo" });
    expect(edited.id).toBe("c-estavel");
  });

  it("substituição gera ID novo e registra a identidade anterior", () => {
    const replacement = identity.replaceConcept({ id:"c-antigo", title:"Unidade nova" });
    expect(replacement.id).toMatch(/^c-/);
    expect(replacement.id).not.toBe("c-antigo");
    expect(replacement.replacesConceptId).toBe("c-antigo");
  });

  it("substituição não carrega estado pedagógico ou FSRS porque opera somente no conteúdo", () => {
    const replacement = identity.replaceConcept({ id:"c-antigo", title:"Novo" });
    expect(replacement).not.toHaveProperty("retrievalPassedAt");
    expect(replacement).not.toHaveProperty("stability");
    expect(replacement).not.toHaveProperty("reps");
  });
});

describe("políticas persistentes no editor", () => {
  const source = readFileSync("criar-modulo.html", "utf8");
  it("preserva storageKey existente ao mudar título ou conceitos", () => {
    expect(source).toContain("originalData.config.storageKey");
    expect(source).toContain("storageKey: persistentStorageKey");
  });
  it("não usa título + índice como conceptId", () => {
    expect(source).not.toMatch(/id:\s*origId\s*\|\|\s*\(slugify\(title\)\s*\+\s*"-"\s*\+\s*i\)/);
  });
});
