# Estado pedagógico e identidade persistente

## Versões

- `STATE.schemaVersion`: versão do documento de progresso do módulo.
- `STATE.cards[conceptId].pedagogyVersion`: versão do schema pedagógico do conceito.
- Versão atual de ambos: `1`.

As migrações são executadas na leitura, são determinísticas e idempotentes. Campos desconhecidos necessários à compatibilidade legada são preservados. A migração nunca fabrica compreensão, tentativas de recuperação, aplicação ou calibração por conceito.

## Identidade de conceito

Conceitos novos recebem um identificador opaco no formato `c-<uuid/aleatório>`. O ID não depende de título, texto, pergunta, alternativas ou posição.

O ID é mantido em correção ortográfica, reformulação, melhoria de distratores, simplificação, pequena correção editorial e mudança de título sem mudança da unidade cognitiva.

Um ID novo deve ser criado somente por decisão explícita em “Substituir conceito”, ou quando a unidade cognitiva muda: troca do conceito central, divisão, fusão ou substituição completa. A substituição pode registrar `replacesConceptId`, mas não transfere estado pedagógico, FSRS, recuperação, explicação ou aplicação.

## Identidade do módulo (`storageKey`)

`config.storageKey` é a identidade persistente do histórico do módulo. Alterar título, metadados ou conceitos não muda essa chave. Ela nunca deve ser recalculada silenciosamente durante uma edição.

Módulos existentes mantêm a chave atual. Uma mudança futura de `storageKey` exigirá uma migração explícita e versionada; renomear o módulo não constitui migração.

## Limites de histórico

`retrievalAttempts`, `applicationAttempts` e `errorHistory` guardam no máximo os 50 registros mais recentes por conceito. Evidência positiva resumida não é apagada por uma falha posterior.

## Semântica de recuperação

`retrievalAttempts[].intervalDays` registra os dias transcorridos desde a tentativa ou revisão anterior até a tentativa atual. A primeira tentativa pode ter `null`. Esse campo não representa o intervalo futuro agendado pelo FSRS em `card.interval`/`nextReview`.

## Autopercepção de compreensão

`comprehensionStatus` é uma autodeclaração metacognitiva feita na etapa Aprender. `no_issue_detected` significa somente que a pessoa declarou não perceber dificuldade naquele momento. Não constitui evidência comprovada de aprendizagem, recuperação, explicação, aplicação, retenção, domínio ou consolidação e não promove `conceptStatus()`.

## Recuperação construída

Na modalidade “Resposta construída” da aba Revisar, o estímulo aparece sem conteúdo de referência, notas, fontes ou analogias. A pessoa registra confiança antes de escrever e envia sua resposta antes de qualquer reexposição. Somente depois do envio o conteúdo de referência é revelado e a tentativa pode ser classificada como falha (`quality: 1`), parcial (`quality: 3`) ou correta (`quality: 4`).

`responseType` distingue `multiple_choice`, `self_rated_review` e `constructed`. `latencyMs` mede apenas o tempo entre a exibição do estímulo e o envio; é armazenado para análise futura e não certifica aprendizagem.

A força da evidência é explícita: Quiz de múltipla escolha aprovado é `weak`, revisão rápida aprovada é `medium` e somente resposta construída classificada como correta é `strong`, registrando `strongRetrievalPassedAt`. `retrievalPassedAt` continua sendo a evidência ampla compatível com versões anteriores. Resposta parcial ou falha pode alimentar o FSRS e a calibração, mas não cria evidência forte.

## Avaliação semântica por IA da resposta construída

Camada adicional e opcional sobre a resposta construída (não altera nada da seção acima). Depois que a pessoa já se autoavaliou — e FSRS, evidência, calibração e persistência do `attempt` já aconteceram —, o cliente chama `POST /api/avaliar-resposta-construida` (servidor, nunca no navegador; mesma chave `OPENROUTER_API_KEY` e mesmo helper `callOpenRouter` dos demais endpoints de IA) para comparar `responseText` com o texto de referência do conceito.

