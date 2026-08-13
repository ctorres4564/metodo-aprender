# Canal de Suporte e Feedback

Esta documentação descreve a arquitetura, o fluxo de dados e os aspectos de manutenção da interface de suporte do Método Aprender.

## 1. Arquitetura

O sistema de suporte consiste em um formulário integrado na interface do cliente (frontend) que se comunica com uma Serverless Function (backend na Vercel), enviando a solicitação diretamente para o e-mail de suporte por meio da API de e-mails da Resend.

```mermaid
graph TD
    Client[Cliente /conta.html] -->|POST /api/suporte| Serverless[Serverless Function /api/suporte.js]
    Serverless -->|Firebase Admin Auth| Auth[Validação de Sessão]
    Serverless -->|POST /emails| Resend[API da Resend]
    Resend -->|Encaminha E-mail| DevEmail[ctorres4564@gmail.com]
```

---

## 2. Fluxo de Dados

1.  **Entrada do Usuário:** O usuário navega até a tela "Minha Conta" (`conta.html`), preenche o formulário com o "Assunto" (mínimo de 3 caracteres) e "Mensagem" (mínimo de 10 caracteres) e clica em "Enviar".
2.  **Validação e Autenticação no Frontend:** O formulário valida os campos e envia a requisição HTTP `POST` para `/api/suporte`, contendo no cabeçalho o token de autenticação (`Authorization: Bearer <idToken>`).
3.  **Validação no Servidor (`api/suporte.js`):**
    *   Verifica se o método é `POST`.
    *   Verifica a autenticidade do token do usuário (extraindo o `uid` e o `email`).
    *   Valida se a mensagem e o assunto atendem às regras mínimas de segurança e tamanho.
4.  **Despacho do E-mail:** A Serverless Function realiza uma requisição POST direta para a API da Resend (`https://api.resend.com/emails`), usando a chave `RESEND_API_KEY` injetada via variáveis de ambiente.
5.  **Destino:** O e-mail é enviado para `ctorres4564@gmail.com` contendo a mensagem, além de anexar o `uid` e o e-mail original do remetente para permitir o rastreamento e resposta.

---

## 3. Manutenção e Variáveis de Ambiente

Para que o suporte funcione corretamente em produção, certifique-se de configurar as seguintes variáveis no painel da Vercel:

*   `RESEND_API_KEY`: A chave da API da Resend (obrigatória).
*   `REMINDER_FROM_EMAIL`: E-mail que aparecerá como remetente da mensagem. Se o domínio não estiver verificado na Resend, mantenha como `onboarding@resend.dev` (padrão) e as mensagens serão entregues apenas para o dono da conta Resend (`ctorres4564@gmail.com`). Uma vez verificado o domínio (ex: `metodoaprender.com`), configure para algo como `suporte@metodoaprender.com`.

---

## 4. Testes de Regressão

Os testes unitários e de integração estão localizados em `test/unit/suporte.test.js` e podem ser executados com:

```bash
npm run test
```
