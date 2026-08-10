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

import { requireUsageQuota, refundUsage } from "./_lib/usage.js";
import { callOpenRouter, statusForOpenRouterError } from "./_lib/openrouter.js";
import { withSentry } from "./_lib/sentry.js";

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

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método não permitido." });
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

  // V3-C: ver comentário equivalente em api/avaliar-explicacao.js.
  const uid = await requireUsageQuota(req, res);
  if (!uid) return;

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const trimmedSource = sourceText.slice(0, MAX_SOURCE_CHARS);
  const annotationsBlock = buildAnnotationsBlock(annotations);

  const systemPrompt = `Você ajuda a criar módulos de estudo com repetição espaçada a partir de um texto-fonte (capítulo de livro, artigo, apostila etc.) fornecido por um(a) usuário(a).

Sua tarefa tem duas partes:

PARTE 1 — "resumo": escreva um resumo mais completo, em português, com SUAS PRÓPRIAS PALAVRAS, em duas partes dentro do mesmo texto:
   a) Um parágrafo de introdução (3 a 5 frases) apresentando do que trata esse trecho, como a introdução de um bom professor antes de começar a aula.
   b) Uma lista dos principais tópicos/conceitos que serão estudados neste módulo — de 5 a 10 itens, cada um em uma linha própria começando com "• " (marcador + espaço), com uma frase curta por item (não precisa ser cada conceito exato das fichas, pode agrupar temas relacionados).
   Formate como texto simples, com o parágrafo de introdução primeiro, uma linha em branco, e depois a lista de tópicos (uma linha por item, cada linha começando com "• "). Não copie frases do texto-fonte.
   O resumo deve apresentar a ideia central do trecho, destacar as principais relações entre os temas e indicar as distinções mais importantes quando existirem.

PARTE 2 — "concepts": Leia o texto-fonte e identifique os conceitos mais importantes para compreensão e recuperação ativa. Não gere apenas definições isoladas. Cada conceito deve representar uma unidade de conhecimento útil para estudo e revisão espaçada.
Gere no máximo ${MAX_CONCEPTS} conceitos, priorizando qualidade e cobertura das ideias centrais em vez de quantidade.

Antes de escrever cada conceito, considere internamente:
1. Qual é a ideia central?
2. Como ela funciona?
3. Existe relação de causa e efeito?
4. Com quais outros conceitos ela se relaciona?
5. Existe algum conceito próximo que possa ser confundido com este?
6. Existe algum erro ou confusão comum sobre essa ideia?
7. Um exemplo concreto ajudaria a compreendê-la?
8. Considerando as respostas acima, qual operação cognitiva (entre as categorias abaixo) é a mais apropriada para testar ESTE conceito especificamente? É o conteúdo do conceito que decide a categoria — nunca escolha uma ao acaso.

Categorias de operação cognitiva para a pergunta "q" (escolha UMA por conceito, a que o conteúdo sustentar):
- COMPREENSÃO: identificar o significado, princípio, característica essencial ou relação central do conceito.
- CAUSALIDADE: identificar uma relação de causa e efeito — o que provoca o quê, ou por que algo acontece.
- COMPARAÇÃO: distinguir este conceito de outro próximo, modelo, posição ou situação semelhante.
- APLICAÇÃO: aplicar o conceito a uma situação concreta, exemplo ou cenário.
- INFERÊNCIA: deduzir uma consequência, implicação ou conclusão a partir do conceito.
- ANÁLISE CRÍTICA: identificar um pressuposto, limitação, tensão ou crítica associada ao conceito.
Nem todo conceito sustenta as seis categorias igualmente — um conceito puramente descritivo pode só admitir COMPREENSÃO ou COMPARAÇÃO, por exemplo; não force uma categoria que o conteúdo não sustenta. Ao mesmo tempo, olhando o módulo inteiro, evite concentrar quase todas as perguntas na mesma categoria quando o material permitir variedade — não é uma distribuição exata (não é "20% de cada categoria"), é só evitar repetir sempre o mesmo padrão quando o conteúdo oferece ângulos diferentes.

Use essas relações para melhorar a explicação e a pergunta, mas NÃO crie novos campos no JSON — a categoria escolhida no passo 8 orienta como "q" é formulada, ela não aparece em nenhum campo da saída.

Regras OBRIGATÓRIAS para cada conceito:
1. "title": um título curto e específico (até aproximadamente 8 palavras), que identifica o conceito sem ser genérico.
2. "tag": uma categoria/etiqueta curta (1-3 palavras) para agrupar conceitos relacionados.
3. "text": uma explicação de 2 a 4 frases, em português, escrita com SUAS PRÓPRIAS PALAVRAS — nunca copie frases inteiras do texto-fonte. Explique a ideia central, e quando relevante, explique mecanismo, causa, consequência ou relação com outro conceito. Quando útil, inclua um exemplo curto. Quando houver risco de confusão, deixe clara a diferença entre conceitos próximos. Não transforme o texto em lista. Evite explicações genéricas que apenas repetem o título.
4. "q": uma pergunta de múltipla escolha que testa a operação cognitiva escolhida no passo 8 (COMPREENSÃO, CAUSALIDADE, COMPARAÇÃO, APLICAÇÃO, INFERÊNCIA ou ANÁLISE CRÍTICA). Não escreva perguntas que simplesmente peçam a definição do conceito ou repitam uma afirmação explícita do campo "text". A resposta correta não deve ser uma reprodução quase literal de uma frase do "text". A pergunta deve exigir compreensão do conceito, mas continuar respondível usando apenas o conteúdo da ficha. Evite aumentar desnecessariamente a dificuldade linguística da pergunta.
5. "options": exatamente 4 alternativas de resposta. Elas precisam ser difíceis de adivinhar por eliminação, mesmo por quem nunca leu o texto-fonte. Siga estas regras ao criar as 3 alternativas erradas:
   - Devem ser sobre o MESMO assunto/categoria da resposta certa, nunca de um assunto claramente diferente.
   - Devem ser plausíveis para alguém que compreendeu o tema apenas parcialmente.
   - Evite distratores obviamente falsos, absurdos ou extremos.
   - Evite pistas linguísticas como “sempre”, “nunca”, “completamente”, “exclusivamente”, salvo quando realmente necessárias pelo conteúdo.
   - Prefira distratores que representem confusão entre conceitos próximos, inversão de causa e efeito, aplicação incorreta de um princípio correto, conclusão parcialmente correta mas conceitualmente inadequada, ou diferença sutil relevante para o conteúdo.
   - Devem ter aproximadamente o mesmo tamanho, estrutura gramatical e nível de especificidade da resposta certa — nunca deixe a opção correta visivelmente mais longa, mais específica ou mais "bem escrita" que as outras (isso entrega a resposta).
   - A resposta correta não deve se destacar por repetir palavras ou expressões exclusivas usadas na explicação.
   - Evite opções vagas, incompletas ou obviamente sem sentido — todas as 4 devem soar como respostas razoáveis para quem não domina o assunto.
6. "correct": o índice (0 a 3) da alternativa correta em "options". Varie a posição da resposta certa entre os conceitos gerados (não deixe sempre no índice 0).
7. "page": SOMENTE se o texto-fonte contiver marcadores no formato "[[PAGINA:N]]" (um número inteiro após os dois-pontos): informe o número da página onde está o trecho que originou esse conceito — use o marcador "[[PAGINA:N]]" mais próximo ANTES do trecho usado. Se o texto-fonte não tiver nenhum marcador "[[PAGINA:N]]", omita completamente o campo "page" (ou use null).

Se o texto-fonte for muito curto, genérico demais, ou não tiver conteúdo suficiente para extrair conceitos de qualidade, gere quantos conceitos de qualidade forem possíveis (pode ser menos que ${MAX_CONCEPTS}, inclusive 0 se o texto não permitir nenhum). O "resumo" deve ser gerado sempre que houver conteúdo suficiente para isso.

Critérios gerais:
- priorize qualidade em vez de quantidade
- evite conceitos repetidos ou quase equivalentes
- mantenha cada ficha suficientemente independente para revisão espaçada
- preserve relações importantes entre os conceitos
- prefira explicações conceituais a detalhes periféricos
- se o texto apresentar uma sequência causal ou um processo, preserve essa lógica
- se houver distinções importantes, distribua-as entre as fichas
- não invente informação que não esteja sustentada pelo texto-fonte
- mantenha os textos curtos o suficiente para a interface atual

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
    const parsed = await callOpenRouter({
      apiKey,
      model,
      maxTokens: 9000,
      title: "Metodo Aprender - Gerar Modulo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    });

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
    await refundUsage(uid);
    if (e && e.code) {
      res.status(statusForOpenRouterError(e)).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Erro interno ao gerar conceitos." });
  }
}

export default withSentry(handler);