O servidor devolve `{ classification: "incorrect"|"partial"|"correct", confidence: 0..1, reason }`, validado por schema em `api/_lib/constructedEvaluation.js` (`validateAiEvaluationOutput`) — qualquer saída fora desse formato é tratada como falha, nunca como um valor padrão inventado. O cliente valida de novo defensivamente (`validateConstructedAiEvaluation`) antes de persistir.

O resultado é anexado ao `attempt` já registrado sob a chave `aiEvaluation: { classification, confidence, reason, evaluatedAt }` (`attachAiEvaluationToAttempt`). Registros antigos simplesmente não têm essa chave — não há migração. `aiEvaluation` nunca sobrescreve `passed`, `quality`, `evidenceStrength`, `retrievalPassedAt` ou `strongRetrievalPassedAt`: esses continuam vindo exclusivamente da autoavaliação do usuário, mesmo quando a IA discorda dela.

A chamada é disparada de forma assíncrona e melhor-esforço (`requestConstructedAiEvaluation`), depois que a UI já avançou para o próximo card — nunca é aguardada pelo fluxo de revisão. Timeout, erro do provedor ou saída inválida apenas fazem o `attempt` ficar sem `aiEvaluation`; não impedem revelação, autoavaliação, persistência ou FSRS, que já terminaram antes.

## Explicar (Técnica de Feynman) — histórico por tentativa

Cada tentativa de explicação fica em `STATE.cards[conceptId].explainAttempts[]` (array, limite de 50 registros mais recentes — mesmo limite e mesmo comportamento de `retrievalAttempts`/`applicationAttempts`/`errorHistory`: evidência antiga é aparada, nunca corrompida). Registros antigos (anteriores a esta etapa) não têm esse array; `normalizeCardState()` inicializa `explainAttempts: []` sem tentar reconstruir tentativas passadas a partir de `explainCount`/`lastExplainScore` — não há dado suficiente para isso, e não é migração destrutiva: esses três campos legados continuam existindo e sendo atualizados, por compatibilidade.

Schema de cada `explainAttempt`:

```js
{
  id, at, responseText,
  status: "pending_evaluation" | "evaluated" | "evaluation_failed",
  evaluation: null | {
    score, centralMechanism, mechanismInText,
    coveredPoints, missingPoints, conceptualErrors, imprecisions,
    feedback, quality, pedagogicalDecision,
    followUpQuestion
  },
  evaluatedAt,
  previousAttemptId, attemptNumber,
  followUp: null | { question, responseText, answeredAt }
}
```

Registros escritos antes desta etapa não têm `previousAttemptId`/`attemptNumber`/`followUp`/`evaluation.followUpQuestion` — continuam legíveis normalmente (`findExplainAttempt` não exige esses campos); uma nova tentativa criada a partir de um registro assim liga-se a ele normalmente pelo `id`.

**Invariante mais importante: o `attempt` é criado e persistido (`createExplainAttempt` + `saveState()`) ANTES de qualquer chamada à IA**, com `status: "pending_evaluation"`. Perda de rede, cota esgotada ou fechamento da aba depois desse ponto nunca apaga o texto que a pessoa escreveu — ele já está salvo.

### Falha técnica vs. falha pedagógica (semântica escolhida)

- **Cota esgotada** (`POST /api/avaliar-explicacao` responde `429`): o attempt permanece `pending_evaluation`. Não é uma falha técnica — é "ainda não avaliado". A UI mostra "Sua explicação foi salva e está aguardando avaliação.", nunca um erro genérico, e oferece "tentar avaliar novamente".
- **Falha técnica** (timeout, rede, HTTP não-2xx do provedor, JSON inválido): o attempt vira `evaluation_failed` (`markExplainAttemptFailed`). Semântica escolhida de propósito para distinguir "esperando cota" (retryable sem ação da pessoa) de "algo deu errado tecnicamente" — em ambos os casos `responseText` nunca é apagado e FSRS/`explanationPassedAt`/`lastExplainScore` nunca são tocados.
- Nenhum dos dois casos conta como falha pedagógica do aluno: `evaluation_failed`/`pending_evaluation` nunca criam entrada em `errorHistory` nem afetam `conceptWeakness`/`pickExplainConcept`.

