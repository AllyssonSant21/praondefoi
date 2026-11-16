-- =====================================================================
--  Pra Onde Foi? · LIMITE DO WHATSAPP: 120 RESPOSTAS POR MÊS
--  Rodar depois do supabase-bot6.sql (ou do supabase-prod-detetive-ia.sql). Pode rodar de novo.
--
--  Padrão novo: 120 respostas do Detetive no WhatsApp por pessoa, por mês
--  (fundador também 120). Quem tem um número definido pelo administrador
--  no painel continua com o número dele. Telegram segue sem limite.
-- =====================================================================
create or replace function public.bot_limite_mes()      returns int language sql immutable as $$ select 120 $$;
create or replace function public.bot_limite_fundador() returns int language sql immutable as $$ select 120 $$;
notify pgrst, 'reload schema';
