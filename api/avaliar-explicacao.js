/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — avalia a explicação do(a) estudante
   usando a Técnica de Feynman.
   =====================================================================
   Recebe: { title, referenceText, studentText }
   Chama a API da OpenRouter (formato compatível com OpenAI) com uma
   chave secreta guardada apenas no servidor (variável de ambiente
   OPENROUTER_API_KEY na Vercel — nunca fica exposta no navegador).
   Retorna: { nota, pontosCobertos, pontosFaltando, equivocos, feedback, qualidadeSM2 }

   Variáveis de ambiente:
   - OPENROUTER_API_KEY (obrigatória) — gerada em openrouter.ai/keys
   - OPENROUTER_MODEL (opcional) — slug do modelo no formato "provedor/modelo"
     (ver lista completa em openrouter.ai/models). Se não definida, usa
     um modelo padrão razoável para esta tarefa.
   ===================================================================== */

const DEFAULT_MODEL = "openai/gpt-4o-mini";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const { title, referenceText, studentText } = req.body || {};

  if (!studentText || typeof studentText !== "string" || studentText.trim().length < 20) {
    res.status(400).json({ error: "Escreva uma explicação mais completa antes de avaliar." });
    return;
  }
  if (!referenceText || !title) {
    res.status(400).json({ error: "Requisição incompleta." });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENROUTER_API_KEY não configurada no servidor." });
    return;
  }
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const systemPrompt = `Você é um tutor que aplica a Técnica de Feynman: avalia se um(a) estudante conseguiu explicar um conceito com as próprias palavras, de forma clara e simples, como se estivesse ensinando alguém que não conhece o assunto.

Compare a explicação do(a) estudante com a explicação de referência fornecida. Avalie:
- Se as ideias centrais do conceito foram cobertas (mesmo com palavras diferentes da referência)
- Se há erros conceituais ou confusões
- Se a explicação está em linguagem simples e própria, e não apenas copiando frases da referência

Seja encorajador(a) mas honesto(a): se a explicação for fraca, diga isso claramente, com gentileza.

IMPORTANTE sobre o campo "equivocos": inclua APENAS erros que estejam claramente escritos no texto do(a)
estudante — nunca invente, presuma ou infira um equívoco que a pessoa não escreveu explicitamente. Se você
não tiver certeza absoluta de que algo é um erro real presente no texto, não o inclua. Na dúvida, prefira
uma lista vazia a apontar um equívoco questionável — um erro falso apontado é pior do que nenhum apontado.

Antes de incluir qualquer item em "equivocos", faça este teste: você consegue citar a frase exata do(a)
estudante que contém o erro? Se não conseguir apontar uma frase específica escrita por ele(a) que esteja
factualmente errada, NÃO inclua esse item — mesmo que pareça uma lacuna ou uma suposição razoável. Omissão
(algo que a pessoa não mencionou) não é equívoco; equívoco é algo que ela escreveu e que está errado.

Responda SOMENTE em JSON válido, exatamente neste formato, sem nenhum texto antes ou depois:
{
  "nota": <número inteiro de 0 a 100>,
  "pontosCobertos": ["...", "..."],
  "pontosFaltando": ["...", "..."],
  "equivocos": ["apenas erros claramente presentes no texto do(a) estudante; [] se nenhum"],
  "feedback": "parágrafo curto (2-3 frases), direto e encorajador, em português",
  "qualidadeSM2": <1, 3, 4 ou 5 — 1 se muito incompleta/incorreta, 3 se cobre parte com lacunas relevantes, 4 se boa e cobre o essencial, 5 se excelente e completa>
}`;

  const userPrompt = `Conceito: ${title}

Explicação de referência (o que o material ensina):
"""
${referenceText}
"""

Explicação escrita pelo(a) estudante, com as próprias palavras:
"""
${studentText}
"""`;

  try {
    const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
        // Cabeçalhos recomendados (não obrigatórios) pela OpenRouter para identificar o app:
        "HTTP-Referer": process.env.APP_URL || "https://metodo-aprender.vercel.app",
        "X-Title": "Metodo Aprender - Modo Feynman"
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!orRes.ok) {
      const errText = await orRes.text();
      console.error("Erro OpenRouter:", orRes.status, errText);
      res.status(502).json({ error: "Falha ao consultar o avaliador de IA." });
      return;
    }

    const data = await orRes.json();
    const rawText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";

    let parsed;
    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(match ? match[0] : rawText);
    } catch (parseErr) {
      console.error("Falha ao parsear JSON do modelo:", rawText);
      res.status(502).json({ error: "Resposta do avaliador em formato inesperado." });
      return;
    }

    res.status(200).json(parsed);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro interno ao avaliar a explicação." });
  }
}
