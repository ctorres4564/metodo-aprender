import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "../..");
const salesPagePath = resolve(projectRoot, "livro/index.html");
const html = readFileSync(salesPagePath, "utf8");
const vercelConfig = JSON.parse(readFileSync(resolve(projectRoot, "vercel.json"), "utf8"));

describe("página de vendas /livro", () => {
  it("mantém todos os recursos locais isolados em /livro/assets", () => {
    const localReferences = [...html.matchAll(/(?:src|href)="(\/livro\/assets\/[^\"]+)"/g)]
      .map((match) => match[1]);

    expect(localReferences.length).toBeGreaterThan(0);

    for (const reference of new Set(localReferences)) {
      expect(existsSync(resolve(projectRoot, reference.slice(1))), reference).toBe(true);
    }
  });

  it("não depende de scripts, analytics ou caminhos absolutos do Lovable", () => {
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toContain("/~flock");
    expect(html).not.toContain("/__l5e/");
    expect(html).not.toContain('src="/assets/');
    expect(html).not.toContain('href="/assets/');
    expect(html).not.toContain("lovable.app");
  });

  it("declara a URL pública correta", () => {
    expect(html).toContain('rel="canonical" href="https://metodoaprender.com/livro"');
    expect(html).toContain('property="og:url" content="https://metodoaprender.com/livro"');
  });

  it("faz rewrite somente da rota pública /livro", () => {
    expect(vercelConfig.rewrites).toEqual([
      { source: "/livro", destination: "/livro/index.html" },
    ]);
  });
});
