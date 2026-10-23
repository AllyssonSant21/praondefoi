-- =====================================================================
--  Controle Financeiro · configuração do banco no Supabase
--  Cole tudo no SQL Editor do seu projeto e clique em "Run".
--  Pode rodar de novo sem problema (não apaga dados).
-- =====================================================================

-- 1) PERFIS: uma linha por pessoa cadastrada (só e-mail e situação)
create table if not exists public.perfis (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  status     text not null default 'pendente'
             check (status in ('pendente','aprovado','bloqueado')),
  is_admin   boolean not null default false,
  criado_em  timestamptz not null default now()
);

-- 2) LANÇAMENTOS: os dados financeiros de cada pessoa
create table if not exists public.lancamentos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo       text not null check (tipo in ('exp','inc')),
  descricao  text not null check (char_length(descricao) between 1 and 200),
  categoria  text not null check (char_length(categoria) between 1 and 60),
  valor      numeric(12,2) not null check (valor > 0),
  data       date not null,
  criado_em  timestamptz not null default now()
);
create index if not exists lancamentos_user_data_idx on public.lancamentos (user_id, data);

-- 3) FUNÇÕES DE APOIO (usadas pelas regras de acesso)
create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.perfis where id = auth.uid()), false);
$$;

create or replace function public.eh_aprovado()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'aprovado' from public.perfis where id = auth.uid()), false);
$$;

-- 4) TODA CONTA NOVA vira um perfil "pendente".
--    A PRIMEIRA conta criada no app vira o administrador, já aprovada.
create or replace function public.ao_criar_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  primeiro boolean;
begin
  select not exists (select 1 from public.perfis where is_admin) into primeiro;
  insert into public.perfis (id, email, status, is_admin)
  values (new.id, new.email,
          case when primeiro then 'aprovado' else 'pendente' end,
          primeiro)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.ao_criar_usuario();

-- 5) REGRAS DE ACESSO (Row Level Security)
alter table public.perfis      enable row level security;
alter table public.lancamentos enable row level security;

-- Perfis: cada um vê o próprio; o admin vê a lista (e-mail e situação).
-- Ninguém altera perfis direto: mudanças passam pelas funções de admin abaixo.
drop policy if exists "perfis_ler" on public.perfis;
create policy "perfis_ler" on public.perfis
  for select to authenticated
  using (id = auth.uid() or public.eh_admin());

-- Lançamentos: SÓ o dono, e só se estiver aprovado.
-- Não existe regra para o admin aqui, então ele NÃO consegue ver
-- os lançamentos de ninguém além dos próprios.
drop policy if exists "lanc_ler"     on public.lancamentos;
drop policy if exists "lanc_criar"   on public.lancamentos;
drop policy if exists "lanc_editar"  on public.lancamentos;
drop policy if exists "lanc_apagar"  on public.lancamentos;

create policy "lanc_ler" on public.lancamentos
  for select to authenticated
  using (user_id = auth.uid() and public.eh_aprovado());

create policy "lanc_criar" on public.lancamentos
  for insert to authenticated
  with check (user_id = auth.uid() and public.eh_aprovado());

create policy "lanc_editar" on public.lancamentos
  for update to authenticated
  using (user_id = auth.uid() and public.eh_aprovado())
  with check (user_id = auth.uid() and public.eh_aprovado());

create policy "lanc_apagar" on public.lancamentos
  for delete to authenticated
  using (user_id = auth.uid() and public.eh_aprovado());

-- 6) AÇÕES DO ADMINISTRADOR
create or replace function public.admin_mudar_status(alvo uuid, novo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  if alvo = auth.uid() then raise exception 'Você não pode alterar o próprio acesso.'; end if;
  if novo not in ('pendente','aprovado','bloqueado') then raise exception 'Situação inválida.'; end if;
  update public.perfis set status = novo where id = alvo;
end $$;

-- Exclui a conta e, junto, todos os lançamentos dela (sem que o admin os veja).
create or replace function public.admin_excluir_usuario(alvo uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  if alvo = auth.uid() then raise exception 'Você não pode excluir a própria conta por aqui.'; end if;
  delete from auth.users where id = alvo;
end $$;

-- 7) PERMISSÕES EXPLÍCITAS
--    (necessárias quando "Expor automaticamente novas tabelas" está desmarcado)
--    Visitantes não logados (anon) não acessam nada; usuários logados
--    só têm acesso ao que as regras de RLS acima permitem.
grant usage on schema public to authenticated;
revoke all on public.perfis, public.lancamentos from anon;
grant select on public.perfis to authenticated;
grant select, insert, update, delete on public.lancamentos to authenticated;
revoke all on function public.eh_admin()    from public, anon;
revoke all on function public.eh_aprovado() from public, anon;
grant execute on function public.eh_admin()    to authenticated;
grant execute on function public.eh_aprovado() to authenticated;

revoke all on function public.admin_mudar_status(uuid, text) from public, anon;
revoke all on function public.admin_excluir_usuario(uuid)    from public, anon;
grant execute on function public.admin_mudar_status(uuid, text) to authenticated;
grant execute on function public.admin_excluir_usuario(uuid)    to authenticated;

-- 8) SENHA TEMPORÁRIA (para quem entra com nome de usuário e esqueceu a senha)
create extension if not exists pgcrypto with schema extensions;

create or replace function public.admin_definir_senha(alvo uuid, nova text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  if alvo = auth.uid() then raise exception 'Para a sua própria senha, use "Trocar senha".'; end if;
  if char_length(coalesce(nova,'')) < 6 then raise exception 'A senha precisa ter pelo menos 6 caracteres.'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(nova, extensions.gen_salt('bf')),
         updated_at = now()
   where id = alvo;
end $$;

revoke all on function public.admin_definir_senha(uuid, text) from public, anon;
grant execute on function public.admin_definir_senha(uuid, text) to authenticated;
