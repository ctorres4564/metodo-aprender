# Método Aprender

Plataforma web de estudo com repetição espaçada FSRS, recuperação ativa, avaliação pelo método Feynman e geração assistida por IA. Pessoas autenticadas podem criar módulos manualmente, gerar conceitos a partir de textos ou PDFs e montar módulos por seção de livros armazenados na própria biblioteca.

O projeto é uma aplicação HTML/CSS/JavaScript sem bundler. O frontend é estático, as APIs são funções serverless da Vercel e os dados ficam no Firebase Auth, Firestore e Storage.

## Funcionalidades

- Cadastro e login por e-mail/senha ou Google, verificação de e-mail e recuperação de senha.
- Catálogo de módulos oficiais versionados em `content/` e módulos privados criados por usuários.
- Estudo com abas Aprender, Revisar, Explicar, Quiz e Progresso.
- Agendamento de revisões pelo FSRS 4.5.
- Avaliação de explicações pelo método Feynman usando IA.
- Geração de conceitos, resumos, perguntas e alternativas a partir de texto ou PDF.
- Regeneração individual de conceitos e geração de analogias.
- Biblioteca de PDFs e textos com OCR, leitura, destaques, notas, busca e histórico.
- Revisão humana obrigatória antes de persistir módulos gerados a partir de livros.
- Rascunhos automáticos locais, isolados por UID e com expiração em 30 dias.
- Planos Free e Premium, checkout e gerenciamento de assinatura pela Stripe.
- Lembretes diários por e-mail via Resend e Vercel Cron.
- PWA instalável e monitoramento server-side com Sentry.

## Arquitetura

```text
.
├── index.html                 catálogo e módulos do usuário
├── app.html                   player genérico de estudo
├── criar-modulo.html          criação, revisão e edição de módulos
├── importar-livro.html        upload e geração por seção de livros
├── biblioteca.html            biblioteca de materiais
├── leitor.html                leitor de PDF, destaques e notas
├── busca.html                 busca em módulos, páginas, destaques e notas
├── conta.html                 preferências e exclusão da conta
├── privacidade.html
├── termos.html
├── assets/
│   ├── engine.js              FSRS e experiência de estudo
│   ├── storage.js             progresso: Firestore + fallback local
│   ├── firebase-init.js       Auth, Firestore e Storage no navegador
│   ├── firebase-config.js     configuração pública do Firebase
│   ├── auth-ui.js             interface de autenticação
│   ├── api-client.js          fetch autenticado com token Firebase
│   ├── module-drafts.js       rascunhos locais por usuário
│   ├── ocr.js                 OCR com Tesseract.js
│   ├── material-limits.js     limites espelhados no cliente
│   ├── pwa.js                 registro do service worker
│   └── styles.css             estilos compartilhados
├── content/
│   ├── catalog.json           catálogo oficial
│   └── *.json                 módulos oficiais versionados
├── api/
│   ├── _lib/                  Firebase Admin, Stripe, Sentry, IA e cotas
│   ├── avaliar-explicacao.js
│   ├── gerar-analogia.js
│   ├── gerar-modulo.js
│   ├── localizar-secao.js
│   ├── regenerar-conceito.js
│   ├── material.js            API consolidada da biblioteca
│   ├── account.js             exclusão da conta e dados
│   ├── criar-checkout.js
│   ├── stripe-portal.js
│   ├── stripe-webhook.js
│   └── enviar-lembretes.js
├── test/
│   ├── emulator/              regras e integrações contra emuladores
│   ├── e2e/                   fluxos completos com Playwright
│   ├── helpers/ e mocks/
│   └── *.test.js              testes unitários e de segurança
├── firestore.rules.txt
├── storage.rules.txt
├── firebase.json
├── vercel.json
├── manifest.json
└── sw.js
```

## Fluxos principais

### Módulos oficiais

Módulos curados ficam em `content/*.json` e são registrados em `content/catalog.json`. O player abre esses módulos por `app.html?m=<id>`.

Cada módulo contém uma configuração e uma lista de conceitos:

```json
{
  "config": {
    "appTitle": "Título",
    "appSubtitle": "Subtítulo",
    "logoEmoji": "📘",
    "homeIntro": "Introdução do módulo",
    "sourceCredit": "Fonte",
    "storageKey": "chave-unica-v1"
  },
  "concepts": [
    {
      "id": "conceito-unico",
      "tag": "Categoria",
      "title": "Título do conceito",
      "text": "Explicação curta.",
      "q": "Pergunta de múltipla escolha?",
      "options": ["A", "B", "C", "D"],
      "correct": 0
    }
  ]
}
```

`storageKey` e os IDs dos conceitos precisam ser estáveis para preservar o progresso existente.

### Módulos criados pelo usuário

Em `criar-modulo.html`, a pessoa pode preencher conceitos manualmente ou enviar um PDF/texto para `api/gerar-modulo.js`. O conteúdo sugerido aparece no editor e somente é persistido em `modules/{moduleId}` depois do clique em **Salvar módulo**.

O botão **Melhorar com IA** chama `api/regenerar-conceito.js` e altera somente o card selecionado.

