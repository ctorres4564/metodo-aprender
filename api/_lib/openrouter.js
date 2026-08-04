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

export async function callOpenRouter({ apiKey, model, messages, maxTokens, referer, title }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

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
    const err = new Error(
      e.name === "AbortError"
        ? "Tempo limite ao consultar a IA. Tente novamente."
        : "Falha de rede ao consultar a IA. Tente novamente."
    );
    err.code = e.name === "AbortError" ? "timeout" : "network";
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!orRes.ok) {
    const errText = await orRes.text().catch(() => "");
    console.error("Erro OpenRouter:", orRes.status, errText);
    const err = new Error("Falha ao consultar a IA.");
    err.code = "http";
    throw err;
  }

  const data = await orRes.json();
  const rawText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";

  try {
    return extractJson(rawText);
  } catch (parseErr) {
    console.error("Falha ao parsear JSON do modelo. Texto bruto:", rawText);
    const err = new Error("Resposta da IA em formato inesperado.");
    err.code = "parse";
    throw err;
  }
}

// Status HTTP padrão pra cada código de erro lançado por callOpenRouter —
// usado pelos endpoints para responder de forma consistente entre si.
export function statusForOpenRouterError(err) {
  if (err && err.code === "timeout") return 504;
  return 502; // network, http, parse
}
