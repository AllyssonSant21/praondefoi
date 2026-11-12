-- =====================================================================
--  Pra Onde Foi? · TEMA SALVO NO PERFIL
--  Rodar no HMG (e no prod quando for pra lá). Pode rodar de novo sem problema.
--
--  O tema claro/escuro fica guardado na conta: escolheu escuro no computador,
--  o celular também abre escuro.
-- =====================================================================

alter table public.perfis add column if not exists tema text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'perfis_tema_ok') then
    alter table public.perfis add constraint perfis_tema_ok check (tema is null or tema in ('claro', 'escuro'));
  end if;
end $$;

-- a pessoa guarda o próprio tema
create or replace function public.definir_tema(p_tema text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if p_tema not in ('claro', 'escuro') then raise exception 'Tema inválido.'; end if;
  update public.perfis set tema = p_tema where id = auth.uid();
end $$;

-- a pessoa lê o próprio tema
create or replace function public.meu_tema()
returns text language sql stable security definer set search_path = public as $$
  select tema from public.perfis where id = auth.uid();
$$;

revoke all on function public.definir_tema(text) from public, anon;
revoke all on function public.meu_tema() from public, anon;
grant execute on function public.definir_tema(text) to authenticated;
grant execute on function public.meu_tema() to authenticated;
