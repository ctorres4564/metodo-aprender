# Riscos de segurança conhecidos

## Dependências transitivas do Firebase Admin

Data da verificação: 05/08/2026

Resultado do npm audit:
- 8 vulnerabilidades moderadas
- causa raiz: uuid < 11.1.1
- advisory: GHSA-w5hq-g745-h8pq
- cadeia afetada: firebase-admin → google-gax / gaxios / teeny-request / retry-request / @google-cloud/firestore / @google-cloud/storage → uuid
- correção automática sugerida pelo npm: firebase-admin@14.2.0
- essa correção exige atualização de major com breaking changes
- decisão atual: manter firebase-admin 12.7.0 temporariamente
- justificativa: vulnerabilidades transitivas moderadas, sem evidência de exploração direta no fluxo atual, e upgrade exige migração controlada para Node 22 + testes de Auth, Firestore, Storage, webhook Stripe e exclusão de conta
- ação futura: reavaliar a migração para firebase-admin 14.x em branch separada e ambiente de preview/staging

## Controles compensatórios atuais

- APIs Firebase Admin usadas apenas no servidor
- autenticação por token Firebase verificado
- regras Firestore e Storage aplicadas no cliente
- isolamento por uid
- ausência de uso direto das APIs vulneráveis de uuid no código da aplicação
- package-lock.json versionado
- npm audit executado localmente
