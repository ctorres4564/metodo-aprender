# App de Estudo — Arquitetura Modular

Plataforma de estudo com repetição espaçada (SM-2) e gamificação, projetada para escalar de "um capítulo" para "vários temas/cursos" sem duplicar código — e com o desenho já preparado para, no futuro, virar um produto de assinatura.

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

## Como adicionar um novo módulo/capítulo

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
