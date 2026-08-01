# Método Aprender

Plataforma de estudo genérica, com repetição espaçada (SM-2), gamificação e recursos de IA (avaliação Feynman, geração de conceitos a partir de PDF/artigo, analogias). Qualquer pessoa logada pode criar seus próprios módulos sobre qualquer assunto — **a criação de módulos é a funcionalidade central do produto**, não um recurso secundário.

O projeto nasceu focado num único livro (Manual de Psicologia Evolucionista) e evoluiu para uma plataforma multi-assunto: hoje esse conteúdo original é só um **módulo de exemplo** no catálogo (`content/catalog.json`), lado a lado com os módulos que cada usuário cria pela própria interface (`criar-modulo.html`). Nenhum código precisa ser tocado para adicionar conteúdo novo — nem por mim, nem por quem usa o app.

Este pacote **substitui** os protótipos de arquivo único criados anteriormente (`evolucao-comportamento-app.html` e `template-estudo-espacado.html`), que ainda estão na pasta apenas como referência histórica.

## Estrutura de pastas

```
index.html                    → catálogo: lista os módulos/trilhas disponíveis
app.html                      → player genérico: carrega qualquer módulo via ?m=<id>
assets/
  styles.css                  → design system compartilhado (visual de TODOS os módulos)
  engine.js                   → motor do app: SM-2, gamificação, telas (Aprender/Revisar/Explicar/Quiz/Progresso)
  storage.js                  → adapter de persistência (hoje: localStorage)
content/
  catalog.json                → índice dos módulos (título, ícone, plano, arquivo de conteúdo)
  capitulo-1-1-fundamentos-evolucao-comportamento.json → conteúdo do 1º módulo (18 conceitos)
api/
  avaliar-explicacao.js       → função serverless (Vercel) que avalia o modo Feynman via OpenRouter
firestore.rules.txt           → regras de segurança para colar no Firebase Console
assets/
  firebase-config.js          → configuração do seu projeto Firebase (EDITE com seus dados)
  firebase-init.js            → inicializa Firebase Auth + Firestore, expõe window.AppAuth / window.AppDB
  auth-ui.js                  → tela de login, cadastro e recuperação de senha
```

Content (JSON) e engine (JS/CSS) estão completamente separados. Criar um novo módulo = criar um novo JSON em `content/` e uma entrada em `catalog.json`. Nunca é preciso copiar ou editar `engine.js`.

## Como rodar localmente

Este app usa `fetch()` para carregar os arquivos JSON de conteúdo. Por segurança, navegadores bloqueiam `fetch()` de arquivos abertos direto do disco (`file://`). Por isso, sirva a pasta com um servidor local simples:

```
cd pasta-do-projeto
python3 -m http.server 8000
```

Depois abra `http://localhost:8000` no navegador. (Alternativa sem Python: `npx serve .`.)

Quando este projeto for publicado num host real (Vercel, Netlify, GitHub Pages, um servidor próprio etc.), esse passo deixa de ser necessário — o app já está pronto para rodar em produção do mesmo jeito.

## Como adicionar um novo módulo

**Caminho principal (qualquer pessoa, sem código):** pela própria interface, em "➕ Criar novo módulo" no catálogo (`index.html` → `criar-modulo.html`). Preenche o formulário manualmente ou importa um PDF/texto e deixa a IA sugerir os conceitos — ver seções "Criação de módulos dentro do app" e "Importar conceitos de um PDF/artigo com IA" mais abaixo. Esse é o fluxo pensado para o produto final; a opção abaixo é só para conteúdo "oficial"/curado que eu (desenvolvedor) queira versionar no código.

**Caminho alternativo (editando arquivos, só para módulos oficiais/curados):**

1. Crie `content/nome-do-modulo.json` seguindo o esquema:
   ```json
   {
     "config": {
       "appTitle": "...", "appSubtitle": "...", "logoEmoji": "...",
       "homeIntro": "...", "sourceCredit": "...",
       "storageKey": "estudo_XXXX_v1"
     },
     "concepts": [
       { "id": "...", "tag": "...", "title": "...", "text": "...",
         "q": "...", "options": ["...", "...", "...", "..."], "correct": 0 }
     ]
   }
   ```
2. `storageKey` precisa ser único entre todos os módulos (evita que o progresso de um sobrescreva o de outro).
3. Adicione uma entrada em `content/catalog.json`, apontando `contentFile` para o novo arquivo e definindo `plan: "free"` ou `"premium"`.
4. Pronto — o módulo aparece automaticamente no catálogo (`index.html`) e funciona em `app.html?m=<id>` sem nenhuma alteração de código.

