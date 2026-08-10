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

export function initSentry() {
  if (initialized) return;
  initialized = true;

  const SENTRY_DSN = dsn();
  if (!SENTRY_DSN) return;

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.VERCEL_ENV || "development",
    tracesSampleRate: 0
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
