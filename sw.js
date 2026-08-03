/* =====================================================================
   SERVICE WORKER — cache básico do "shell" do app para permitir
   instalação (PWA) e abertura mais rápida/offline dos arquivos estáticos.
   =====================================================================
   Não faz cache de dados dinâmicos (conteúdo de módulos vindo do
   Firestore, respostas de IA) — só do HTML/CSS/JS/ícones que compõem a
   interface. Uma estratégia "network-first, cache como reserva": sempre
   tenta buscar a versão mais nova da rede, e só usa o cache se a rede
   falhar (ex: sem conexão) — assim nunca fica preso numa versão antiga
   do app depois de um novo deploy.
   ===================================================================== */

const CACHE_NAME = "metodo-aprender-shell-v4";
const SHELL_FILES = [
  "index.html",
  "app.html",
  "criar-modulo.html",
  "importar-livro.html",
  "biblioteca.html",
  "leitor.html",
  "manifest.json",
  "assets/styles.css",
  "assets/engine.js",
  "assets/storage.js",
  "assets/auth-ui.js",
  "assets/api-client.js",
  "assets/ocr.js",
  "assets/material-limits.js",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Nunca cacheia chamadas de API (dados sempre precisam ser atuais) nem
  // requisições que não sejam GET.
  if (req.method !== "GET" || req.url.includes("/api/")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});
