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

// Bump sempre que SHELL_FILES mudar — o
// "activate" abaixo já apaga QUALQUER cache com nome diferente do atual
// (não só "v4" especificamente), então essa troca de nome sozinha garante
// que o cache antigo (com a lista de arquivos desatualizada) some na
// próxima ativação, sem precisar listar versões antigas manualmente aqui.
const CACHE_NAME = "metodo-aprender-shell-v7";

// V7: adicionado assets/onboarding-wizard.js (adicionado em feat/ux).
// V6->V7: sempre que criar um novo script em assets/, adicione-o aqui.
const SHELL_FILES = [
  // Páginas
  "index.html",
  "app.html",
  "criar-modulo.html",
  "importar-livro.html",
  "biblioteca.html",
  "leitor.html",
  "busca.html",
  "conta.html",
  "privacidade.html",
  "termos.html",
  // Config/manifesto
  "manifest.json",
  "assets/styles.css",
  // Scripts
  "assets/firebase-init.js",
  "assets/firebase-config.js",
  "assets/pwa.js",
  "assets/auth-ui.js",
  "assets/api-client.js",
  "assets/engine.js",
  "assets/storage.js",
  "assets/ocr.js",
  "assets/material-limits.js",
  "assets/module-drafts.js",
  "assets/onboarding-wizard.js",
  // Ícones
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        SHELL_FILES.map((path) =>
          fetch(path)
            .then((res) => {
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              return cache.put(path, res);
            })
            .catch((e) => {
              console.error(`SW: falha ao pré-cachear "${path}" (seguindo com os demais):`, e.message);
            })
        )
      )
    )
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

  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});