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
- **Segredos nunca vêm pro chat:** Turnstile, Resend, token do WhatsApp/Meta, chaves Anthropic/OpenAI, token do Telegram, `GEMINI_KEY`, `TG_SECRET`, `RESEND_KEY`. Vão direto nos Secrets do Supabase.
- Não salvar o SQL de reset de senha. `supabase-hmg-convidados.sql` é **só HMG**.
- Commits terminam com as linhas de coautoria que o ambiente indicar.

## Como publicar
1. Editar em `hmgbase/` (app.js, index.html). Subir o cache: `app.js?v=N` (hoje **v143**) e `entender.js?v=N` (hoje **v4**) no `hmgbase/index.html`.
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
- **Aviso de aparelho novo (HMG v133; prod desde 16/11):** o app guarda um código por navegador (`pof-aparelho`) e chama `registrar_aparelho`; se é novo e não é o primeiro, chama a função `supabase/functions/aviso-login/index.ts` (Verify JWT LIGADO, independente do montar.py), que manda e-mail pela Resend (segredo `RESEND_KEY`; `APP_URL`/`APP_ORIGENS` no HMG). Só nome do aparelho e datas são guardados (sem IP/cidade). HMG e prod configurados em 16/11 (SQL + função + `RESEND_KEY`; no prod a chave da Resend é separada da do HMG).
- **Liberação por conta:** o admin liga IA, Detetive e Fundador no **⋮** de cada conta no painel. Quem não foi liberado não vê nada, e o banco recusa. Admin sempre tem tudo.

## Planos e limites decididos
- **Decidido em 14/11/2026:** plano **único de R$ 15,90/mês** (app + Telegram sem limite + WhatsApp + IA). Substitui Básico/Completo.
- WhatsApp: **120 respostas/mês** por pessoa (licença) (conta respostas do bot, não só lançamentos; zera dia 1º). IA: 30 leituras/mês. Admin ajusta por conta. Banco: `supabase-limite120.sql` (fundador também 120).
- **Licenças (ideia aprovada, falta construir):** a pessoa escolhe quantas pessoas vão usar. 1 pessoa = R$ 15,90; 2 ou mais = **R$ 12,95 por pessoa** (≈18,6% de desconto; 2 = R$ 25,90, 3 = R$ 38,85, 4 = R$ 51,80). O assinante adiciona o e-mail de cada pessoa. No Stripe: um produto só, preço por volume (1 unid. 15,90; 2+ unid. 12,95 cada) com quantidade = licenças.
- **Adicional (decidido):** R$ 4,90/mês somado à assinatura (mesma fatura), dá **+60 respostas no WhatsApp e +30 leituras de IA** por mês. A pessoa liga/desliga quando quiser. No Stripe: produto "Adicional" recorrente mensal R$ 4,90 (item extra na assinatura).
- **Teste grátis (decidido):** 7 dias **sem pedir cartão** (controlado no nosso banco, Stripe só entra ao assinar), só **app + Telegram** (sem WhatsApp e sem IA). Ao acabar, aparece a **tela de preços** para assinar. Na tela **Limites**, botão para contratar o **Adicional**. (Telas: mandar prévia antes de construir.)
- Cobrança: Stripe. Área restrita (teste) com 2 produtos (15/11): "Pra Onde Foi?" (volume: 1 = 15,90; 2+ = 12,95/unid., chave de pesquisa `pof_licenca_mensal`) e "Pra Onde Foi? Adicional" (4,90/mês, chave `pof_adicional_mensal`). Usar as chaves de pesquisa no código (iguais na produção). Pagamento numa tela nossa com os campos do Stripe (Payment Element); cartão nunca passa pelo app. Chaves `sk_…`/`whsec_…` só nos Secrets do Supabase. Tarifas (nov/2026): cartão 3,99% + R$ 0,39, Pix 1,19%, Billing 0,7%.

