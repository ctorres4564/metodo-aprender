const EDUZZ_CHECKOUT_ORIGIN = "https://chk.eduzz.com";
const EDUZZ_CHECKOUT_PATH = "/39VKJQ3DWR";

export function readCookie(cookieHeader, name) {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of String(cookieHeader || "").split(";")) {
    const cookie = part.trim();
    if (!cookie.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(cookie.slice(prefix.length));
    } catch {
      return cookie.slice(prefix.length);
    }
  }
  return "";
}

export function captureRedditClickId(locationHref, cookieHeader) {
  const pageUrl = new URL(locationHref);
  const fromUrl = pageUrl.searchParams.get("rdt_cid")?.trim();
  if (fromUrl) return fromUrl;
  return readCookie(cookieHeader, "_rdt_cid").trim();
}

export function addRedditClickIdToEduzzLinks(documentRef, clickId) {
  if (!clickId) return 0;

  let updated = 0;
  for (const link of documentRef.querySelectorAll("a[href]")) {
    const checkoutUrl = new URL(link.href, documentRef.baseURI);
    if (
      checkoutUrl.origin !== EDUZZ_CHECKOUT_ORIGIN
      || checkoutUrl.pathname.replace(/\/$/, "") !== EDUZZ_CHECKOUT_PATH
    ) continue;

    checkoutUrl.searchParams.set("utm_term", clickId);
    link.href = checkoutUrl.toString();
    updated += 1;
  }
  return updated;
}

export function initializeRedditClickId(windowRef = window, documentRef = document) {
  const clickId = captureRedditClickId(windowRef.location.href, documentRef.cookie);
  console.info(JSON.stringify({ rdt_cid_captured: Boolean(clickId) }));
  addRedditClickIdToEduzzLinks(documentRef, clickId);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  initializeRedditClickId();
}
