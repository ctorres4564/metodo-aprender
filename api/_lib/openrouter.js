/* =====================================================================
   Helper compartilhado para chamadas à OpenRouter.
   =====================================================================
   Antes desta função, cada endpoint de IA (avaliar-explicacao,
   gerar-analogia, gerar-modulo, localizar-secao, regenerar-conceito)
   duplicava o mesmo trecho de código: montar o fetch, checar orRes.ok,
   ler o JSON, extrair o texto da mensagem e parsear com extractJson.
   Além de duplicado, esse trecho não tinha timeout — uma chamada presa
   na OpenRouter podia travar a função inteira até o limite de execução
   da Vercel estourar, sem nunca responder ao cliente.

   callOpenRouter() centraliza isso: monta a requisição, aplica um
   timeout via AbortController, e devolve o JSON já parseado do "content"
   da resposta. Cada endpoint continua responsável pelo próprio prompt
   (systemPrompt/userPrompt) e pela validação/sanitização do formato de
   resposta — isso NÃO muda aqui, de propósito (formatos diferentes por
   endpoint, ver comentário de escopo em cada arquivo).

   Em qualquer falha (timeout, rede, HTTP não-2xx, JSON inválido), lança
   um Error com ".code" definido ("timeout" | "network" | "http" | "parse")
   para o chamador decidir o status HTTP certo e, principalmente, estornar
   a cota de IA já consumida (ver refundUsage em ./usage.js) — antes desta
   correção (A1-03), qualquer uma dessas falhas consumia 1 geração do
   limite mensal da pessoa sem entregar nada em troca.
   ===================================================================== */
import { extractJson } from "./parseJson.js";

// Margem abaixo do limite de execução de uma função serverless da Vercel
// (60s no plano Hobby) — garante que sempre sobra tempo para a função
// responder ao cliente antes de a própria Vercel matar a execução.
const OPENROUTER_TIMEOUT_MS = 50000;

// Normaliza qualquer erro lançado durante a operação (fetch OU leitura do
// corpo): AbortError vira "timeout" em qualquer fase; erros que já têm
// ".code" (http/parse, definidos abaixo) passam intactos; o resto é rede.
function normalizeOpenRouterError(e) {
  if (e && e.code) return e;
  if (e && e.name === "AbortError") {
    const err = new Error("Tempo limite ao consultar a IA. Tente novamente.");
    err.code = "timeout";
    return err;
  }
  const err = new Error("Falha de rede ao consultar a IA. Tente novamente.");
  err.code = "network";
  return err;
}

export async function callOpenRouter({ apiKey, model, messages, maxTokens, referer, title }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

  // O timer só é limpo no finally, DEPOIS de fetch + leitura do corpo +
  // parse — antes desta correção (V3-A) o clearTimeout acontecia assim que
  // os headers chegavam, e uma resposta "slow-drip" (corpo pingando bytes
  // sem fechar) pendurava a função até a Vercel matar a execução: sem
  // resposta ao cliente e sem estorno da cota já consumida. Com o signal
  // ativo até o fim, o abort também interrompe orRes.text()/orRes.json().
  try {
    let orRes;
    try {
      orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${apiKey}`,
          // Cabeçalhos recomendados (não obrigatórios) pela OpenRouter para identificar o app:
          "HTTP-Referer": referer || process.env.APP_URL || "https://metodo-aprender.vercel.app",
          "X-Title": title || "Metodo Aprender"
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          reasoning: { effort: "low", exclude: true },
          messages,
          response_format: { type: "json_object" }
        })
      });
    } catch (e) {
      throw normalizeOpenRouterError(e); // timeout | network
    }

    if (!orRes.ok) {
      const errText = await orRes.text().catch(() => "");
      console.error("Erro OpenRouter:", orRes.status, errText);
      const err = new Error("Falha ao consultar a IA.");
      err.code = "http";
      throw err;
    }

    // Leitura do corpo e parse do envelope — ainda sob o timer. Um corpo
    // truncado/inválido aqui cai no catch externo com code "parse" ou
    // "network", e o endpoint estorna a cota como em qualquer outra falha.
    let data;
    try {
      data = await orRes.json();
    } catch (e) {
      if (e && e.name === "AbortError") throw normalizeOpenRouterError(e);
      console.error("Corpo da resposta da OpenRouter inválido ou incompleto:", e.message);
      const err = new Error("Resposta da IA em formato inesperado.");
      err.code = "parse";
      throw err;
    }

    const rawText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";

    try {
      return extractJson(rawText);
    } catch (parseErr) {
      console.error("Falha ao parsear JSON do modelo. Texto bruto:", rawText);
      const err = new Error("Resposta da IA em formato inesperado.");
      err.code = "parse";
      throw err;
    }
  } catch (e) {
    throw normalizeOpenRouterError(e);
  } finally {
    clearTimeout(timer);
  }
}

// Status HTTP padrão pra cada código de erro lançado por callOpenRouter —
// usado pelos endpoints para responder de forma consistente entre si.
export function statusForOpenRouterError(err) {
  if (err && err.code === "timeout") return 504;
  return 502; // network, http, parse
}