## O que existe hoje (13/11/2026)
- **Capa nova (HMG v136; prod desde 16/11, v141):** fundo contínuo (marinho #0E1525 no escuro, branco no claro, amarelo #FED13D), marca d'água de dados + "?" grande, título "Descubra / pra onde foi / seu dinheiro?" (Rubik 900 com volume 3D + Yellowtail), celular 3D com print real do app (`logo/capa-app-claro|escuro.webp`), login à direita; seção "Mandou? Está lançado." sem caixas (mensagens soltas → papel "Seus lançamentos" com carimbo). Classes `cv-*`. Os 3 blocos `<!--BOT-->` agora são: "ou por mensagem" no subtítulo, a bolha no celular e a seção Mandou.
- Categoria padrão **Alimentação** (🍽️) com palavras de comida; "Para onde foi" filtra a lista ao clicar numa categoria.
- "Lançar rápido" em destaque: **Foto, PDF ou áudio** (só com IA liberada) e **Extrato do banco**. A opção de escrever/falar foi tirada (no app se lança direto pelo formulário).
- Menu: item **Limites**; **ponte** entre a conta do dono e a conta master (duas sessões guardadas no aparelho: "Ir para minha conta" ↔ "Painel do administrador").
- Janela do Detetive compacta (cabe na tela sem zoom).
- **Visual estilo painel do Stripe (no HMG e no prod desde 16/11, v124):** letra Inter, bordas finas, cantos 6–8px; menu lateral com o seletor de controle no topo e seção "Conta" (Detetive Grana, Limites); barra do topo com busca de lançamentos; 4 números numa faixa (inclui Contas a pagar); no computador largo, lista à esquerda e formulário + "Para onde foi" à direita.
- **HMG e prod (16/11, v132):** Lançar rápido numa caixa própria (fora do Novo lançamento); sem o botão "+ Novo lançamento" do topo; seletor de controle com logo maior (seta só com 2+ controles); botão **Detalhes** no "Para onde foi" abre janela com total, média/dia, comparação com o mês anterior, rosca por categoria, tabela e gasto por semana/dia; app mais leve (planilha só ao exportar, sem Rubik, service worker novo `hmgbase/sw.js` copiado para a raiz pelo promover).
- **Importar fatura do cartão (HMG v137; prod desde 16/11, v141):** botão grande "Importar fatura" ao lado de "Lançar compra no cartão" (aba Cartões). Leitor novo colado no HMG e no prod (16/11). CSV/OFX lido no aparelho; PDF/foto pela função `leitor` com `modo: 'fatura'` (gasta 1 leitura, só IA liberada; precisa do leitor novo colado no Supabase). Reconhece "PARC 03/10", "Parcela 2/6", "3 DE 4"; parcelada entra com `parcela_ini` = parcela atual na fatura escolhida (data da 1ª parcela recalculada para trás). Estorno e pagamento vêm desmarcados (estorno: usar Ajustar). Duplicadas desmarcadas. Nada salva antes de "Adicionar". Botão "Como funciona" (símbolo do app) abre um balão com os passos e o que gasta IA (CSV/OFX não gasta; PDF/foto gasta 1).
- **Estilo da capa dentro do app (HMG v137; prod desde 16/11):** Rubik, escuro em marinho #0E1525 (claro branco), brilho amarelo e "?" de marca d'água fixo, título da página com leve 3D.
- **HMG e prod (16/11, v141):** mês (‹ Nov 2026 ›) e olho ficam na barra do topo, fixa ao rolar (celular e computador; `html,body{overflow-x:clip}` para o sticky funcionar). Botão **Detalhes** também em Cartões ("No que gastou") e Contas a pagar (`openGraficoMes(fonte)`: lanc/cartoes/contas). Selo HMG embaixo à direita.
- **Balão de parcela (HMG e prod 17/11, v142):** em Lançamentos e Contas a pagar a parcela aparece num balão ao lado do nome (`8/12`, cinza); na última, balão verde "Última parcela". O banco continua gravando " 8/12" no fim do nome (pagar_conta e bot); o app separa na hora de mostrar (`parcelaDoNome`, `parcelaTag`).
- **Botões de criar padronizados (HMG 17/11, v143; prod ainda não):** Nova conta, Nova dívida, Nova meta e Novo investimento no padrão de "Lançar compra no cartão" (`kc-nova-row` + `kc-nova`, abaixo dos números do topo; `ctNovaRow` some no modo Dívidas).
- **Dívidas (HMG e prod desde 16/11):** tocar numa dívida abre o resumo com "O que aconteceu?" (Quitei, Fechei um acordo, Paguei uma parte, Estou negociando; em Pagando: Quitei antes, Atrasei, Renegociei) e o histórico.

## SQL (ordem no README.md, itens 19 a 37)
- Prod rodou (16/11) a versão nova do `supabase-dividas.sql`, o `supabase-dividas2.sql` e o `supabase-limite120.sql`. HMG tem tudo até o `supabase-dividas2.sql`; conferir se o `supabase-limite120.sql` rodou no HMG.
- Prod rodou `supabase-alimentacao.sql` e o `supabase-prod-detetive-ia.sql` (junta whatsapp, bot-telegram, bot2…bot8, ia e liberacoes; pode rodar de novo).
- Banco novo de testes: `supabase-hmg-tudo.sql`.

## Pendências
- Cobrança (Stripe) ainda **não construída**: fazer no HMG com botão grande do admin para ligar/desligar cobranças; mandar prévia das telas (preços, pagamento, Adicional em Limites) antes.
- Prévia esperando ok: ramo `previa-limites-explicados` (caixa explicando todos os limites na tela Limites, como era antes).
- Importar fatura: o dono mandou um CSV com parceladas que entraram à vista; corrigido em v139 (procura a parcela em qualquer coluna). Esperando ele confirmar; se falhar, perguntar só o banco e como a parcela aparece (nunca pedir o arquivo com dados).
- WhatsApp: esperar a Meta; depois pôr o número em `WA_BOT` (app.js) e criar a função whatsapp-bot.
- Gemini pago antes de usuários de verdade (e revisar a política de privacidade se continuar no grátis).
- Ideias guardadas: IA para textos que o bot não entende, revisão geral de UX (ícones em vez de emoji, toques de 44px).
- Ramos `previa-filtro-categoria`, `previa-admin-liberacoes`, `previa-ponte-admin`, `previa-parcela-balao`, `previa-botoes-padrao` ficaram no GitHub (sem permissão para apagar daqui); podem ser apagados.

## Testes locais (não ficam no repositório)
A sessão anterior usava Postgres + PostgREST locais e scripts Playwright em `/var/tmp/pgt` (somem quando o ambiente é recriado). Se não existirem, testar com um servidor estático (`python3 -m http.server`) e conferir no HMG.
