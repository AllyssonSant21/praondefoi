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
1. Editar em `hmgbase/` (app.js, index.html). Subir o cache: `app.js?v=N` (hoje **v119**) e `entender.js?v=N` (hoje **v3**) no `hmgbase/index.html`.
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
- Básico R$ 12,90 (app + Telegram) · Completo R$ 17,90 (+ WhatsApp).
- WhatsApp: 300 respostas/mês (fundador 150), acumulado no mês, zera dia 1º. IA: 30 leituras/mês. Admin ajusta por conta.

## O que existe hoje (13/11/2026)
- Capa nova clara e centralizada (faixa "Mandou? Está lançado." e card do Detetive só no HMG).
- Categoria padrão **Alimentação** (🍽️) com palavras de comida; "Para onde foi" filtra a lista ao clicar numa categoria.
- "Lançar rápido" em destaque: **Foto, PDF ou áudio** (só com IA liberada) e **Extrato do banco**. A opção de escrever/falar foi tirada (no app se lança direto pelo formulário).
- Menu: item **Limites**; **ponte** entre a conta do dono e a conta master (duas sessões guardadas no aparelho: "Ir para minha conta" ↔ "Painel do administrador").
- Janela do Detetive compacta (cabe na tela sem zoom).

## SQL (ordem no README.md, itens 19 a 33)
- HMG já tem tudo até `supabase-liberacoes.sql`; `supabase-dividas.sql` rodou no HMG e no prod (o app do prod ainda não tem a tela de Dívidas).
- Prod rodou `supabase-alimentacao.sql` e o `supabase-prod-detetive-ia.sql` (junta whatsapp, bot-telegram, bot2…bot8, ia e liberacoes; pode rodar de novo).
- Banco novo de testes: `supabase-hmg-tudo.sql`.

## Pendências
- WhatsApp: esperar a Meta; depois pôr o número em `WA_BOT` (app.js) e criar a função whatsapp-bot.
- Gemini pago antes de usuários de verdade (e revisar a política de privacidade se continuar no grátis).
- Ideias guardadas: cobrança/assinatura, IA para textos que o bot não entende, revisão geral de UX (ícones em vez de emoji, toques de 44px).
- Ramos `previa-filtro-categoria`, `previa-admin-liberacoes`, `previa-ponte-admin` ficaram no GitHub (sem permissão para apagar daqui); podem ser apagados.

## Testes locais (não ficam no repositório)
A sessão anterior usava Postgres + PostgREST locais e scripts Playwright em `/var/tmp/pgt` (somem quando o ambiente é recriado). Se não existirem, testar com um servidor estático (`python3 -m http.server`) e conferir no HMG.
