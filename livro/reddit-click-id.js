const EDUZZ_CHECKOUT_ORIGIN = "https://chk.eduzz.com";
const EDUZZ_CHECKOUT_PATH = "/39VKJQ3DWR";
export const REDDIT_CHECKOUT_EVENT_NAME = "CheckoutClick";

const trackingAttachedDocuments = new WeakSet();

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

export function isEduzzCheckoutUrl(urlLike, baseURI) {
  if (!urlLike) return false;
  try {
    const checkoutUrl = new URL(urlLike, baseURI);
    return (
      checkoutUrl.origin === EDUZZ_CHECKOUT_ORIGIN
      && checkoutUrl.pathname.replace(/\/$/, "") === EDUZZ_CHECKOUT_PATH
    );
  } catch {
    return false;
  }
}

export function addRedditClickIdToEduzzLinks(documentRef, clickId) {
  if (!clickId) return 0;

  let updated = 0;
  for (const link of documentRef.querySelectorAll("a[href]")) {
    if (!isEduzzCheckoutUrl(link.href, documentRef.baseURI)) continue;

    const checkoutUrl = new URL(link.href, documentRef.baseURI);
    checkoutUrl.searchParams.set("utm_term", clickId);
    link.href = checkoutUrl.toString();
    updated += 1;
  }
  return updated;
}

export function trackRedditCheckoutClick(windowRef = window) {
  if (typeof windowRef?.rdt === "function") {
    try {
      windowRef.rdt("track", "Custom", { customEventName: REDDIT_CHECKOUT_EVENT_NAME });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function attachRedditCheckoutTracking(windowRef = window, documentRef = document) {
  if (!documentRef || trackingAttachedDocuments.has(documentRef)) {
    return () => {};
  }

  const handleClick = (event) => {
    const link = event.target?.closest?.("a[href]");
    if (!link) return;

    if (isEduzzCheckoutUrl(link.href, documentRef.baseURI)) {
      trackRedditCheckoutClick(windowRef);
    }
  };

  documentRef.addEventListener("click", handleClick, { capture: true });
  trackingAttachedDocuments.add(documentRef);

  return () => {
    documentRef.removeEventListener("click", handleClick, { capture: true });
    trackingAttachedDocuments.delete(documentRef);
  };
}

export function initializeRedditClickId(windowRef = window, documentRef = document) {
  const clickId = captureRedditClickId(windowRef.location.href, documentRef.cookie);
  console.info(JSON.stringify({ rdt_cid_captured: Boolean(clickId) }));
  addRedditClickIdToEduzzLinks(documentRef, clickId);
  attachRedditCheckoutTracking(windowRef, documentRef);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  initializeRedditClickId();
}