### Importação de livros e revisão humana

1. `importar-livro.html` cria um material e extrai o texto no navegador com PDF.js e, quando necessário, Tesseract.js.
2. O PDF original vai para `users/{uid}/materials/{materialId}/original.pdf` no Firebase Storage.
3. O texto é dividido por página e salvo em `materials/{materialId}/pages/`.
4. A pessoa descreve a seção desejada; `api/localizar-secao.js` encontra o trecho e `api/gerar-modulo.js` gera o módulo.
5. O resultado é salvo apenas como rascunho no `localStorage`, com chave associada ao UID.
6. O app abre `criar-modulo.html` em modo de revisão. A pessoa pode editar, excluir, adicionar ou regenerar conceitos.
7. Somente a confirmação em **Salvar módulo** grava no Firestore e registra o módulo no material de origem.

Rascunhos são atualizados com debounce, podem ser restaurados após recarregar a página, expiram depois de 30 dias e são removidos após o Firestore confirmar o salvamento.

### Biblioteca e leitor

`api/material.js` concentra as ações administrativas:

| Ação | Finalidade |
| --- | --- |
| `create` | cria o registro do material e reserva a cota do plano |
| `updateStatus` | atualiza processamento, OCR, páginas e falhas |
| `registerModule` | registra um módulo salvo de forma idempotente |
| `recordRead` | grava última abertura e página lida |
| `delete` | exclui arquivo, páginas, anotações e material |

Páginas, destaques e notas são escritos diretamente pelo cliente, sempre protegidos por regras que verificam a propriedade do material pai. O leitor usa PDF.js, suporta navegação, zoom, destaques e notas. `busca.html` pesquisa módulos, páginas, destaques e anotações.

## Persistência

| Dado | Local |
| --- | --- |
| autenticação | Firebase Auth |
| perfil, plano e preferências | `users/{uid}` |
| módulos privados | `modules/{moduleId}` |
| progresso | `progress/{uid}_{storageKey}` |
| cotas de geração | `ai_usage/{uid}_{AAAA-MM}` |
| cotas de explicação | `ai_usage/{uid}_{AAAA-MM}_explain` |
| materiais | `materials/{materialId}` |
| páginas | `materials/{materialId}/pages/` |
| destaques e notas | subcoleções do material |
| PDF original | Firebase Storage |
| rascunhos não salvos | `localStorage`, isolado por UID |

O progresso é escrito imediatamente no localStorage e sincronizado com Firestore por debounce. Isso mantém uma cópia local em falhas momentâneas de rede, mas módulos e biblioteca continuam dependendo do Firebase.

## IA e cotas

As cinco rotas de IA usam OpenRouter e exigem um token Firebase válido:

- `api/avaliar-explicacao.js`
- `api/gerar-analogia.js`
- `api/gerar-modulo.js`
- `api/localizar-secao.js`
- `api/regenerar-conceito.js`

Modelo padrão: `openai/gpt-4o-mini`, configurável por `OPENROUTER_MODEL`.

| Balde | Free | Premium | Operações |
| --- | ---: | ---: | --- |
| `explain` | 300/mês | 3000/mês | avaliar explicação e gerar analogia |
| `generate` | 60/mês | 600/mês | gerar módulo, localizar seção e regenerar conceito |

A reserva da cota é transacional. Falhas posteriores à reserva tentam estornar o consumo. E-mails não verificados não podem consumir IA.

Limites adicionais:

- PDF: menos de 50 MB e no máximo 600 páginas.
- OCR: até 80 páginas por importação.
- Materiais: 3 no Free e 30 no Premium.
- Fonte enviada à geração: até 14 mil caracteres.
- Conceitos gerados: até 20 por chamada.
- Seção localizada: até 100 páginas.

## Requisitos

- Node.js 20, mesma versão usada no CI.
- npm.
- Java 21 para Firebase Emulator.
- Chromium do Playwright para testes E2E.
- Projeto Firebase com Auth, Firestore e Storage.
- Projeto Vercel para executar as funções em `api/`.

## Instalação

```bash
git clone <url-do-repositorio>
cd metodo-aprender
npm ci
```

### Frontend estático

Para visualizar somente os arquivos estáticos:

```bash
npx serve .
```

Um servidor estático não executa `/api/*`. Autenticação e dados usarão o Firebase configurado em `assets/firebase-config.js`, salvo quando os testes injetarem explicitamente a configuração dos emuladores.

### Aplicação com funções serverless

Para executar frontend e APIs localmente, use a Vercel CLI:

```bash
npx vercel dev
```

As funcionalidades dependentes de serviços externos exigem as variáveis abaixo. Não use segredos de produção em ambientes locais compartilhados.

## Configuração do Firebase

1. Ative os provedores **E-mail/senha** e **Google** no Firebase Authentication.
2. Crie Firestore e Storage.
3. Publique `firestore.rules.txt` e `storage.rules.txt` nos respectivos serviços.
4. Cadastre os domínios usados pelo app em Authentication → Authorized domains.
5. Se usar outro projeto, substitua a configuração pública em `assets/firebase-config.js`.
6. Gere uma conta de serviço e configure o JSON completo em `FIREBASE_SERVICE_ACCOUNT` na Vercel.

