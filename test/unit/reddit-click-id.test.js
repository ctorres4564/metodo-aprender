import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import {
  addRedditClickIdToEduzzLinks,
  captureRedditClickId,
} from "../../livro/reddit-click-id.js";

describe("atribuição Reddit na página /livro", () => {
  it("prioriza rdt_cid vindo da URL", () => {
    expect(captureRedditClickId(
      "https://metodoaprender.com/livro?rdt_cid=url-click-id",
      "_rdt_cid=cookie-click-id",
    )).toBe("url-click-id");
  });

  it("usa o cookie _rdt_cid quando o parâmetro não existe", () => {
    expect(captureRedditClickId(
      "https://metodoaprender.com/livro",
      "other=value; _rdt_cid=cookie-click-id",
    )).toBe("cookie-click-id");
  });

  it("adiciona utm_term a todos os links Eduzz preservando parâmetros", () => {
    const dom = new JSDOM(`
      <a href="https://chk.eduzz.com/39VKJQ3DWR">Comprar</a>
      <a href="https://chk.eduzz.com/39VKJQ3DWR?utm_source=reddit&coupon=promo">Comprar 2</a>
      <a href="https://example.com/39VKJQ3DWR">Outro</a>
    `, { url: "https://metodoaprender.com/livro" });

    expect(addRedditClickIdToEduzzLinks(dom.window.document, "abc 123")).toBe(2);
    const links = [...dom.window.document.querySelectorAll("a")].map((link) => new URL(link.href));
    expect(links[0].searchParams.get("utm_term")).toBe("abc 123");
    expect(links[1].searchParams.get("utm_source")).toBe("reddit");
    expect(links[1].searchParams.get("coupon")).toBe("promo");
    expect(links[1].searchParams.get("utm_term")).toBe("abc 123");
    expect(links[2].searchParams.has("utm_term")).toBe(false);
  });
});
