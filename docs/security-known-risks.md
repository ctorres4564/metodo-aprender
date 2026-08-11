# Riscos de segurança conhecidos

## Dependências transitivas do Firebase Admin

Data da última verificação: 10/08/2026

Resultado do npm audit:
- 7 vulnerabilidades moderadas de produção, nenhuma alta ou crítica
- causas transitivas remanescentes: `uuid`, `retry-request`/`teeny-request`
  via Firebase Storage e `@opentelemetry/core` via Sentry
- advisory: GHSA-w5hq-g745-h8pq
- cadeia afetada: firebase-admin → google-gax / gaxios / teeny-request / retry-request / @google-cloud/firestore / @google-cloud/storage → uuid
- `firebase-admin` foi atualizado de 12.7.0 para 14.2.0
- a migração passou nos testes unitários e nos testes com emuladores de Auth,
  Firestore e Storage
- os alertas restantes não possuem atualização transitiva segura publicada na
  árvore atual; não foram usados `overrides` incompatíveis
- ação futura: atualizar Firebase Admin, Google Cloud Storage e Sentry assim que
  versões corrigidas forem publicadas e repetir `npm audit --omit=dev`

## Controles compensatórios atuais

- APIs Firebase Admin usadas apenas no servidor
- autenticação por token Firebase verificado
- regras Firestore e Storage aplicadas no cliente
- isolamento por uid
- ausência de uso direto das APIs vulneráveis de uuid no código da aplicação
- package-lock.json versionado
- npm audit executado localmente
