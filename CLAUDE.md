# Contexto do projeto (leia antes de mexer)

App **Pra Onde Foi?**: controle financeiro em PWA (HTML/CSS/JS puro, sem build), Supabase (RLS, funções security definer, Edge Functions em Deno) e GitHub Pages.

- **Prod:** https://praondefoiapp.com.br/ — arquivos na raiz do repositório. Supabase `syffvgczgukoickcprni`.
- **HMG (testes):** https://praondefoiapp.com.br/hmgbase/ — pasta `hmgbase/`. Supabase `ocasqtkfzddskvguuwkr`.

## Regras do dono (sempre)
- Toda mudança vai **primeiro para o HMG**. Prod só quando ele disser "manda pro prod".
- **Mudança visual: mandar imagem (prévia) antes de aplicar** e esperar o ok. Enquanto espera, guardar num ramo `previa-…` (o ramo `main` publica na hora).
- Ideia nova: conversar antes de construir quando ele pedir.
- Botões com cantos pouco arredondados (sem "pílula"). Texto em português correto.
- **Nunca pedir dados de cartão ou banco.** Ele cadastra cartão direto nos sites.
- **Segredos nunca vêm pro chat:** Turnstile, Resend, token do WhatsApp/Meta, chaves Anthropic/OpenAI, token do Telegram, `GEMINI_KEY`, `TG_SECRET`. Vão direto nos Secrets do Supabase.
- Não salvar o SQL de reset de senha. `supabase-hmg-convidados.sql` é **só HMG**.
- Commits terminam com as linhas de coautoria que o ambiente indicar.

## Como publicar
1. Editar em `hmgbase/` (app.js, index.html). Subir o cache: `app.js?v=N` (hoje **v132**) e `entender.js?v=N` (hoje **v3**) no `hmgbase/index.html`.
2. `python3 ferramentas/rotas.py hmgbase` (copia o index para as pastas das abas: lancamentos/, cartoes/, contas/, metas/, investimentos/).
3. Commit + push em `main` → HMG no ar.
4. Prod (só com ok): rodar da raiz `python3 ferramentas/promover.py` (gera index/app/privacidade/termos/tema.js/entender.js do prod, troca banco e chaves, tira os blocos `<!--BOT-->…<!--/BOT-->` da capa, põe o bot `@Praondefoi_bot`) → commit + push.

## Bot "Detetive Grana" e IA
- Fonte comum: `supabase/functions/_fonte/` (`nucleo.ts` + `telegram.ts` / `whatsapp.ts` / `leitor.ts`). **Não editar** `supabase/functions/*/index.ts` à mão: rodar `python3 supabase/functions/_fonte/montar.py` (gera as 3 funções e o `hmgbase/entender.js`).
- Testes: `node --experimental-strip-types supabase/functions/_fonte/testes.ts` (97 testes, 0 falhas).
- O dono cola o `index.ts` gerado no editor do Supabase (aba Code → Deploy). **Verify JWT desligado** em telegram-bot e leitor. No HMG a função do Telegram chama "Telegram-bot" mas o endereço é `/bright-handler`.
- IA: Gemini `gemini-3.5-flash-lite` (principal) e `gemini-3.8-flash` (reserva); os 2.5 não aceitam projetos novos. Hoje usa a chave **grátis** (só o dono e um sócio testam no prod). Antes de abrir para usuários: plano pago + limite de gasto.
- Foto/PDF/áudio lido com clareza é **lançado direto** (pede confirmação só se a IA ficar em dúvida). Nome da loja; nunca cidade/endereço (vira "Compras de mercado", "Compras diversas"...).
- Lançamentos do bot guardam `origem` (telegram, whatsapp, telegram_ia, whatsapp_ia) e o app mostra um 🤖 com a explicação.
- WhatsApp: ainda **sem número** (Meta não liberou) → aparece "Em breve". Telegram e WhatsApp podem ficar ligados juntos (um de cada).
- **Liberação por conta:** o admin liga IA, Detetive e Fundador no **⋮** de cada conta no painel. Quem não foi liberado não vê nada, e o banco recusa. Admin sempre tem tudo.

