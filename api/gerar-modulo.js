/* =====================================================================
   FUNÇÃO SERVERLESS (Vercel) — gera sugestões de conceitos (fichas de
   estudo) a partir de um texto-fonte (capítulo de livro, artigo etc.),
   usando um modelo de linguagem via OpenRouter.
   =====================================================================
   Recebe: { title, sourceText, annotations? }
   Retorna: { resumo, concepts: [{ tag, title, text, q, options[4], correct, page }] }

   "annotations" (Etapa 4 — anotações como contexto pra IA, opcional):
   lista de destaques/anotações que o(a) usuário(a) já fez nesse trecho do
   livro, no leitor de PDF (ver importar-livro.html, que monta essa lista a
   partir de window.AppDB.listHighlights/listNotes filtrando pela faixa de
   páginas da seção sendo gerada). Quando presente, o modelo é instruído a
   dar atenção especial a esses pontos — não pra copiá-los, mas pra
   aumentar a chance de que o que a pessoa já achou importante vire uma
   ficha de estudo. Cada item: { page, kind: "destaque"|"anotação", text }.

   "page" (Etapa 2 — referência de origem por conceito): quando sourceText
   contém marcadores "[[PAGINA:N]]" (inseridos por importar-livro.html nas
   quebras de página do trecho enviado), o modelo é instruído a informar em
   qual página cada conceito se baseia. Sem marcadores no texto (ex.: fluxo
   de criar-modulo.html, que não tem paginação), "page" vem null e o
   cliente simplesmente não mostra o link "voltar ao trecho original".

   Importante: o texto retornado por "text" deve ser uma explicação em
   linguagem própria/paraseada do conceito — não uma cópia literal do
   texto-fonte — para não incentivar plágio de material com direitos
   autorais. O prompt abaixo instrui isso explicitamente.

   Variáveis de ambiente: mesmas usadas por api/avaliar-explicacao.js
   (OPENROUTER_API_KEY obrigatória, OPENROUTER_MODEL opcional).
   ===================================================================== */

import { verifyUserFromRequest, checkAndConsumeUsage } from "./_lib/usage.js";
import { extractJson } from "./_lib/parseJson.js";

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const MAX_SOURCE_CHARS = 14000;
const MAX_CONCEPTS = 20;
const MAX_ANNOTATIONS = 40;
const MAX_ANNOTATION_CHARS = 300;

