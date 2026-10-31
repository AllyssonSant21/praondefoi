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
  8. `supabase-metas.sql` — Metas (viagem, reserva de emergência…). Versão de teste em /hmg/.
  9. `supabase-investimentos.sql` — Investimentos e taxas do Banco Central (ative pg_net e pg_cron antes).
  10. `supabase-modulos.sql` — o dono escolhe o que cada controle compartilha (rodar por último).
  11. `supabase-seguranca2.sql` — revisão de segurança: códigos de convite de 8 caracteres, saldo de meta protegido e gravação só pelas funções (rodar por último).
- **Projeto novo (ex.: banco de testes do HMG):** `supabase-hmg-tudo.sql` junta os 11 scripts na ordem; ative pg_net e pg_cron antes e rode uma vez só.
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
