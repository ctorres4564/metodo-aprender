import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import {
  REDDIT_CHECKOUT_EVENT_NAME,
  addRedditClickIdToEduzzLinks,
  attachRedditCheckoutTracking,
  captureRedditClickId,
  initializeRedditClickId,
  isEduzzCheckoutUrl,
  trackRedditCheckoutClick,
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

  it("identifica corretamente links válidos de checkout Eduzz", () => {
    const baseURI = "https://metodoaprender.com/livro";
    expect(isEduzzCheckoutUrl("https://chk.eduzz.com/39VKJQ3DWR", baseURI)).toBe(true);
    expect(isEduzzCheckoutUrl("https://chk.eduzz.com/39VKJQ3DWR/", baseURI)).toBe(true);
    expect(isEduzzCheckoutUrl("https://chk.eduzz.com/39VKJQ3DWR?utm_source=reddit", baseURI)).toBe(true);
    expect(isEduzzCheckoutUrl("https://chk.eduzz.com/OUTRO_PRODUTO", baseURI)).toBe(false);
    expect(isEduzzCheckoutUrl("https://example.com/39VKJQ3DWR", baseURI)).toBe(false);
    expect(isEduzzCheckoutUrl("#acesso", baseURI)).toBe(false);
    expect(isEduzzCheckoutUrl("", baseURI)).toBe(false);
    expect(isEduzzCheckoutUrl(null, baseURI)).toBe(false);
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

  it("dispara evento Custom CheckoutClick quando window.rdt está disponível", () => {
    const mockRdt = vi.fn();
    const fakeWindow = { rdt: mockRdt };

    const tracked = trackRedditCheckoutClick(fakeWindow);
    expect(tracked).toBe(true);
    expect(mockRdt).toHaveBeenCalledTimes(1);
    expect(mockRdt).toHaveBeenCalledWith("track", "Custom", {
      customEventName: REDDIT_CHECKOUT_EVENT_NAME,
    });
  });

  it("trata ausência de window.rdt graciosamente sem lançar erro", () => {
    expect(trackRedditCheckoutClick({})).toBe(false);
    expect(trackRedditCheckoutClick(null)).toBe(false);
  });

  it("dispara CheckoutClick no clique do link Eduzz e não no carregamento", () => {
    const dom = new JSDOM(`
      <a id="btn-eduzz" href="https://chk.eduzz.com/39VKJQ3DWR"><span>Quero comprar</span></a>
      <a id="btn-ancora" href="#acesso">Ver oferta</a>
      <a id="btn-outro" href="https://google.com">Outro</a>
    `, { url: "https://metodoaprender.com/livro" });

    const mockRdt = vi.fn();
    dom.window.rdt = mockRdt;

    attachRedditCheckoutTracking(dom.window, dom.window.document);

    // No carregamento da página não deve haver disparos
    expect(mockRdt).not.toHaveBeenCalled();

    // Clique em link que não é Eduzz não dispara
    dom.window.document.querySelector("#btn-ancora").click();
    dom.window.document.querySelector("#btn-outro").click();
    expect(mockRdt).not.toHaveBeenCalled();

    // Clique em elemento filho dentro do link Eduzz dispara 1 evento
    const span = dom.window.document.querySelector("#btn-eduzz span");
    const clickEvent = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
    span.dispatchEvent(clickEvent);

    expect(mockRdt).toHaveBeenCalledTimes(1);
    expect(mockRdt).toHaveBeenCalledWith("track", "Custom", {
      customEventName: "CheckoutClick",
    });
    expect(clickEvent.defaultPrevented).toBe(false);
  });

  it("garante exatamente 1 evento por clique mesmo com múltiplas inicializações", () => {
    const dom = new JSDOM(`
      <a id="btn-eduzz" href="https://chk.eduzz.com/39VKJQ3DWR">Comprar</a>
    `, { url: "https://metodoaprender.com/livro?rdt_cid=CID_TEST" });

    const mockRdt = vi.fn();
    dom.window.rdt = mockRdt;

    // Chamadas repetidas de inicialização
    initializeRedditClickId(dom.window, dom.window.document);
    initializeRedditClickId(dom.window, dom.window.document);

    const button = dom.window.document.querySelector("#btn-eduzz");
    button.click();

    expect(mockRdt).toHaveBeenCalledTimes(1);
    expect(button.href).toBe("https://chk.eduzz.com/39VKJQ3DWR?utm_term=CID_TEST");
  });

  it("inicializa na URL real e atualiza o href do checkout no DOM", () => {
    const dom = new JSDOM(
      '<a href="https://chk.eduzz.com/39VKJQ3DWR">Comprar</a>',
      { url: "https://metodoaprender.com/livro?rdt_cid=TESTE123" },
    );

    initializeRedditClickId(dom.window, dom.window.document);

    expect(dom.window.document.querySelector("a").href).toBe(
      "https://chk.eduzz.com/39VKJQ3DWR?utm_term=TESTE123",
    );
  });
});