// Monta o bloco de contexto com os destaques/anotações do(a) usuário(a),
// já limpo e limitado. Retorna "" quando não há nada válido — nesse caso
// o prompt final fica idêntico ao que era antes desta funcionalidade
// existir (não muda o comportamento pra quem nunca destaca/anota nada).
function buildAnnotationsBlock(annotations) {
  if (!Array.isArray(annotations) || annotations.length === 0) return "";
  const cleaned = annotations
    .filter(a => a && typeof a.text === "string" && a.text.trim())
    .slice(0, MAX_ANNOTATIONS)
    .map(a => {
      const kind = a.kind === "anotação" ? "anotação" : "destaque";
      const page = (typeof a.page === "number" && Number.isFinite(a.page) && a.page > 0) ? Math.round(a.page) : null;
      // Aspas internas viram aspas simples só pra não quebrar visualmente o
      // formato "- [...] "texto"" do prompt (o texto já vem sem quebras de
      // linha, então isso não abre brecha pra sair do formato de lista).
      const text = a.text.trim().replace(/\s+/g, " ").replace(/"/g, "'").slice(0, MAX_ANNOTATION_CHARS);
      return `- [${page ? "pág. " + page + ", " : ""}${kind}] "${text}"`;
    });
  if (cleaned.length === 0) return "";
  return `\n\nTrechos que o(a) usuário(a) já destacou ou anotou neste material (dê atenção especial a esses pontos: é provável que sejam os que mais importam pra ele(a) — procure garantir que os conceitos gerados cubram essas ideias, mas sempre com "text" em linguagem própria, nunca copiando este texto literalmente):\n${cleaned.join("\n")}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  const user = await verifyUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Sessão expirada ou inválida. Faça login novamente e tente de novo." });
    return;
  }

  const { title, sourceText, annotations } = req.body || {};

  if (!sourceText || typeof sourceText !== "string" || sourceText.trim().length < 200) {
    res.status(400).json({ error: "Texto muito curto para gerar conceitos. Envie um trecho mais completo." });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "OPENROUTER_API_KEY não configurada no servidor." });
    return;
  }

  const usage = await checkAndConsumeUsage(user);
  if (!usage.allowed) {
    if (usage.reason === "email_not_verified") {
      res.status(403).json({
        error: "Confirme seu e-mail antes de gerar conteúdo com IA. Reenvie o e-mail de verificação na tela inicial se não o recebeu.",
        code: "email_not_verified"
      });
    } else {
      res.status(429).json({
        error: `Limite mensal de gerações por IA atingido (${usage.current}/${usage.limit} no plano ${usage.plan}). O limite é renovado no início do próximo mês.`
      });
    }
    return;
  }

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const trimmedSource = sourceText.slice(0, MAX_SOURCE_CHARS);
  const annotationsBlock = buildAnnotationsBlock(annotations);

  const systemPrompt = `Você ajuda a criar módulos de estudo com repetição espaçada a partir de um texto-fonte (capítulo de livro, artigo, apostila etc.) fornecido por um(a) usuário(a).

Sua tarefa tem duas partes:

PARTE 1 — "resumo": escreva um resumo mais completo, em português, com SUAS PRÓPRIAS PALAVRAS, em duas partes dentro do mesmo texto:
   a) Um parágrafo de introdução (3 a 5 frases) apresentando do que trata esse trecho, como a introdução de um bom professor antes de começar a aula.
   b) Uma lista dos principais tópicos/conceitos que serão estudados neste módulo — de 5 a 10 itens, cada um em uma linha própria começando com "• " (marcador + espaço), com uma frase curta por item (não precisa ser cada conceito exato das fichas, pode agrupar temas relacionados).
   Formate como texto simples, com o parágrafo de introdução primeiro, uma linha em branco, e depois a lista de tópicos (uma linha por item, cada linha começando com "• "). Não copie frases do texto-fonte.

PARTE 2 — "concepts": leia o texto-fonte e extraia os conceitos mais importantes e independentes entre si (ideias que fazem sentido sozinhas, sem depender de outra ficha para serem entendidas). Gere no máximo ${MAX_CONCEPTS} conceitos, priorizando qualidade e cobertura das ideias centrais em vez de quantidade.

Regras OBRIGATÓRIAS para cada conceito:
1. "title": um título curto (até ~8 palavras) que identifica o conceito.
2. "tag": uma categoria/etiqueta curta (1-3 palavras) para agrupar conceitos relacionados.
3. "text": uma explicação de 2 a 4 frases, em português, escrita com SUAS PRÓPRIAS PALAVRAS — nunca copie frases inteiras do texto-fonte. Parafraseie e simplifique como um bom professor explicaria, em linguagem clara e direta. Isso é importante por direitos autorais: o texto gerado deve ser uma síntese original, não uma cópia.
4. "q": uma pergunta de múltipla escolha simples que testa se a pessoa entendeu o conceito.
5. "options": exatamente 4 alternativas de resposta. Elas precisam ser difíceis de adivinhar por eliminação, mesmo por quem nunca leu o texto-fonte — esse é um erro comum a evitar. Siga estas regras ao criar as 3 alternativas erradas:
   - Devem ser sobre o MESMO assunto/categoria da resposta certa, nunca de um assunto claramente diferente (ex: se a pergunta é sobre um mecanismo biológico, as 4 opções devem ser mecanismos biológicos plausíveis do mesmo domínio, não uma mistura de coisas aleatórias).
   - Devem ter aproximadamente o mesmo tamanho e nível de detalhe da resposta certa — nunca deixe a opção correta visivelmente mais longa, mais específica ou mais "bem escrita" que as outras (isso entrega a resposta).
   - Prefira usar confusões plausíveis e reais sobre o tema: um conceito parecido mas diferente, uma troca de causa por efeito, uma definição parcialmente certa mas incompleta ou distorcida, um equívoco comum que alguém sem entender bem o assunto cometeria.
   - Evite palavras absolutas nas opções erradas (“sempre”, “nunca”, “todos”, “nenhum”, “impossível”) — isso costuma denunciar que a alternativa está errada.
   - Evite opções vagas, incompletas ou obviamente sem sentido — todas as 4 devem soar como respostas razoáveis para quem não domina o assunto.
