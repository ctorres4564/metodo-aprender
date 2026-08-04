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

  // SEGURANÇA/CACHE (A1-04 + A3-08): nunca cacheia chamadas de API (dados
  // sempre precisam ser atuais), requisições que não sejam GET, nem nada
  // fora do próprio domínio do app — antes disso, o filtro só excluía
  // "/api/", o que deixava passar (e cachear) respostas de Firestore,
  // Firebase Storage, o SDK do Firebase via gstatic, bibliotecas via
  // cdnjs e chamadas à Stripe, todas cross-origin. Cache do "shell" deve
  // cobrir só os arquivos estáticos do próprio app (ver SHELL_FILES acima).
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Só grava no cache respostas de sucesso (res.ok) e "basic" (mesmo
        // origin, sem redirecionar pra fora) — nunca respostas de erro
        // (4xx/5xx, ex.: uma página 404) nem "opacas" (cross-origin em modo
        // no-cors, status sempre 0, impossível saber se deu certo).
        if (res.ok && res.type === "basic") {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