### Avaliação posterior (idempotente)

`evaluateExplainAttempt(concept, cardState, attemptId)` avalia ou REAVALIA um attempt já persistido — nunca cria outro. Chamada tanto no fluxo de submissão inicial quanto no botão "tentar avaliar novamente" (mesma função, mesmo caminho). Se o attempt já estiver `evaluated`, a função sai imediatamente sem chamar a IA de novo e sem reaplicar FSRS/XP/contadores (`applyExplanationEvaluation` também tem essa guarda) — retry sobre uma tentativa já avaliada é sempre um no-op seguro.

### Nova tentativa estruturada

Depois de qualquer avaliação bem-sucedida — `passed`, `retry_recommended` ou `return_to_comprehension`, sem exceção — a UI oferece explicitamente "🔁 Tentar explicar novamente" (não depende de `pickExplainConcept()` trazer o mesmo conceito de volta por acaso). `createExplainAttempt` já liga toda tentativa nova à anterior do mesmo conceito automaticamente:

- `previousAttemptId`: o `id` do attempt imediatamente anterior nesse conceito, ou `null` na primeira tentativa;
- `attemptNumber`: encadeado a partir do `attemptNumber` do attempt anterior (`+1`), não do tamanho do array — continua contando corretamente mesmo depois que o histórico ultrapassa 50 e passa a ser aparado por `trimHistory`.

Isso reconstrói a cadeia completa (`tentativa 1 → tentativa 2 → tentativa 3`) sem um segundo sistema de histórico, caminhando por `explainAttempts[]` a partir do attempt com `previousAttemptId: null`. Não há limite pedagógico de tentativas nesta etapa (só o limite técnico de histórico, 50), nem streak/punição por quantidade.

**Invariante de exposição**: a nova tentativa nunca mostra a resposta de referência do conceito nem uma "explicação-modelo" pronta — o diagnóstico da tentativa anterior (pontos corretos, omissões, imprecisões, erros conceituais, feedback) pode continuar visível, mas nunca substitui o esforço da pessoa em escrever de novo. Na prática, "Tentar explicar novamente" só limpa o campo de texto original e devolve o foco a ele — reaproveita o mesmo fluxo de submissão (`handleExplainSubmit`), então o diagnóstico anterior só desaparece da tela quando a nova avaliação chega, nunca antes.

### Pergunta de aprofundamento (`followUpQuestion`)

Toda avaliação bem-sucedida (`status: "evaluated"`) inclui `evaluation.followUpQuestion` — uma pergunta que exige elaboração sobre o mesmo conceito (nunca múltipla escolha, nunca respondível copiando a referência), calibrada pela decisão pedagógica: se `return_to_comprehension`, a pergunta é simples (só verifica se a pessoa reconhece o problema); se `retry_recommended`, foca na principal lacuna; se `passed`, pode explorar limite/exceção, consequência ou comparação com um conceito próximo. **Não é uma atividade de Aplicar** — é mais estreita, só um aprofundamento sobre o que já foi explicado.

A pergunta é derivada pela IA mas validada em código (`api/_lib/explanationEvaluation.js`, `isValidFollowUpQuestion`): precisa ser uma string de 10 a 300 caracteres e não pode duplicar literalmente o título do conceito. Se a saída do modelo não passar nessa validação, um `buildFallbackFollowUpQuestion(decisaoPedagogica)` determinístico garante que `followUpQuestion` nunca fica vazia — mesma filosofia do teto de nota: nunca confiar cegamente no modelo para uma garantia obrigatória.

A resposta do aluno é opcional e fica em `attempt.followUp: { question, responseText, answeredAt }`, persistida por `recordExplainFollowUpResponse` — sem nenhuma chamada de IA para avaliá-la nesta etapa (objetivo mínimo: gerar, exibir, exigir elaboração, persistir). Idempotente: se `attempt.followUp` já existe, uma nova chamada devolve a resposta já salva sem sobrescrever — reload ou reenvio acidental nunca duplica ou troca a resposta dada.

