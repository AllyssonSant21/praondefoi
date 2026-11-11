-- =====================================================================
--  Pra Onde Foi? · DESPERTADOR
--  Rodar no HMG e no PROD (uma vez em cada). Pode rodar de novo sem problema.
--
--  O Supabase grátis pausa o projeto depois de 7 dias sem uso. Um robô do
--  GitHub chama esta função uma vez por dia para contar como uso.
--  Ela não lê nem grava nenhum dado: só responde "ok".
-- =====================================================================

create or replace function public.despertar()
returns text language sql stable set search_path = public as $$
  select 'ok'::text;
$$;
revoke all on function public.despertar() from public;
grant execute on function public.despertar() to anon, authenticated;
