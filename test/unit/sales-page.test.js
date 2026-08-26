import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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

  it("não depende de scripts ou caminhos absolutos do Lovable", () => {
    expect(html).not.toMatch(/<script[^>]+src=["'][^"']*lovable/i);
    expect(html).not.toContain("/~flock");
    expect(html).not.toContain("/__l5e/");
    expect(html).not.toContain('src="/assets/');
    expect(html).not.toContain('href="/assets/');
    expect(html).not.toContain("lovable.app");
  });

  it("carrega uma única instância do Reddit Pixel e dispara PageVisit", () => {
    expect(html.match(/redditstatic\.com\/ads\/pixel\.js/g)).toHaveLength(1);
    expect(html.match(/rdt\('init','a2_jilrf2g66w2e'\)/g)).toHaveLength(1);
    expect(html.match(/rdt\('track', 'PageVisit'\)/g)).toHaveLength(1);

    const pixelScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(pixelScript).toBeDefined();

    const browserNormalizedScript = pixelScript.replace(/\r\n/g, "\n");
    const pixelHash = createHash("sha256").update(browserNormalizedScript).digest("base64");
    const csp = vercelConfig.headers[0].headers.find(
      (header) => header.key === "Content-Security-Policy",
    ).value;

    expect(csp).toContain(`'sha256-${pixelHash}'`);
    expect(csp).toContain("https://www.redditstatic.com");
    expect(csp).toContain("https://pixel-config.reddit.com");
    expect(csp).toContain("https://alb.reddit.com");
  });

  it("declara a URL pública correta", () => {
    expect(html).toContain('rel="canonical" href="https://metodoaprender.com/livro"');
    expect(html).toContain('property="og:url" content="https://metodoaprender.com/livro"');
  });

  it("carrega o propagador de Click ID sem alterar os links base do checkout", () => {
    expect(html).toContain('<script type="module" src="/livro/reddit-click-id.js"></script>');
    expect(html.match(/href="https:\/\/chk\.eduzz\.com\/39VKJQ3DWR"/g)).toHaveLength(2);
  });

  it("faz rewrite somente da rota pública /livro", () => {
    expect(vercelConfig.rewrites).toEqual([
      { source: "/livro", destination: "/livro/index.html" },
    ]);
  });
});
