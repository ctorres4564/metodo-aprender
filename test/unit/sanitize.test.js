/* =====================================================================
   TESTES — api/_lib/sanitize.js
   =====================================================================
   cleanStr e cleanList são usadas por 5 endpoints de IA. Qualquer
   alteração aqui afeta todos eles — estes testes existem para garantir
   que a lógica de sanitização permaneça consistente.
   ===================================================================== */

import { describe, expect, it } from "vitest";
import { cleanStr, cleanList } from "../../api/_lib/sanitize.js";

describe("cleanStr", () => {
  it("trunca string no max", () => {
    expect(cleanStr("hello world", 5)).toBe("hello");
    expect(cleanStr("abc", 50)).toBe("abc");
  });

  it("retorna '' para null / undefined / number / object", () => {
    expect(cleanStr(null, 10)).toBe("");
    expect(cleanStr(undefined, 10)).toBe("");
    expect(cleanStr(123, 10)).toBe("");
    expect(cleanStr({}, 10)).toBe("");
    expect(cleanStr([], 10)).toBe("");
  });

  it("não quebra com string vazia", () => {
    expect(cleanStr("", 5)).toBe("");
  });

  it("max 0 retorna vazio sempre", () => {
    expect(cleanStr("hello", 0)).toBe("");
    expect(cleanStr(null, 0)).toBe("");
  });

  it("preserva string exata quando menor que max", () => {
    expect(cleanStr("abc", 10)).toBe("abc");
    expect(cleanStr("abc", 3)).toBe("abc");
  });
});

describe("cleanList", () => {
  it("trunca número de itens e caracteres por item", () => {
    expect(cleanList(["abc", "defgh", "ij"], 2, 3)).toEqual(["abc", "def"]);
  });

  it("remove itens que não são string", () => {
    expect(cleanList(["ok", 123, null, undefined, "hi"], 10, 50)).toEqual(["ok", "hi"]);
  });

  it("retorna [] para não-arrays", () => {
    expect(cleanList(null, 10, 10)).toEqual([]);
    expect(cleanList("not array", 10, 10)).toEqual([]);
    expect(cleanList(undefined, 10, 10)).toEqual([]);
    expect(cleanList({}, 10, 10)).toEqual([]);
  });

  it("retorna [] para array vazio", () => {
    expect(cleanList([], 10, 10)).toEqual([]);
  });

  it("maxItems 0 retorna []", () => {
    expect(cleanList(["a", "b"], 0, 10)).toEqual([]);
  });

  it("maxLen 0 trunca cada item para string vazia", () => {
    expect(cleanList(["abc", "def"], 10, 0)).toEqual(["", ""]);
  });

  it("não altera itens que já estão dentro dos limites", () => {
    expect(cleanList(["hello", "world"], 5, 20)).toEqual(["hello", "world"]);
  });
});