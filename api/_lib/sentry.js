/* =====================================================================
   Sentry (monitoramento de erros em produção) — recomendado, não
   bloqueante, na checklist de monetização. Inativo por padrão: sem
   SENTRY_DSN configurada, nada aqui faz qualquer chamada de rede (nem
   inicializa o SDK), então não muda nenhum comportamento existente.
   =====================================================================
   Cobertura: em vez de instrumentar cada bloco try/catch das 11 funções
   serverless individualmente, interceptamos console.error uma única vez
   — é o padrão já usado em todo erro tratado do projeto (ver os
   catch(e) de api/*.js) — então capturamos tudo que já é logado hoje,
   sem tocar em nenhuma outra função. withSentry() cobre, além disso,
   qualquer exceção que escape de todo try/catch (um bug realmente
   inesperado, que hoje só apareceria como 500 genérico no log da Vercel).
   ===================================================================== */
import * as Sentry from "@sentry/node";

let initialized = false;

function dsn() {
  return process.env.SENTRY_DSN || null;
}

// SEGURANÇA/PRIVACIDADE (SEC-09): o Sentry recebe tudo que é logado via
// console.error — e vários erros do projeto embutem conteúdo do usuário
// na mensagem (ex.: "Texto bruto: ..." em api/_lib/openrouter.js, ou o
// corpo da resposta do Resend em api/enviar-lembretes.js). Sem scrubbing,
// configurar um SENTRY_DSN faria esse conteúdo vazar pra telemetria.
// O beforeSend abaixo aplica, em todo evento, passes de limpeza
// best-effort (nunca lança, nunca derruba o envio):
//   1. redige segredos (tokens de autorização, chaves de API da Stripe);
//   2. redige e-mails (PII);
//   3. trunca strings longas (limita a quantidade de conteúdo embarcado).
const SCRUB_PATTERNS = [
  { re: /Bearer\s+[A-Za-z0-9._-]{20,}/gi, repl: "Bearer [REDACTED]" },
  { re: /sk_(?:live|test)_[A-Za-z0-9]+/gi, repl: "sk_[REDACTED]" },
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi, repl: "[EMAIL REDACTED]" }
];
const MAX_EVENT_STRING = 2000;

function scrubString(v) {
  if (typeof v !== "string") return v;
  let out = v;
  for (const { re, repl } of SCRUB_PATTERNS) out = out.replace(re, repl);
  if (out.length > MAX_EVENT_STRING) {
    out = out.slice(0, MAX_EVENT_STRING) + "… [TRUNCADO]";
  }
  return out;
}

function scrubEvent(event) {
  if (!event) return event;
  try {
    if (event.message) event.message = scrubString(event.message);

    const exc = event.exception && event.exception.values;
    if (Array.isArray(exc)) {
      for (const v of exc) {
        if (v && typeof v.value === "string") v.value = scrubString(v.value);
      }
    }

    if (event.extra) {
      for (const k of Object.keys(event.extra)) {
        event.extra[k] = scrubString(event.extra[k]);
      }
    }

    if (event.request) {
      if (event.request.headers) {
        if (event.request.headers.authorization) event.request.headers.authorization = "Bearer [REDACTED]";
        if (event.request.headers.Authorization) event.request.headers.Authorization = "Bearer [REDACTED]";
        if (event.request.headers["x-api-key"]) event.request.headers["x-api-key"] = "[REDACTED]";
        if (event.request.headers["X-API-Key"]) event.request.headers["X-API-Key"] = "[REDACTED]";
      }
      if (typeof event.request.data === "string") event.request.data = scrubString(event.request.data);
    }

    if (Array.isArray(event.breadcrumbs)) {
      for (const b of event.breadcrumbs) {
        if (b && typeof b.message === "string") b.message = scrubString(b.message);
      }
    }
  } catch (_) {
    // Nunca impedir o envio por causa do próprio scrub — melhor um evento
    // sem scrubbing do que um crash aqui dentro (o Sentry já roda em
    // caminho best-effort, ver withSentry).
  }
  return event;
}

export function initSentry() {
  if (initialized) return;
  initialized = true;

  const SENTRY_DSN = dsn();
  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.VERCEL_ENV || "development",
    tracesSampleRate: 0,
    beforeSend: scrubEvent
  });

  const originalConsoleError = console.error.bind(console);
  console.error = (...args) => {
    // O console.error original roda sempre, incondicionalmente, ANTES de
    // qualquer tentativa de falar com o Sentry — log continua funcionando
    // mesmo que tudo abaixo falhe.
    originalConsoleError(...args);
    // Tudo daqui pra baixo é telemetria best-effort: um erro aqui (ex.:
    // JSON.stringify de um objeto circular, ou o próprio SDK do Sentry
    // lançando) nunca pode escapar de dentro de um console.error — isso
    // transformaria um log de erro TRATADO em uma exceção NÃO tratada,
    // o oposto do que este módulo existe para evitar.
    try {
      const err = args.find((a) => a instanceof Error);
      if (err) {
        Sentry.captureException(err);
      } else {
        const message = args
          .map((a) => {
            if (typeof a === "string") return a;
            try {
              return JSON.stringify(a);
            } catch {
              return String(a);
            }
          })
          .join(" ");
        Sentry.captureMessage(message, "error");
      }
    } catch {
      // Engolido de propósito — ver comentário acima.
    }
  };
}

// Envolve o handler exportado por cada função serverless. Funções
// serverless podem ser congeladas logo após a resposta ser enviada — por
// isso o flush roda sempre no finally (não só quando algo é relançado),
// garantindo que eventos capturados via console.error (caminho normal de
// erro tratado, que não relança) também sejam enviados antes do fim da
// invocação.
export function withSentry(handler) {
  return async function wrapped(req, res) {
    initSentry();
    try {
      return await handler(req, res);
    } catch (e) {
      if (dsn()) Sentry.captureException(e);
      throw e;
    } finally {
      if (dsn()) await Sentry.flush(2000).catch(() => {});
    }
  };
}