6. "correct": o índice (0 a 3) da alternativa correta em "options". Varie a posição da resposta certa entre os conceitos gerados (não deixe sempre no índice 0).
7. "page": SOMENTE se o texto-fonte contiver marcadores no formato "[[PAGINA:N]]" (um número inteiro após os dois-pontos): informe o número da página onde está o trecho que originou esse conceito — use o marcador "[[PAGINA:N]]" mais próximo ANTES do trecho usado. Se o texto-fonte não tiver nenhum marcador "[[PAGINA:N]]", omita completamente o campo "page" (ou use null).

Se o texto-fonte for muito curto, genérico demais, ou não tiver conteúdo suficiente para extrair conceitos de qualidade, gere quantos conceitos de qualidade forem possíveis (pode ser menos que ${MAX_CONCEPTS}, inclusive 0 se o texto não permitir nenhum). O "resumo" deve ser gerado sempre que houver conteúdo suficiente para isso.

Os marcadores "[[PAGINA:N]]", quando presentes, são apenas metadados de posição — nunca os mencione nem os copie dentro de "resumo", "text", "q" ou "options".

Responda SOMENTE em JSON válido, exatamente neste formato, sem nenhum texto antes ou depois:
{
  "resumo": "...",
  "concepts": [
    { "tag": "...", "title": "...", "text": "...", "q": "...", "options": ["...", "...", "...", "..."], "correct": 0, "page": 12 }
  ]
}`;

  const userPrompt = `Título do módulo (contexto): ${title || "(sem título informado)"}

Texto-fonte:
"""
${trimmedSource}
"""${annotationsBlock}`;

  try {
    const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.APP_URL || "https://metodo-aprender.vercel.app",
        "X-Title": "Metodo Aprender - Gerar Modulo"
      },
      body: JSON.stringify({
        model,
        max_tokens: 9000,
        reasoning: { effort: "low", exclude: true },
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
      res.status(502).json({ error: "Falha ao consultar o gerador de IA." });
      return;
    }

    const data = await orRes.json();
    const rawText = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";

    let parsed;
    try {
      parsed = extractJson(rawText);
    } catch (parseErr) {
      console.error("Falha ao parsear JSON do modelo. Texto bruto:", rawText);
      res.status(502).json({ error: "Resposta do gerador em formato inesperado." });
      return;
    }

    const concepts = Array.isArray(parsed.concepts) ? parsed.concepts : [];

    // Validação/limpeza básica antes de devolver ao cliente
    const cleanConcepts = concepts
      .filter(c => c && c.title && c.text && c.q && Array.isArray(c.options) && c.options.length === 4 && typeof c.correct === "number")
      .slice(0, MAX_CONCEPTS)
      .map(c => ({
        tag: String(c.tag || "Geral").slice(0, 40),
        title: String(c.title).slice(0, 120),
        text: String(c.text).slice(0, 800),
        q: String(c.q).slice(0, 240),
        options: c.options.map(o => String(o).slice(0, 160)),
        correct: Math.min(3, Math.max(0, Math.round(c.correct))),
        page: (typeof c.page === "number" && Number.isFinite(c.page) && c.page > 0) ? Math.round(c.page) : null
      }));

    const resumo = typeof parsed.resumo === "string" ? parsed.resumo.trim().slice(0, 3000) : "";

    res.status(200).json({ resumo, concepts: cleanConcepts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro interno ao gerar conceitos." });
  }
}
