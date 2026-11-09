-- =====================================================================
--  Pra Onde Foi? · HMG SÓ PARA CONVIDADOS
--  ⚠️  RODAR SÓ NO SUPABASE DO HMG (ocasqtkfzddskvguuwkr). NUNCA NO PROD.
--  Pode rodar de novo sem problema.
--
--  Só e-mails da lista conseguem criar conta no HMG (inclusive pelo Google).
--  Para liberar alguém:   insert into public.hmg_convidados (email) values ('pessoa@email.com');
--  Para tirar:            delete from public.hmg_convidados where email = 'pessoa@email.com';
--  Conta com usuário (sem e-mail): use 'nome@usuarios.local'.
-- =====================================================================

create table if not exists public.hmg_convidados (
  email     text primary key check (email = lower(btrim(email))),
  criado_em timestamptz not null default now()
);
alter table public.hmg_convidados enable row level security;      -- ninguém lê pelo app
revoke all on public.hmg_convidados from anon, authenticated;

insert into public.hmg_convidados (email) values ('allyson_pva@hotmail.com') on conflict do nothing;

create or replace function public.hmg_so_convidados()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.hmg_convidados where email = lower(btrim(coalesce(new.email, '')))) then
    raise exception 'Ambiente de testes só para convidados.';
  end if;
  return new;
end $$;
revoke all on function public.hmg_so_convidados() from public, anon, authenticated;

drop trigger if exists hmg_so_convidados on auth.users;
create trigger hmg_so_convidados before insert on auth.users
  for each row execute function public.hmg_so_convidados();

-- quem já tem conta no HMG e NÃO está na lista (para você bloquear ou excluir pelo painel master)
select u.email, u.created_at from auth.users u
 where not exists (select 1 from public.hmg_convidados c where c.email = lower(u.email))
 order by u.created_at;
