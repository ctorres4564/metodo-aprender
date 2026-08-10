# Relatório de Status — Método Aprender

*Preparado em 04/08/2026*

## Resumo executivo

O produto está tecnicamente funcional e cobre um conjunto de recursos bem mais completo do que a maioria dos MVPs: autenticação real, persistência em nuvem, geração de conteúdo por IA com controle de custo, cobrança recorrente via Stripe já operante (checkout, webhook, portal de gerenciamento), biblioteca de materiais, leitor de PDF com destaques/anotações, busca e um algoritmo de repetição espaçada de qualidade (FSRS). Isso é significativamente mais do que "pronto para testar com amigos" — é uma base de produto real.

Dito isso, **ainda não está pronto para monetizar publicamente**. A lacuna não é técnica no sentido de "falta construir feature" — é uma combinação de conformidade legal ausente (nenhuma Política de Privacidade, Termos de Uso ou tratamento formal de LGPD, apesar de já coletar e-mail, PDFs de usuários e dados de pagamento), duas brechas de controle de custo/abuso (sem verificação de e-mail, sem limite de armazenamento por plano) e alguns itens de maturidade operacional (sem monitoramento de erros em produção, sem testes automatizados, domínio ainda em `*.vercel.app`). Nenhum desses itens é grande em esforço de engenharia — a maior parte é configuração e um punhado de páginas novas — mas cobrar de pessoas reais sem eles expõe a um risco desproporcional ao tamanho do problema.

**Veredito direto:** com 1 a 2 semanas de trabalho focado nos itens da seção "Antes de abrir para pagamento real", dá para lançar com segurança. Não é necessário refazer nada do que já existe.

---

## O que já está pronto e funcionando

### Núcleo pedagógico
- Repetição espaçada com **FSRS** (o mesmo algoritmo do Anki), não um SM-2 simplificado — inclui migração automática do progresso de quem já vinha usando a versão anterior.
- Gamificação (XP, níveis, streak, badges), quiz adaptativo, julgamento de confiança antes de revelar a resposta, modo Feynman avaliado por IA, explicações alternativas por analogia.
- Motor (`engine.js`) e conteúdo completamente separados — qualquer módulo novo roda no mesmo player sem alterar código.

### Contas e dados
- Autenticação real (Firebase Auth): cadastro, login, recuperação de senha por e-mail.
- Progresso, módulos, materiais, destaques e anotações — tudo sincronizado por conta, isolado entre usuários por regras de segurança do Firestore (auditadas e testadas manualmente nesta conversa, camada dupla: campo `ownerId` no documento + verificação do documento "pai" via `get()`).

### Criação e importação de conteúdo por IA
- Criação manual de módulo, importação de PDF/artigo único, e importação de livro inteiro sob demanda (parte por parte, sem reprocessar o livro inteiro a cada módulo).
- OCR automático (Tesseract.js, no navegador, sem custo de API) para PDFs escaneados.
- Regeneração de um conceito específico sem descartar o resto do módulo.
- Controle de custo: todo uso de IA passa por autenticação + limite mensal por plano (40 gerações/mês no free, 400/mês no premium), reforçado no servidor via transação atômica no Firestore — não dá para contornar client-side.

### Biblioteca, leitor e integração pedagógica (construído nesta sessão de trabalho, Etapas 2–4)
- Biblioteca permanente de materiais (PDF/texto), com o arquivo original no Firebase Storage e o texto extraído por página no Firestore.
- Leitor de PDF embutido (não baixa o arquivo, usa HTTP Range requests via PDF.js), com destaque de texto em 4 cores e anotações vinculadas a um trecho.
- Cada conceito gerado por IA guarda a página e um trecho literal de origem (nunca escrito pela IA — extraído do texto real), com link "voltar ao trecho original".
- Anotações podem ser vinculadas a um conceito/módulo específico, aparecendo de volta na tela de estudo daquele conceito.
- Busca full-text (`busca.html`) cruzando páginas de livros, destaques, anotações e conceitos de módulos, com deep link direto para o ponto exato.
- Anotações/destaques do usuário agora entram como contexto extra na geração de módulos por IA (a IA prioriza o que a pessoa já achou importante).
- Um bug real e relevante foi encontrado e corrigido nesta sessão: editar um módulo importado de um livro apagava silenciosamente o vínculo com o material de origem e trocava o id de todo conceito, quebrando os recursos acima. Já corrigido — o editor agora preserva essas referências entre edições.

### Cobrança (Stripe) — já funcional, não é só maquete
- Checkout hospedado pela Stripe (nenhum dado de cartão passa pelo servidor próprio), 7 dias de teste grátis, R$19,90/mês.
- Webhook grava `plan: "premium"` automaticamente ao pagamento e reverte para `"free"` ao cancelamento — sem intervenção manual.
- Portal de gerenciamento (trocar cartão, ver faturas, cancelar) delegado à própria Stripe.
- Testado com cartões de teste; falta apenas trocar a chave `sk_test_...` por `sk_live_...` para cobrar de verdade.

### Retenção e distribuição
- PWA instalável (ícone próprio, funciona offline para o "shell" do app).
- Lembrete diário por e-mail (Resend) para quem tem revisão vencida — mas só chega a usuários reais depois de verificar um domínio próprio na Resend (hoje só chega à própria caixa da conta Resend, modo sandbox).

