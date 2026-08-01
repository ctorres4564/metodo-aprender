/* Registra o service worker (cache do app + suporte a instalação como PWA). */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      console.error("Falha ao registrar service worker:", e);
    });
  });
}
