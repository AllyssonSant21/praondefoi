-- =====================================================================
--  Pra Onde Foi? · CONTAS FUNDADORAS
--  Pode rodar de novo sem problema. Não apaga nem altera nada do que já existe.
--
--  "Fundador" = quem ajudou desde o teste. Fica marcado para, quando houver
--  mensalidade, essas contas não pagarem. Só o administrador marca ou desmarca.
-- =====================================================================

alter table public.perfis add column if not exists fundador    boolean not null default false;
alter table public.perfis add column if not exists fundador_em timestamptz;

-- lista de contas do painel (agora com "fundador")
drop function if exists public.admin_listar();
create function public.admin_listar()
returns table (id uuid, email text, status text, is_admin boolean, criado_em timestamptz, nome text, fundador boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  return query select p.id, p.email, p.status, p.is_admin, p.criado_em, p.nome, p.fundador
                 from public.perfis p order by p.criado_em desc;
end $$;

-- marca ou desmarca uma conta como fundadora
create or replace function public.admin_definir_fundador(alvo uuid, sim boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  update public.perfis set fundador = coalesce(sim, false), fundador_em = case when sim then now() end where id = alvo;
  if not found then raise exception 'Conta não encontrada.'; end if;
end $$;

-- marca de uma vez todas as contas aprovadas de hoje como fundadoras (devolve quantas)
create or replace function public.admin_marcar_fundadores()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  update public.perfis set fundador = true, fundador_em = now()
   where status = 'aprovado' and not is_admin and not fundador;
  get diagnostics n = row_count;
  return n;
end $$;

-- a própria pessoa pode saber se é fundadora (para mostrar no app)
create or replace function public.sou_fundador()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select fundador from public.perfis where id = auth.uid()), false);
$$;

revoke all on function public.admin_listar() from public, anon;
revoke all on function public.admin_definir_fundador(uuid, boolean) from public, anon;
revoke all on function public.admin_marcar_fundadores() from public, anon;
revoke all on function public.sou_fundador() from public, anon;
grant execute on function public.admin_listar() to authenticated;
grant execute on function public.admin_definir_fundador(uuid, boolean) to authenticated;
grant execute on function public.admin_marcar_fundadores() to authenticated;
grant execute on function public.sou_fundador() to authenticated;
