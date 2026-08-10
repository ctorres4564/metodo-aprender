# Checklist — Antes de Monetizar

*Baseado no relatório de status de 04/08/2026 (`relatorio-status-metodo-aprender.md`)*

## Bloqueadores — não abrir para pagamento sem isso

- [ ] Política de Privacidade publicada (página no app + link visível)
- [ ] Termos de Uso publicados (página no app + link visível)
- [ ] Fluxo de "excluir minha conta" (apaga dados do Firestore/Storage do uid — exigência LGPD)
- [ ] Verificação de e-mail no cadastro (`sendEmailVerification`, já nativo no Firebase Auth)
- [ ] Limite de armazenamento/nº de materiais diferenciado por plano (free hoje tem o mesmo limite do premium)

## Antes da primeira cobrança real

- [ ] Trocar `STRIPE_SECRET_KEY` de `sk_test_...` para `sk_live_...`
- [ ] Criar webhook de produção na Stripe (URL de produção, eventos: checkout/subscription created/updated/deleted) e configurar `STRIPE_WEBHOOK_SECRET` de produção
- [ ] Domínio próprio (em vez de `*.vercel.app`)
- [ ] Verificar domínio na Resend (hoje os lembretes só chegam à própria caixa da conta Resend, modo sandbox)
- [ ] Canal de suporte visível no app (e-mail de contato mínimo)

## Recomendado, não bloqueante

- [ ] Monitoramento de erros em produção (Sentry ou equivalente)
- [ ] Validar/redefinir a diferenciação entre planos free e premium (hoje só muda a quantidade de gerações de IA) — decisão de produto
- [ ] Corrigir bug de grupo de rádio em `criar-modulo.html` (remover conceito do meio da lista pode afetar o card errado)
- [x] Testes automatizados básicos — Vitest (unit), Firebase Emulator (regras Firestore/Storage, concorrência real, Stripe webhook, exclusão de conta, checkout), FSRS/parsing de IA e Playwright (E2E), com CI no GitHub Actions
- [ ] Revisar os limites mensais de IA (40 free / 400 premium) com dados reais de uso, depois dos primeiros usuários pagantes