Attempts `pending_evaluation`/`evaluation_failed` não têm `followUpQuestion` (só existe dentro de `evaluation`, que é `null` nesses estados) — `recordExplainFollowUpResponse` lança erro se chamada sobre eles. Quando reavaliados com sucesso (`pending_evaluation`/`evaluation_failed` → `evaluated`), a pergunta é criada normalmente, como em qualquer avaliação bem-sucedida.

### Relação com FSRS/evidência

`fsrsUpdate(cardState, evaluation.quality)`, `explainCount`, `lastExplainScore` e `explanationPassedAt` (quando `score >= EXPLANATION_PASS_SCORE`) só são tocados **depois** que `evaluation` foi construída com sucesso — nunca antes, e nunca a partir de um attempt `pending_evaluation`/`evaluation_failed`. Assim como antes desta etapa, Explicar não toca em `retrievalPassedAt`, `strongRetrievalPassedAt`, `retrievalEvidenceStrength` nem `calibrationStatus` — esses continuam vindo exclusivamente do fluxo de recuperação (`recordRetrievalEvidence`). `recordExplainFollowUpResponse` (a resposta à pergunta de aprofundamento) não chama nenhuma dessas funções — não atualiza FSRS, não cria/altera `explainCount`/`lastExplainScore`/`explanationPassedAt`, e não toca em nenhum campo de evidência de recuperação ou calibração. Uma nova tentativa de explicação só passa a valer para FSRS/evidência quando ela própria for efetivamente avaliada (`status: "evaluated"`) — criá-la (`createExplainAttempt`) é, como sempre, um passo puramente de persistência.

### Decisão pedagógica (persistida, sem roteamento automático)

`pedagogicalDecision` é derivada em código no servidor (`api/_lib/explanationEvaluation.js`, `derivePedagogicalDecision`), nunca pedida ao modelo: `score >= 70` → `"passed"`; `score < 70` com `conceptualErrors` não vazio → `"return_to_comprehension"`; caso contrário → `"retry_recommended"`. `"pending_evaluation"` nunca é devolvido pelo servidor — é o valor que `deriveExplainAttemptDecision(attempt)` retorna quando o attempt ainda não foi avaliado (leitura derivada, sem duplicar dado). Nesta etapa a decisão é apenas persistida; não existe roteamento automático baseado nela.

### `imprecisions` vs. `conceptualErrors`

Um **erro conceitual** (`conceptualErrors`) é uma afirmação incompatível com o conceito — algo que, se fosse verdade, contradiria como o conceito funciona. Uma **imprecisão** (`imprecisions`) é uma formulação incompleta, pouco precisa ou tecnicamente imperfeita, mas que não invalida o núcleo correto do que a pessoa disse. Os dois campos são sempre listas separadas na avaliação persistida.

### Explicar vs. futura etapa Aplicar

Explicar (Prioridade 3, esta seção) e a futura Aplicar (Prioridade 4, ainda não iniciada) são deliberadamente mantidas separadas:

- Explicar pede para reformular um conceito já visto com as próprias palavras, sem consulta — inclui, nesta etapa, uma nova tentativa estruturada sobre o MESMO conceito e uma pergunta de aprofundamento estreita sobre esse mesmo conceito (não sobre um contexto novo).
- Aplicar pedirá transferência para um contexto novo/prático — fora do escopo desta etapa. A pergunta de aprofundamento de Explicar é explicitamente instruída (no prompt) a NÃO virar uma atividade de transferência: ela é mais estreita, só aprofunda o que já foi explicado.
- Nenhum roteamento automático entre as duas existe ainda: `pedagogicalDecision` é persistida, mas não decide sozinha se a pessoa deveria ir para uma futura etapa Aplicar — isso continua sendo uma decisão de produto em aberto, fora do escopo atual.