Recomendação de conteúdo: 12–25 conceitos por módulo, uma ideia por ficha, explicações em linguagem própria (nunca copiar parágrafos inteiros de livros/artigos-fonte).

## Modo Explicar (Técnica de Feynman)

Uma quinta aba pede que o(a) estudante explique um conceito já aprendido com as próprias palavras, num campo de texto livre. A explicação é avaliada por um modelo de linguagem (via API da Anthropic), que retorna nota, o que foi coberto, o que faltou, possíveis equívocos e um feedback curto — e essa avaliação também alimenta a repetição espaçada (uma explicação fraca reagenda o conceito para revisão em breve).

Isso é a primeira parte do projeto que precisa de um backend de verdade: a avaliação roda numa função serverless (`api/avaliar-explicacao.js`), que fica hospedada na própria Vercel — nenhum servidor separado é necessário. A função usa a **OpenRouter** (formato compatível com a API da OpenAI), que dá acesso a vários modelos por trás de uma única chave.

**Configuração obrigatória (uma vez só):**

1. Crie uma chave de API em [openrouter.ai/keys](https://openrouter.ai/keys).
2. No painel do seu projeto na Vercel: **Settings → Environment Variables**.
3. Adicione uma variável chamada `OPENROUTER_API_KEY` com o valor da chave copiada, disponível para o ambiente "Production" (e "Preview", se quiser testar antes de publicar).
4. (Opcional) Adicione `OPENROUTER_MODEL` se quiser usar um modelo diferente do padrão (`openai/gpt-4o-mini`) — veja o slug exato do modelo desejado em [openrouter.ai/models](https://openrouter.ai/models) (copie o nome tal como aparece lá, incluindo o prefixo do provedor). Um slug incorreto faz a chamada falhar silenciosamente do lado da OpenRouter.
5. Faça um novo deploy (`vercel --prod`) para as variáveis entrarem em vigor.

Sem essa chave configurada, as outras quatro abas (Aprender, Revisar, Quiz, Progresso) continuam funcionando normalmente — só o modo Explicar fica indisponível, com uma mensagem de erro clara explicando o motivo.

**Sobre custo:** cada avaliação consome uma chamada de API (cobrada por token, conforme o modelo escolhido e o saldo da sua conta OpenRouter). Vale acompanhar o consumo em openrouter.ai/activity e definir um limite de créditos para evitar surpresas se o app tiver uso intenso.

## Login, cadastro e progresso individual (Firebase)

O app agora exige login antes de mostrar qualquer conteúdo. Cada pessoa cria sua própria conta (e-mail/senha), com recuperação de senha por e-mail — e o progresso de cada uma fica isolado no Firestore, sincronizado entre qualquer dispositivo em que ela entrar.

Sem conexão com o Firebase configurada, o app cai automaticamente para localStorage (útil para testes locais), mas o objetivo em produção é sempre usar o Firebase.

**Configuração obrigatória (uma vez só):**

1. Crie um projeto em [console.firebase.google.com](https://console.firebase.google.com).
2. Em **Authentication → Sign-in method**, ative o provedor "E-mail/senha".
3. Em **Firestore Database**, clique em "Criar banco de dados" (modo produção).
4. Em **Firestore Database → Regras**, cole o conteúdo de `firestore.rules.txt` deste projeto e publique.
5. Em **Configurações do projeto → Geral → Seus apps**, crie um app da Web (ícone `</>`) e copie o objeto `firebaseConfig` gerado.
6. Cole esses valores em `assets/firebase-config.js`, substituindo os textos `COLE_AQUI_...`.
7. Publique de novo (`vercel --prod`).

**Sobre os valores em `firebase-config.js`:** eles não são segredos — identificam o projeto, mas não dão acesso a nada sozinhos. Quem protege os dados de verdade são as regras do Firestore (passo 4), que garantem que cada pessoa só lê/escreve o próprio progresso.

## Criação de módulos dentro do app

Qualquer pessoa logada pode criar seus próprios módulos de estudo direto pelo navegador, sem precisar de código nem de editar arquivos — em `criar-modulo.html` (acessível pelo botão "➕ Criar novo módulo" no catálogo).

Como funciona:
1. A pessoa preenche título, subtítulo, ícone e adiciona quantos "conceitos" quiser — cada conceito tem uma explicação curta e uma pergunta de múltipla escolha com 4 alternativas.
2. Ao salvar, o módulo é gravado no Firestore (coleção `modules`), associado ao `uid` de quem criou (`ownerId`).
3. O módulo aparece na seção "🗂️ Meus Módulos" do catálogo (`index.html`), com opções de editar ou excluir.
4. Ao abrir, `app.html?m=<id>&src=user` carrega o conteúdo do Firestore em vez de um arquivo JSON estático — o mesmo motor (`engine.js`) roda por igual para módulos oficiais e módulos criados por usuários.

Módulos criados por usuários são privados: só quem criou consegue ver, editar ou estudar aquele módulo (garantido pelas regras do Firestore em `firestore.rules.txt`, seção `modules`). Se você já publicou as regras antes desta funcionalidade, é necessário colar o `firestore.rules.txt` atualizado no Firebase Console → Firestore Database → Regras novamente e publicar — do contrário, criar/editar módulos vai falhar com erro de permissão.

### Importar conceitos de um PDF/artigo com IA (opcional)

Na tela "Criar novo módulo" há uma seção "🤖 Importar com IA": a pessoa envia um PDF (lido no próprio navegador com `pdf.js`, via CDN — o arquivo não é enviado para nenhum servidor além do texto extraído) ou cola um trecho de texto, e uma função serverless (`api/gerar-modulo.js`, também via OpenRouter) sugere conceitos (título, explicação, pergunta de múltipla escolha) automaticamente.

Pontos importantes:
- A IA é instruída a **parafrasear** o texto-fonte em vez de copiá-lo literalmente, para não incentivar reprodução de material com direitos autorais.
- Os conceitos gerados aparecem nos cards de edição para revisão — nada é salvo automaticamente; a pessoa ainda precisa clicar em "Salvar módulo".
- Limite de ~14 mil caracteres de texto-fonte por geração (aprox. 10 páginas) e até 20 conceitos por vez, para manter custo e qualidade sob controle. Textos maiores podem ser divididos em várias importações.
- Usa a mesma variável `OPENROUTER_API_KEY` já configurada para o modo Explicar — nenhuma configuração extra é necessária.

### Importar de um livro (sob demanda, parte por parte)

Na tela "🗂️ Meus Módulos" há um botão "📖 Importar de um livro" (`importar-livro.html`) para quando o conteúdo vem de um livro (ou qualquer texto longo dividido em partes/capítulos/seções) e a pessoa quer gerar módulos aos poucos, sem processar o livro inteiro de uma vez.

Como funciona, na prática:
1. A pessoa envia o PDF do livro completo (ou cola o texto inteiro) **uma única vez**. O texto é extraído no navegador (`pdf.js`, até 600 páginas) e fica guardado na memória da página — nenhuma chamada de IA acontece nessa etapa.
2. A pessoa então digita o que quer transformar em módulo, em texto livre: "Parte 1", "Capítulo 3", "a seção sobre memória de trabalho" — qualquer descrição.
3. Uma função de IA (`api/localizar-secao.js`) localiza **só essa parte pedida** dentro do livro (não o livro inteiro) — funciona com qualquer convenção de divisão (partes, capítulos, seções nomeadas, subtítulos), já que é a IA que interpreta a descrição, não um padrão fixo de texto. Documentos curtos são analisados inteiros; livros longos usam uma versão compacta (início de cada página) para manter custo e tempo de resposta previsíveis.
4. O trecho encontrado é enviado para `api/gerar-modulo.js` (mesma função da importação de módulo único), que gera os conceitos, e o resultado já é salvo direto como um novo módulo em "Meus Módulos".
5. A pessoa pode repetir o passo 2 quantas vezes quiser, pedindo outras partes do mesmo livro, sem reenviar o PDF de novo.

Essa abordagem (uma chamada de IA pequena por módulo pedido) é bem mais rápida e barata do que tentar mapear e gerar o livro inteiro de uma vez — e funciona mesmo em livros com estrutura em vários níveis (ex: partes divididas em subtítulos), já que a pessoa descreve exatamente o que quer, em vez de o app tentar adivinhar todas as divisões sozinho.

Como o conteúdo é gerado e salvo automaticamente (sem revisão de cada conceito antes de salvar), a recomendação é sempre revisar/editar os módulos gerados depois, pelo botão "✏️ Editar" no catálogo.

**Sobre custo:** cada importação gasta 1 chamada de IA para detectar a estrutura do documento, mais 1 chamada por divisão selecionada para gerar os conceitos. Um livro com 10 capítulos selecionados = ~11 chamadas no total. Por isso a etapa de seleção existe — para a pessoa escolher só as divisões que realmente quer, antes de gastar créditos gerando conceitos.

## Explicações alternativas por analogia (aba Aprender)

Em cada conceito da aba Aprender, há um botão "💡 Ver explicação com analogia": ele pede a uma IA (via `api/gerar-analogia.js`, mesma infraestrutura OpenRouter das outras funções) uma explicação alternativa do mesmo conceito usando uma analogia ou metáfora do dia a dia — uma forma diferente de "pensar" sobre a ideia, para ajudar quem não fixou bem com a explicação original.

A analogia gerada fica salva no progresso da pessoa (por conceito), então ela só é gerada uma vez por conceito — nas próximas vezes que a pessoa revisitar aquele conceito, a analogia já salva aparece direto, sem custo extra de API.

## Controle de uso de IA por usuário (base para monetização)

Todas as funções que chamam a OpenRouter (`avaliar-explicacao`, `gerar-modulo`, `localizar-secao`, `gerar-analogia`) agora exigem login: o servidor verifica o token do Firebase de quem está chamando (`api/_lib/usage.js`, usando o Firebase Admin SDK) antes de gastar qualquer crédito de IA. Sem isso, qualquer pessoa sem conta poderia consumir créditos livremente.

Cada pessoa tem um limite mensal de gerações (hoje: 40/mês no plano "free", único plano que existe por enquanto). O contador fica em `ai_usage/{uid}_{ano-mes}` no Firestore e reseta sozinho todo mês (é uma chave nova, não precisa de rotina de limpeza). A estrutura já reconhece um campo `plan` no documento `users/{uid}` — quando existir cobrança de verdade (Stripe), o webhook só precisa gravar `plan: "premium"` nesse documento que o limite maior passa a valer automaticamente, sem mexer neste código de novo.

**Configuração obrigatória (uma vez só), além do que já existia:**

1. No [Firebase Console](https://console.firebase.google.com) → seu projeto → ⚙️ **Configurações do projeto → Contas de serviço**.
2. Clique em "Gerar nova chave privada" — baixa um arquivo `.json`.
3. Abra esse arquivo, copie o conteúdo inteiro.
4. No painel da Vercel → **Settings → Environment Variables**, crie uma variável chamada `FIREBASE_SERVICE_ACCOUNT` com esse JSON completo como valor (em "Production").
5. Publique de novo (`vercel --prod`) — esse deploy também vai instalar a nova dependência `firebase-admin` (adicionada em `package.json`) automaticamente.

Sem essa variável configurada, as 4 funções de IA passam a responder com erro claro (em vez de falhar silenciosamente ou funcionar sem controle de custo).

## Responsividade

O layout é mobile-first: no desktop a navegação aparece como abas no topo; em telas estreitas (≤620px) ela vira uma barra fixa na parte inferior, no padrão de apps mobile. Tipografia usa `clamp()` para se ajustar ao tamanho da tela. Testado visualmente em larguras de celular, tablet e desktop.

## Preparado para virar produto de assinatura — o que já está pronto e o que falta

**Já pronto na arquitetura atual:**
- Separação conteúdo/motor (adicionar temas não exige tocar em código de UI ou algoritmo).
- Catálogo de módulos com campo `plan` (`free`/`premium`) já modelado nos dados — hoje é só um rótulo visual, mas o dado já existe para quando houver controle de acesso de verdade.
- `StorageAdapter` isolado (`assets/storage.js`): hoje já fala com o Firestore (progresso por usuário), com fallback automático para localStorage.
- **Autenticação real** (Firebase Auth): criação de conta, login e recuperação de senha por e-mail, com progresso individualizado e sincronizado entre dispositivos.

**O que falta para ser, de fato, um produto de assinatura:**
- **Cobrança/paywall** (ex: Stripe) para de fato bloquear módulos `premium` até a assinatura ser confirmada — hoje o bloqueio no catálogo é só visual (cosmético), não impede o acesso ao arquivo se alguém souber a URL direta.
- **Domínio próprio** (em vez de `*.vercel.app`), opcional mas recomendável para transmitir mais confiança a quem for pagar.
- Eventualmente, um painel administrativo para gerenciar usuários/assinaturas fora do console do Firebase.

Esses itens envolvem decisões de negócio (qual provedor de cobrança, qual modelo de preço, etc.) que vale conversarmos antes de implementar.
