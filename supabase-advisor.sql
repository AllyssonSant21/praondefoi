-- Pra Onde Foi? · correções apontadas pelo Security Advisor do Supabase (pode rodar de novo)
alter function public.conta_ocorre(text, date, int, date, date) set search_path = '';
alter function public.login_publico(text) set search_path = '';
revoke all on function public.ao_criar_usuario() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_proc where proname = 'rls_auto_enable' and pronamespace = 'public'::regnamespace) then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
