/* =====================================================================
   TESTES — api/_lib/usage.js (funções puras)
   =====================================================================
   Testa planLimit, currentMonthKey, usageDocId e DEFAULT_BUCKET — as
   funções que não dependem do Firebase Admin e são usadas por todos os
   5 endpoints de IA.

   usage.js é um módulo ES (import/export), então não podemos usar
   vm.runInContext. Em vez disso, extraímos as definições das funções
   puras via regex e as recriamos num eval isolado — sem reescrever a
   lógica, só read-only do source real.
   ===================================================================== */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const src = readFileSync(resolve(__dirname, "../../api/_lib/usage.js"), "utf8");

// Extrai a definição de cada função pura do source original.
// Não reescreve — só isola as que não dependem de firebaseAdmin.
function extractPureFunction(source, fnName) {
  const re = new RegExp(
    `function ${fnName}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`,
    "m"
  );
  const m = source.match(re);
  if (!m) throw new Error(`Função ${fnName} não encontrada em usage.js`);
  return m[0];
}

// Recria as funções puras em um escopo isolado
function createHelpers() {
  const planLimitSrc = extractPureFunction(src, "planLimit");
  const currentMonthKeySrc = extractPureFunction(src, "currentMonthKey");
  const usageDocIdSrc = extractPureFunction(src, "usageDocId");

  // Extrai as constantes PLAN_LIMITS e DEFAULT_BUCKET
  const planLimitsMatch = src.match(/const PLAN_LIMITS = \{[\s\S]*?\n\};/);
  const defaultBucketMatch = src.match(/const DEFAULT_BUCKET = "generate";/);

  if (!planLimitsMatch || !defaultBucketMatch) {
    throw new Error("Não foi possível extrair PLAN_LIMITS ou DEFAULT_BUCKET");
  }

  // Cria um escopo com as constantes e funções
  const scopeCode = `
    ${planLimitsMatch[0]}
    ${defaultBucketMatch[0]}
    ${planLimitSrc}
    ${currentMonthKeySrc}
    ${usageDocIdSrc}
    return { planLimit, currentMonthKey, usageDocId, DEFAULT_BUCKET };
  `;

  // eslint-disable-next-line no-new-func
  const factory = new Function(scopeCode);
  return factory();
}

const helpers = createHelpers();

describe("planLimit", () => {
  it("explain/free → 300", () => {
    expect(helpers.planLimit("explain", "free")).toBe(300);
  });

  it("explain/premium → 3000", () => {
    expect(helpers.planLimit("explain", "premium")).toBe(3000);
  });

  it("generate/free → 60", () => {
    expect(helpers.planLimit("generate", "free")).toBe(60);
  });

  it("generate/premium → 600", () => {
    expect(helpers.planLimit("generate", "premium")).toBe(600);
  });

  it("bucket desconhecido → fallback para DEFAULT_BUCKET (generate)", () => {
    expect(helpers.planLimit("desconhecido", "free")).toBe(60);
    expect(helpers.planLimit("desconhecido", "premium")).toBe(600);
  });

  it("plano desconhecido → fallback para 'free'", () => {
    expect(helpers.planLimit("explain", "enterprise")).toBe(300);
    expect(helpers.planLimit("generate", "enterprise")).toBe(60);
  });
});

describe("currentMonthKey", () => {
  it("retorna formato YYYY-MM", () => {
    expect(helpers.currentMonthKey()).toMatch(/^\d{4}-\d{2}$/);
  });

  it("usa UTC, não timezone local", () => {
    const now = new Date();
    const key = helpers.currentMonthKey();
    const expectedYear = now.getUTCFullYear();
    const expectedMonth = String(now.getUTCMonth() + 1).padStart(2, "0");
    expect(key).toBe(`${expectedYear}-${expectedMonth}`);
  });
});

describe("usageDocId", () => {
  it("para 'generate' (DEFAULT_BUCKET): formato antigo sem sufixo", () => {
    const key = helpers.currentMonthKey();
    expect(helpers.usageDocId("user123", "generate")).toBe(`user123_${key}`);
  });

  it("para 'explain': inclui sufixo _explain", () => {
    const key = helpers.currentMonthKey();
    expect(helpers.usageDocId("user123", "explain")).toBe(`user123_${key}_explain`);
  });

  it("para qualquer bucket não-default: inclui sufixo com o nome do bucket", () => {
    const key = helpers.currentMonthKey();
    expect(helpers.usageDocId("user123", "outro")).toBe(`user123_${key}_outro`);
  });
});

describe("DEFAULT_BUCKET", () => {
  it("é 'generate'", () => {
    expect(helpers.DEFAULT_BUCKET).toBe("generate");
  });
});