## Planos e limites decididos
- **Decidido em 14/11/2026:** plano **único de R$ 15,90/mês** (app + Telegram sem limite + WhatsApp + IA). Substitui Básico/Completo.
- WhatsApp: **120 respostas/mês** por pessoa (licença) (conta respostas do bot, não só lançamentos; zera dia 1º). IA: 30 leituras/mês. Admin ajusta por conta. Banco: `supabase-limite120.sql` (fundador também 120).
- **Licenças (ideia aprovada, falta construir):** a pessoa escolhe quantas pessoas vão usar. 1 pessoa = R$ 15,90; 2 ou mais = **R$ 12,95 por pessoa** (≈18,6% de desconto; 2 = R$ 25,90, 3 = R$ 38,85, 4 = R$ 51,80). O assinante adiciona o e-mail de cada pessoa. No Stripe: um produto só, preço por volume (1 unid. 15,90; 2+ unid. 12,95 cada) com quantidade = licenças.
- **Adicional (decidido):** R$ 4,90/mês somado à assinatura (mesma fatura), dá **+60 respostas no WhatsApp e +30 leituras de IA** por mês. A pessoa liga/desliga quando quiser. No Stripe: produto "Adicional" recorrente mensal R$ 4,90 (item extra na assinatura).
- **Teste grátis (decidido):** 7 dias **sem pedir cartão** (controlado no nosso banco, Stripe só entra ao assinar), só **app + Telegram** (sem WhatsApp e sem IA). Ao acabar, aparece a **tela de preços** para assinar. Na tela **Limites**, botão para contratar o **Adicional**. (Telas: mandar prévia antes de construir.)
- Cobrança: Stripe. Área restrita (teste) com 2 produtos (15/11): "Pra Onde Foi?" (volume: 1 = 15,90; 2+ = 12,95/unid., chave de pesquisa `pof_licenca_mensal`) e "Pra Onde Foi? Adicional" (4,90/mês, chave `pof_adicional_mensal`). Usar as chaves de pesquisa no código (iguais na produção). Pagamento numa tela nossa com os campos do Stripe (Payment Element); cartão nunca passa pelo app. Chaves `sk_…`/`whsec_…` só nos Secrets do Supabase. Tarifas (nov/2026): cartão 3,99% + R$ 0,39, Pix 1,19%, Billing 0,7%.

## O que existe hoje (13/11/2026)
- Capa nova clara e centralizada (faixa "Mandou? Está lançado." e card do Detetive só no HMG).
- Categoria padrão **Alimentação** (🍽️) com palavras de comida; "Para onde foi" filtra a lista ao clicar numa categoria.
- "Lançar rápido" em destaque: **Foto, PDF ou áudio** (só com IA liberada) e **Extrato do banco**. A opção de escrever/falar foi tirada (no app se lança direto pelo formulário).
- Menu: item **Limites**; **ponte** entre a conta do dono e a conta master (duas sessões guardadas no aparelho: "Ir para minha conta" ↔ "Painel do administrador").
- Janela do Detetive compacta (cabe na tela sem zoom).
- **Visual estilo painel do Stripe (no HMG e no prod desde 16/11, v124):** letra Inter, bordas finas, cantos 6–8px; menu lateral com o seletor de controle no topo e seção "Conta" (Detetive Grana, Limites); barra do topo com busca de lançamentos; 4 números numa faixa (inclui Contas a pagar); no computador largo, lista à esquerda e formulário + "Para onde foi" à direita.
- **HMG e prod (16/11, v132):** Lançar rápido numa caixa própria (fora do Novo lançamento); sem o botão "+ Novo lançamento" do topo; seletor de controle com logo maior (seta só com 2+ controles); botão **Detalhes** no "Para onde foi" abre janela com total, média/dia, comparação com o mês anterior, rosca por categoria, tabela e gasto por semana/dia; app mais leve (planilha só ao exportar, sem Rubik, service worker novo `hmgbase/sw.js` copiado para a raiz pelo promover).
- **Dívidas (HMG e prod desde 16/11):** tocar numa dívida abre o resumo com "O que aconteceu?" (Quitei, Fechei um acordo, Paguei uma parte, Estou negociando; em Pagando: Quitei antes, Atrasei, Renegociei) e o histórico.

## SQL (ordem no README.md, itens 19 a 36)
- Prod rodou (16/11) a versão nova do `supabase-dividas.sql`, o `supabase-dividas2.sql` e o `supabase-limite120.sql`. HMG tem tudo até o `supabase-dividas2.sql`; conferir se o `supabase-limite120.sql` rodou no HMG.
- Prod rodou `supabase-alimentacao.sql` e o `supabase-prod-detetive-ia.sql` (junta whatsapp, bot-telegram, bot2…bot8, ia e liberacoes; pode rodar de novo).
- Banco novo de testes: `supabase-hmg-tudo.sql`.

## Pendências
- WhatsApp: esperar a Meta; depois pôr o número em `WA_BOT` (app.js) e criar a função whatsapp-bot.
- Gemini pago antes de usuários de verdade (e revisar a política de privacidade se continuar no grátis).
- Ideias guardadas: IA para textos que o bot não entende, revisão geral de UX (ícones em vez de emoji, toques de 44px).
- Ramos `previa-filtro-categoria`, `previa-admin-liberacoes`, `previa-ponte-admin` ficaram no GitHub (sem permissão para apagar daqui); podem ser apagados.

## Testes locais (não ficam no repositório)
A sessão anterior usava Postgres + PostgREST locais e scripts Playwright em `/var/tmp/pgt` (somem quando o ambiente é recriado). Se não existirem, testar com um servidor estático (`python3 -m http.server`) e conferir no HMG.
