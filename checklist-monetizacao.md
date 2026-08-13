# Checklist — Antes de Monetizar

*Baseado no relatório de status de 04/08/2026 (`relatorio-status-metodo-aprender.md`)*

## Bloqueadores — não abrir para pagamento sem isso

- [x] Política de Privacidade publicada ([privacidade.html](privacidade.html), link visível no rodapé de `index.html` e em `conta.html`)
- [x] Termos de Uso publicados ([termos.html](termos.html), mesmo link visível)
- [x] Fluxo de "excluir minha conta" (`api/account.js` — apaga Firestore/Storage/Auth do uid, coberto por testes do Firebase Emulator)
- [x] Verificação de e-mail no cadastro — servidor recusa gerações de IA para quem não confirmou (`api/_lib/usage.js`), com banner de aviso/reenvio na UI (`assets/auth-ui.js`)
- [x] Limite de armazenamento/nº de materiais diferenciado por plano (`api/material.js`, `MATERIAL_LIMITS.maxMaterialsPerPlan`)

## Antes da primeira cobrança real

- [ ] Trocar `STRIPE_SECRET_KEY` de `sk_test_...` para `sk_live_...`
- [ ] Criar webhook de produção na Stripe (URL de produção, eventos: checkout/subscription created/updated/deleted) e configurar `STRIPE_WEBHOOK_SECRET` de produção
- [x] Domínio próprio (em vez de `*.vercel.app`)
- [ ] Verificar domínio na Resend (hoje os lembretes só chegam à própria caixa da conta Resend, modo sandbox)
- [x] Canal de suporte visível no app (e-mail de contato mínimo)

## Recomendado, não bloqueante

- [x] Monitoramento de erros em produção — Sentry (`api/_lib/sentry.js`, opcional/inativo sem `SENTRY_DSN`; falta só criar a conta e configurar a variável, ver README)
- [ ] Validar/redefinir a diferenciação entre planos free e premium (hoje só muda a quantidade de gerações de IA) — decisão de produto
- [x] Corrigir bug de grupo de rádio em `criar-modulo.html` (remover conceito do meio da lista podia afetar o card errado)
- [x] Testes automatizados básicos — Vitest (unit), Firebase Emulator (regras Firestore/Storage, concorrência real, Stripe webhook, exclusão de conta, checkout), FSRS/parsing de IA e Playwright (E2E), com CI no GitHub Actions
- [ ] Revisar os limites mensais de IA (40 free / 400 premium) com dados reais de uso, depois dos primeiros usuários pagantes
