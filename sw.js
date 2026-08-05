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

// V4: v4 -> v5. Bump sempre que SHELL_FILES mudar (como agora) — o
// "activate" abaixo já apaga QUALQUER cache com nome diferente do atual
// (não só "v4" especificamente), então essa troca de nome sozinha garante
// que o cache antigo (com a lista de arquivos desatualizada) some na
// próxima ativação, sem precisar listar versões antigas manualmente aqui.
const CACHE_NAME = "metodo-aprender-shell-v5";

// V4: lista revisada — cada arquivo aqui precisa (a) existir de fato no
// projeto e (b) ser local (same-origin). Nunca incluir PDFs, dados do
// Firestore/Storage ou qualquer coisa cross-origin (SDK do Firebase via
// gstatic, tesseract.js via cdnjs) — isso é dado privado ou de terceiros,
// não faz parte do "shell" do app, e o filtro em "fetch" abaixo já
// impediria esse tipo de coisa de ser cacheada de qualquer forma.
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
  // Scripts — antes desta correção, firebase-init.js e pwa.js (carregados
  // por TODAS as páginas, incluindo index.html/login) e firebase-config.js
  // (importado por firebase-init.js) não estavam na lista: o app não
  // conseguia nem abrir a tela de login offline.
  "assets/firebase-init.js",
  "assets/firebase-config.js",
  "assets/pwa.js",
  "assets/auth-ui.js",
  "assets/api-client.js",
  "assets/engine.js",
  "assets/storage.js",
  "assets/ocr.js",
  "assets/material-limits.js",
  // Ícones — apple-touch-icon.png é referenciado em <link> por várias
  // páginas (ver <head>) e também estava faltando.
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  // V4: cache.addAll() é tudo-ou-nada — se UM arquivo da lista falhar (ex.:
  // renomeado, removido, ou um problema de rede pontual num item opcional),
  // a instalação inteira falhava silenciosamente (o .catch(()=>{}) engolia
  // o erro) e o cache ficava vazio, sem NENHUM arquivo do shell salvo.
  // cache.put() individual por arquivo evita isso: um item que falhar fica
  // só de fora (registrado no console), sem derrubar os outros.
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
