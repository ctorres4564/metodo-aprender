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