A configuração do frontend não é secreta. A proteção efetiva vem de autenticação, regras do Firebase e validações server-side.

## Variáveis de ambiente

| Variável | Obrigatória para | Descrição |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | APIs autenticadas | JSON completo da conta de serviço Firebase |
| `OPENROUTER_API_KEY` | IA | chave privada da OpenRouter |
| `OPENROUTER_MODEL` | opcional | sobrescreve o modelo padrão |
| `APP_URL` | recomendada | URL pública usada em retornos, e-mails e metadados |
| `STRIPE_SECRET_KEY` | pagamentos | chave secreta Stripe |
| `STRIPE_PRICE_ID` | checkout | ID do preço recorrente |
| `STRIPE_WEBHOOK_SECRET` | webhook | segredo de assinatura do endpoint Stripe |
| `CRON_SECRET` | lembretes | bearer token usado pelo Vercel Cron |
| `RESEND_API_KEY` | lembretes | chave da API Resend |
| `REMINDER_FROM_EMAIL` | opcional | remetente; padrão `onboarding@resend.dev` |
| `SENTRY_DSN` | opcional | ativa captura de erros server-side |

Nunca versione chaves privadas ou o JSON da conta de serviço.

## Stripe

O Premium é uma assinatura mensal com período de teste configurado no checkout. O fluxo usa:

- `api/criar-checkout.js` para criar a sessão;
- `api/stripe-webhook.js` para sincronizar plano, cliente e assinatura;
- `api/stripe-portal.js` para abrir o Billing Portal.

O webhook deve receber pelo menos:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Use chaves e webhooks de teste antes de configurar produção. Nenhum dado de cartão passa pelo servidor da aplicação.

## Lembretes por e-mail

O cron definido em `vercel.json` chama `/api/enviar-lembretes` diariamente às 12:00 UTC. A função exige `CRON_SECRET`, procura revisões vencidas e envia somente para usuários que ativaram `remindersEnabled`.

Sem domínio verificado na Resend, `onboarding@resend.dev` possui restrições de destinatário. Para envio real a usuários, verifique um domínio e configure `REMINDER_FROM_EMAIL`.

## Testes

O CI executa três suítes em `.github/workflows/tests.yml`:

```bash
npm test
npm run test:emulator
npm run test:e2e
```

- `npm test`: Vitest, regras de negócio, parsing, OpenRouter, Sentry, FSRS e regressões de segurança/XSS com JSDOM.
- `npm run test:emulator`: Firestore, Storage e Auth reais em emuladores; regras, concorrência, Stripe mockada e exclusão de conta.
- `npm run test:e2e`: Playwright contra o frontend e emuladores; autenticação, criação de módulo e leitor de PDF.

Os testes de emulator e E2E usam as mesmas portas e devem ser executados separadamente.

## Segurança

- Tokens Firebase são verificados nas APIs.
- Regras do Firestore e Storage isolam dados por UID.
- Campos financeiros e administrativos só são alterados pelo servidor.
- Webhooks Stripe são validados por assinatura.
- Cotas de IA e materiais usam transações.
- Registro de módulos gerados é idempotente.
- Valores dinâmicos renderizados em HTML são escapados ou inseridos por `textContent`.
- A Vercel envia CSP, HSTS, `nosniff`, proteção contra frames, política de referência e de permissões.
- Exclusão de conta remove dados e cancela assinaturas antes de apagar o usuário do Firebase Auth.
- Sentry fica inativo quando `SENTRY_DSN` não está configurado.

A CSP ainda permite `'unsafe-inline'` devido a scripts inline legados. A remoção dessa permissão exige mover esses scripts para arquivos externos. Vulnerabilidades transitivas conhecidas estão registradas em `docs/security-known-risks.md`.

## PWA e operação offline

`manifest.json`, `sw.js` e `assets/pwa.js` permitem instalar o site. O service worker usa estratégia network-first e mantém em cache apenas o shell estático. Dados privados, PDFs, Firestore, Storage e respostas de IA não entram nesse cache.

Offline, o shell e uma cópia local do progresso podem continuar disponíveis, mas autenticação nova, sincronização, biblioteca, APIs e IA exigem rede.

## Deploy

O destino suportado diretamente é a Vercel, pois `api/*.js`, cron e cabeçalhos dependem da plataforma.

1. Importe o repositório na Vercel.
2. Configure as variáveis necessárias para Preview e Production.
3. Confirme que `APP_URL` corresponde ao domínio do ambiente.
4. Publique as regras do Firebase.
5. Configure o webhook Stripe com a URL de produção.
6. Execute as três suítes de testes antes de promover o deploy.

Hosts puramente estáticos, como GitHub Pages, não executam as funções serverless sem uma migração do backend.

## Licença e conteúdo

Antes de distribuir ou comercializar o projeto, defina uma licença para o código. Conteúdo gerado a partir de livros deve ser revisado, parafraseado e usado de acordo com os direitos aplicáveis à fonte.
