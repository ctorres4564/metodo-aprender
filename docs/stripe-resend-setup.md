# Guia de Configuração de Produção (Stripe e Resend)

Este guia orienta o administrador nos passos necessários para migrar as integrações da Stripe e Resend do modo de teste para o ambiente de produção real (Live Mode).

---

## 1. Stripe (Pagamento Real)

### Passo 1: Obter as Credenciais de Produção (Live Keys)
1. Acesse o [Dashboard da Stripe](https://dashboard.stripe.com/).
2. Desative o modo de teste (Test Mode) no topo da página.
3. Vá em **Desenvolvedores (Developers) → Chaves de API (API Keys)**.
4. Copie a chave secreta de produção (`sk_live_...`).
5. Configure essa chave na variável de ambiente `STRIPE_SECRET_KEY` no painel da Vercel.

### Passo 2: Criar o Webhook de Produção
1. No Dashboard da Stripe (em modo Live), vá em **Desenvolvedores → Webhooks**.
2. Clique em **Adicionar endpoint (Add endpoint)**.
3. Configure a **URL do endpoint** para:
   `https://metodoaprender.com/api/stripe-webhook`
4. Selecione os seguintes eventos para monitoramento:
   *   `checkout.session.completed`
   *   `customer.subscription.created`
   *   `customer.subscription.updated`
   *   `customer.subscription.deleted`
5. Clique em **Adicionar endpoint**.
6. Revele o segredo de assinatura do webhook (`whsec_...`) e configure-o na variável de ambiente `STRIPE_WEBHOOK_SECRET` no painel da Vercel.

### Passo 3: Configurar o ID do Preço do Plano Premium
1. Crie o produto de assinatura (plano mensal) no menu **Produtos** da Stripe.
2. Copie o **Price ID** gerado (formato `price_...`).
3. Configure esse ID na variável de ambiente `STRIPE_PRICE_ID` da Vercel.

---

## 2. Resend (Envio de E-mails de Produção)

Para que os lembretes diários cheguem a todos os usuários cadastrados (e não fiquem restritos ao modo sandbox), você precisa autenticar o domínio próprio na Resend.

### Passo 1: Cadastrar o Domínio
1. Acesse o painel da [Resend](https://resend.com/).
2. Vá em **Domains** e clique em **Add Domain**.
3. Insira `metodoaprender.com` e selecione a região (ex: `us-east-1`).
4. Clique em **Add**.

### Passo 2: Configurar Registros DNS
A Resend gerará chaves DNS do tipo **TXT** e **MX** para autenticação SPF, DKIM e DMARC.
1. Acesse o local onde o domínio `metodoaprender.com` está registrado (ex: Registro.br, Cloudflare, Hostgator).
2. Adicione os registros DNS copiando exatamente os valores fornecidos pela Resend.
3. Aguarde a propagação do DNS (geralmente leva de 5 minutos a algumas horas) e clique em **Verify** no painel da Resend.

### Passo 3: Configurar as Variáveis de Ambiente na Vercel
Uma vez que o domínio esteja verificado, você pode usar um e-mail personalizado como remetente:
1. Defina a variável `REMINDER_FROM_EMAIL` na Vercel com um e-mail do seu domínio (ex: `estudar@metodoaprender.com` ou `lembretes@metodoaprender.com`).
2. Se você alterou o domínio, certifique-se de configurar `APP_URL` na Vercel para `https://metodoaprender.com` para que os links dentro do e-mail redirecionem para o lugar correto.
