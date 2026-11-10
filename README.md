# Pra Onde Foi?

Controle financeiro simples, para você e para a sua casa.
Funciona no navegador do computador e do celular, e pode ser instalado como app
(Android: "Instalar app" · iPhone: Compartilhar → "Adicionar à Tela de Início").

## Como funciona
- **Site:** `index.html` (HTML + CSS + JavaScript, sem etapa de compilação).
- **Dados e login:** [Supabase](https://supabase.com). Cada pessoa só vê os próprios lançamentos.
- **Banco:** rode no SQL Editor do Supabase, nesta ordem:
  1. `supabase-setup.sql` — contas, aprovação e regras de segurança;
  2. `supabase-controles.sql` — controles compartilhados (casal/família).
  3. `supabase-tempo-real.sql` — atualização na hora entre as pessoas do mesmo controle.
  4. `supabase-contas.sql` — aba Contas a pagar (fixas, parceladas, divisão e pagamento parcial).
  5. `supabase-perfil.sql` — perfil (nome, foto, e-mail de aviso) e login com Google.
  6. `supabase-seguranca.sql` — e-mails mascarados, admin vê só o necessário, convite sem revelar usuários.
  7. `supabase-advisor.sql` — ajustes apontados pelo Security Advisor.
  8. `supabase-metas.sql` — Metas (viagem, reserva de emergência…). Versão de teste em /hmgbase/.
  9. `supabase-investimentos.sql` — Investimentos e taxas do Banco Central (ative pg_net e pg_cron antes).
  10. `supabase-modulos.sql` — o dono escolhe o que cada controle compartilha (rodar por último).
  11. `supabase-seguranca2.sql` — revisão de segurança: códigos de convite de 8 caracteres, saldo de meta protegido e gravação só pelas funções (rodar por último).
  12. `supabase-metas2.sql` — metas concluídas: "usei o dinheiro" e desfazer (rodar depois do supabase-metas.sql).
  13. `supabase-seguranca3.sql` — checklist OWASP/LGPD: "Excluir minha conta" pelo app, registro de eventos de segurança (180 dias) e senha temporária com mínimo de 8.
  14. `supabase-uso.sql` — painel de uso no portal admin: último acesso e quantidade de lançamentos por conta (sem valores).
  15. `supabase-categorias.sql` — categorias personalizadas por controle (ex.: Pet, Academia), com emoji; renomear atualiza os lançamentos.
  16. `supabase-cartoes.sql` — cartões de crédito (só apelido, banco, fechamento, vencimento e limite; nunca número, CVV ou senha), compras parceladas e pagamento da fatura.
  17. `supabase-cartoes2.sql` — cartões, parte 2: parcelado que já estava rolando antes do app e "saldo anterior" da fatura.
  18. `supabase-cartoes3.sql` — cartões, parte 3: compra antiga com a data de verdade (as parcelas que já venceram ficam de fora sozinhas).
  - `supabase-hmg-convidados.sql` — **só no HMG**: só e-mails da lista conseguem criar conta lá.
  19. `supabase-whatsapp.sql` — bot do WhatsApp (por enquanto só no HMG): ligar o número por um código e as funções que o bot usa. O código do bot fica em `supabase/functions/whatsapp-bot/`.
  20. `supabase-bot-telegram.sql` — o mesmo bot também no Telegram (por enquanto só no HMG). Código em `supabase/functions/telegram-bot/`; a fonte comum dos dois bots fica em `supabase/functions/_fonte/` (rodar `montar.py` depois de mudar).
  21. `supabase-bot2.sql` — bot, parte 2: pergunta o que faltou, cria e paga contas a pagar, desfazer de tudo.
  22. `supabase-bot3.sql` — bot, parte 3: corrigir pelo chat, confirmar na dúvida, aprender categorias por pessoa e guardar frases não entendidas (só com BOT_APRENDER=1). Testes do bot: `node --experimental-strip-types supabase/functions/_fonte/testes.ts`.
  23. `supabase-bot4.sql` — Detetive Grana: ligar o WhatsApp com um toque (celular opcional + código escondido na mensagem).
- **Projeto novo (ex.: banco de testes do HMG):** `supabase-hmg-tudo.sql` junta os 15 scripts na ordem; ative pg_net e pg_cron antes e rode uma vez só.
- **App instalável:** `manifest.webmanifest`, `sw.js` e a pasta `icons/`.
- **Marca:** pasta `logo/` (SVG e PNG).

## Conta master
A primeira conta criada vira a conta master (administração).
Ela só aprova, bloqueia e exclui contas — e não vê dados financeiros de ninguém.

## Controles compartilhados
- Cada pessoa tem o **"Meu controle"** (só ela vê).
- Dá para criar controles como **"Casa"** e chamar outras pessoas:
  pelo **usuário** (a pessoa aceita o convite) ou por um **código** que vale 48 horas.
- Todos os participantes veem e lançam; **só quem lançou pode apagar**.
- Quem sai deixa os lançamentos que fez no controle.
