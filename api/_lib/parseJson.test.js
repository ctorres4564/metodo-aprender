/* =====================================================================
   TESTES — api/_lib/parseJson.js (extractJson)
   =====================================================================
   Usado por callOpenRouter (openrouter.js) pra extrair o JSON da
   resposta de texto de um modelo de linguagem — que raramente devolve
   JSON 100% puro, mesmo quando pedido: vem cercado por ```json ```,
   com prosa antes/depois, etc.
   ===================================================================== */
import { describe, expect, it } from "vitest";
import { extractJson } from "./parseJson.js";

describe("extractJson", () => {
  it("parseia JSON limpo direto", () => {
    expect(extractJson('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  it("remove cerca de bloco de código com a label 'json'", () => {
    const raw = '```json\n{"a":1}\n```';
    expect(extractJson(raw)).toEqual({ a: 1 });
  });

  it("remove cerca de bloco de código sem label", () => {
    const raw = '```\n{"a":1}\n```';
    expect(extractJson(raw)).toEqual({ a: 1 });
  });

  it("ignora espaços/quebras de linha antes e depois", () => {
    expect(extractJson('  \n  {"a":1}  \n  ')).toEqual({ a: 1 });
  });

  it("extrai o JSON mesmo com prosa solta antes e depois", () => {
    const raw = 'Aqui está o resultado:\n{"a":1,"b":[1,2,3]}\nEspero que ajude!';
    expect(extractJson(raw)).toEqual({ a: 1, b: [1, 2, 3] });
  });

  it("lida com objetos aninhados (chaves internas não confundem a extração)", () => {
    const raw = 'texto\n{"outer":{"inner":{"deep":true}},"list":[{"x":1},{"y":2}]}\nfim';
    expect(extractJson(raw)).toEqual({ outer: { inner: { deep: true } }, list: [{ x: 1 }, { y: 2 }] });
  });

  it("lança erro em string vazia", () => {
    expect(() => extractJson("")).toThrow(/vazia/i);
  });

  it("lança erro quando a entrada não é string (null/undefined/número)", () => {
    expect(() => extractJson(null)).toThrow();
    expect(() => extractJson(undefined)).toThrow();
    expect(() => extractJson(42)).toThrow();
  });

  it("lança erro quando não há JSON nenhum no texto", () => {
    expect(() => extractJson("isso aqui não é JSON de jeito nenhum")).toThrow(/não foi possível extrair/i);
  });

  it("lança erro em JSON malformado dentro das chaves (não finge sucesso)", () => {
    expect(() => extractJson('{"a": 1, "b": }')).toThrow();
  });
});