---

## O que falta antes de abrir para pagamento real

Organizado por risco, não por tamanho — alguns destes são pequenos de implementar mas caros de pular.

### 1. Conformidade legal (o maior risco real)
- **Nenhuma Política de Privacidade nem Termos de Uso publicados.** O app já coleta e-mail, conteúdo enviado pelo usuário (PDFs, anotações) e, em breve, dados de pagamento processados via Stripe — cobrar de pessoas reais no Brasil sem esses documentos é uma exposição jurídica direta (LGPD exige base legal e informação clara sobre tratamento de dados pessoais; um serviço pago também normalmente precisa de termos contratuais mínimos).
- **Sem fluxo de exclusão de conta/dados.** LGPD garante direito de eliminação dos dados a pedido do titular; hoje não existe um "excluir minha conta" em lugar nenhum do app (só existe exclusão de material individual e de módulo individual).
- Nenhum desses itens depende de decisão técnica complexa — é redigir os textos (ou adaptar um modelo) e publicar 1–2 páginas novas, mais um botão de exclusão de conta que apaga os documentos do Firestore/Storage daquele uid.

### 2. Controle de custo e abuso
- **Sem verificação de e-mail no cadastro.** Qualquer pessoa pode criar contas descartáveis ilimitadas para sempre ter 40 gerações de IA "novas" por mês, sem nunca pagar — o limite mensal por conta só funciona de verdade se criar conta tiver alguma fricção.
- **Sem diferenciação de limite de armazenamento por plano.** Um usuário free pode enviar PDFs de até 50 MB repetidas vezes (mesmo limite do premium) — custo de Storage/Firestore escala com uso, não com receita, no plano gratuito. Vale um limite de armazenamento total (ou de nº de materiais) mais baixo no free.
- Nenhuma chave viva de produção real: `STRIPE_SECRET_KEY` ainda precisa ser trocada de `sk_test_...` para `sk_live_...` (e um novo webhook de produção criado) quando decidir cobrar de verdade.

### 3. Precificação e diferenciação de produto
- Hoje existe só um plano pago, e a única diferença entre free e premium é a quantidade de gerações de IA por mês (40 vs. 400) — vale validar se isso é motivo suficiente pra conversão, ou se compensa também diferenciar por armazenamento, nº de materiais na Biblioteca, ou algum recurso exclusivo (ex.: busca, ou histórico de leitura mais completo) para o plano pago. Essa é uma decisão de produto/negócio, não técnica.

### 4. Maturidade operacional
- **Sem monitoramento de erros em produção** (tipo Sentry) — hoje, um erro em produção só aparece se alguém checar os logs da Vercel manualmente ou um usuário reclamar.
- **Sem testes automatizados** — todo o projeto depende de `node --check` (só verifica sintaxe) e verificação manual. Funcionou bem até aqui porque cada mudança foi revisada com cuidado, mas não escala indefinidamente sem rede de segurança.
- **Domínio próprio pendente** — o app roda em `*.vercel.app`; para cobrar de pessoas reais, um domínio próprio (e e-mail de lembrete saindo desse domínio, não do sandbox do Resend) passa mais confiança.
- **Sem canal de suporte definido** — nenhum e-mail de contato/suporte visível no app hoje.

### 5. Qualidade técnica menor (não bloqueia lançamento, mas vale registrar)
- Um bug de UI pré-existente em `criar-modulo.html`: remover um conceito do meio da lista pode fazer dois cards de conceito compartilharem o mesmo grupo de botões de rádio (resposta correta), fazendo marcar uma alternativa afetar o card errado. Baixo risco (afeta só quem edita módulos manualmente removendo conceitos do meio), mas vale uma correção futura.
- Não há testes de carga/custo real de IA — os limites mensais (40/400) foram definidos por estimativa, não por dado de uso real; vale revisar depois de alguns usuários pagantes de verdade.

---

## Prioridades recomendadas, em ordem

1. Política de Privacidade + Termos de Uso (mesmo que um texto direto, adaptado a este produto) e um "excluir minha conta" funcional.
2. Verificação de e-mail no cadastro (Firebase Auth já suporta nativamente — `sendEmailVerification`).
3. Limite de armazenamento/nº de materiais diferenciado por plano.
4. Domínio próprio + verificação de domínio na Resend (pra lembretes chegarem a usuários reais).
5. Trocar para chaves Stripe de produção e criar o webhook de produção.
6. Monitoramento de erros básico (Sentry ou equivalente) antes do primeiro usuário pagante real.
7. Corrigir o bug de grupo de rádio em `criar-modulo.html` (baixo esforço, baixo risco, mas rápido de fechar).

Itens 1–3 são os que eu recomendaria não pular de jeito nenhum antes de cobrar de qualquer pessoa fora de um teste fechado com amigos/conhecidos.

---

*Nota técnica: esta versão do relatório foi gerada em Markdown em vez de Word (.docx) — a geração de .docx neste ambiente depende de instalar um pacote (`docx` via npm) e o sandbox não tem acesso à internet para isso (mesma restrição de rede que já impede `git push` direto daqui). Se quiser o relatório em .docx, me avise e explico a única alternativa: você roda a conversão localmente, ou eu recrio o conteúdo direto num modelo de documento sem depender dessa biblioteca.*
