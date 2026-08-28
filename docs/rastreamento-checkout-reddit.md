# Rastreamento de Conversão Reddit Pixel — Evento Customizado `CheckoutClick`

## Objetivo
Medir a taxa de conversão e evasão de visitantes da página `/livro` para o checkout do produto na Eduzz (`https://chk.eduzz.com/39VKJQ3DWR`), disparando o evento customizado `CheckoutClick` no Reddit Pixel.

---

## Arquitetura

O rastreamento foi centralizado no módulo `/livro/reddit-click-id.js`, garantindo isolamento e reutilização da lógica de detecção de links do checkout e integração com o Reddit Pixel.

```
                  ┌────────────────────────────────────────┐
                  │          Página /livro                 │
                  │  (Carrega Reddit Pixel + Module JS)    │
                  └──────────────────┬─────────────────────┘
                                     │
                    Ao Carregar      │      Ao Clicar no Botão Eduzz
                         │           │                 │
                         ▼           │                 ▼
             rdt('track', 'PageVisit')│   trackRedditCheckoutClick()
                                     │                 │
                                     │                 ▼
                                     │    rdt('track', 'Custom', {
                                     │      customEventName: 'CheckoutClick'
                                     │    })
                                     │                 │
                                     ▼                 ▼
                         Navegação nativa não bloqueada para
                         https://chk.eduzz.com/39VKJQ3DWR?utm_term=...
```

### Componentes Principais (`/livro/reddit-click-id.js`):
1. **`isEduzzCheckoutUrl(urlLike, baseURI)`**:
   - Valida se a URL fornecida pertence à origem `https://chk.eduzz.com` e possui o caminho `/39VKJQ3DWR`, independentemente de barras finais ou parâmetros de URL (`utm_term`, `utm_source`, cupons).
2. **`trackRedditCheckoutClick(windowRef)`**:
   - Invoca com segurança a função `window.rdt("track", "Custom", { customEventName: "CheckoutClick" })`.
   - Trata de forma defensiva cenários onde o Reddit Pixel ainda não carregou ou scripts de bloqueio estão ativos.
3. **`attachRedditCheckoutTracking(windowRef, documentRef)`**:
   - Utiliza delegação de eventos no `documentRef` com `capture: true`, capturando o clique em `a[href]` ou em seus elementos aninhados (`<span>`, `<img>`, `svg`).
   - Evita chamadas duplicadas através de um `WeakSet` que rastreia documentos já inicializados.
   - **Não bloqueia nem atrasa a navegação**: não executa `preventDefault()` nem `sleep`.
4. **`initializeRedditClickId(windowRef, documentRef)`**:
   - Coordena a leitura/injeção do `rdt_cid` (`utm_term`) nos links do checkout e registra o listener de clique.

---

## Fluxo de Dados

1. **Carregamento da Página**:
   - O snippet base no `<head>` dispara `rdt('track', 'PageVisit')`.
   - O script `/livro/reddit-click-id.js` inicializa, lê o parâmetro de URL `rdt_cid` ou cookie `_rdt_cid` e atualiza o `href` dos botões da Eduzz adicionando `utm_term=<click_id>`.
   - O listener de `click` é registrado no documento de forma idempotente.
   - **Nenhum evento `CheckoutClick` é disparado durante o carregamento**.

2. **Interação do Usuário (Clique no CTA do Checkout)**:
   - Usuário clica no botão "Quero começar a aplicar o método" ou "Quero acessar o Método Aprender".
   - O listener identifica que o elemento ou seu ancestral `<a>` aponta para o checkout Eduzz configurado.
   - Dispara imediatamente `rdt('track', 'Custom', { customEventName: 'CheckoutClick' })`.
   - O navegador prossegue com a navegação natural para o checkout da Eduzz levando a UTM de atribuição.

---

## Como Testar e Manter

### Testes Automatizados
Os testes estão localizados em `test/unit/reddit-click-id.test.js` e podem ser executados com:
```bash
npm test
# ou teste focado:
npx vitest run test/unit/reddit-click-id.test.js
```

### Validação em Tempo Real / Event Testing do Reddit
1. Abra a página `/livro` no navegador com a extensão **Reddit Pixel Helper** ou abra o Console/Network do DevTools.
2. Ao carregar a página:
   - Verifique que o evento `PageVisit` é enviado para `https://alb.reddit.com/t`.
   - Verifique que nenhum evento `CheckoutClick` foi disparado.
3. Clique em um dos botões de checkout:
   - Verifique a requisição para `alb.reddit.com` contendo o payload do evento `Custom` com `customEventName: "CheckoutClick"`.
   - No Reddit Ads > Events Manager > Test Events, confirme o recebimento de `CheckoutClick`.
