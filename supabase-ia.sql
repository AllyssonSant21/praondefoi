-- =====================================================================
--  Pra Onde Foi? · LEITURA POR IA (foto, print, PDF e áudio)
--  Rodar depois do supabase-bot6.sql. Pode rodar de novo sem problema.
--
--  Cada leitura de arquivo pela IA (Gemini) gasta 1 do saldo do mês.
--  Padrão: 30 leituras por mês por conta. O administrador muda o número de
--  qualquer conta no painel (vazio = volta ao padrão).
--  O arquivo NÃO é guardado: é lido e descartado.
-- =====================================================================

alter table public.perfis add column if not exists ia_limite int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'perfis_ia_limite_ok') then
    alter table public.perfis add constraint perfis_ia_limite_ok check (ia_limite is null or ia_limite between 0 and 2000);
  end if;
end $$;

create table if not exists public.ia_uso (
  user_id  uuid not null references auth.users(id) on delete cascade,
  mes      date not null,
  leituras int  not null default 0,
  primary key (user_id, mes)
);
alter table public.ia_uso enable row level security;   -- só pelas funções abaixo
revoke all on public.ia_uso from anon, authenticated;

-- padrão (mude aqui se quiser)
create or replace function public.ia_limite_mes() returns int language sql immutable as $$ select 30 $$;

create or replace function public.ia_limite_de(p_uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(p.ia_limite, public.ia_limite_mes()) from public.perfis p where p.id = p_uid;
$$;

-- gasta 1 leitura (só conta aprovada e com saldo). Devolve {ok, restam, limite} ou {erro}
create or replace function public.ia_consumir(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare lim int; n int;
begin
  if not exists (select 1 from public.perfis where id = p_uid and status = 'aprovado') then
    return jsonb_build_object('erro', 'nao_aprovado');
  end if;
  lim := coalesce(public.ia_limite_de(p_uid), public.ia_limite_mes());
  insert into public.ia_uso (user_id, mes, leituras) values (p_uid, public.bot_mes_atual(), 0) on conflict do nothing;
  update public.ia_uso set leituras = leituras + 1
   where user_id = p_uid and mes = public.bot_mes_atual() and leituras < lim
  returning leituras into n;
  if n is null then return jsonb_build_object('erro', 'sem_saldo', 'limite', lim); end if;
  return jsonb_build_object('ok', true, 'restam', lim - n, 'limite', lim);
end $$;

-- devolve 1 leitura (quando a IA falhou e a pessoa não recebeu nada)
create or replace function public.ia_devolver(p_uid uuid)
returns void language sql security definer set search_path = public as $$
  update public.ia_uso set leituras = greatest(leituras - 1, 0) where user_id = p_uid and mes = public.bot_mes_atual();
$$;

-- o bot usa o número/Telegram para achar a conta
create or replace function public.ia_consumir_wa(p_wa text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select user_id into uid from public.whatsapp_vinculos where wa_id = p_wa;
  if uid is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  return public.ia_consumir(uid) || jsonb_build_object('user_id', uid);
end $$;

-- para o app: quanto a pessoa já usou este mês
create or replace function public.ia_meu_saldo()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('usadas', coalesce((select leituras from public.ia_uso where user_id = auth.uid() and mes = public.bot_mes_atual()), 0),
                            'limite', coalesce(public.ia_limite_de(auth.uid()), public.ia_limite_mes()));
$$;

-- painel: lista de contas agora com o saldo da IA também
drop function if exists public.admin_listar();
create function public.admin_listar()
returns table (id uuid, email text, status text, is_admin boolean, criado_em timestamptz, nome text, fundador boolean,
               wa_limite int, wa_padrao int, wa_usadas int, ia_limite int, ia_padrao int, ia_usadas int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  return query select p.id, p.email, p.status, p.is_admin, p.criado_em, p.nome, p.fundador,
                      p.wa_limite, case when p.fundador then public.bot_limite_fundador() else public.bot_limite_mes() end,
                      coalesce((select b.respostas from public.bot_uso b where b.user_id = p.id and b.mes = public.bot_mes_atual()), 0),
                      p.ia_limite, public.ia_limite_mes(),
                      coalesce((select i.leituras from public.ia_uso i where i.user_id = p.id and i.mes = public.bot_mes_atual()), 0)
                 from public.perfis p order by p.criado_em desc;
end $$;

create or replace function public.admin_definir_ia_limite(alvo uuid, p_limite int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  if p_limite is not null and p_limite not between 0 and 2000 then raise exception 'Use um número de 0 a 2000.'; end if;
  update public.perfis set ia_limite = p_limite where id = alvo;
  if not found then raise exception 'Conta não encontrada.'; end if;
end $$;

revoke all on function public.ia_meu_saldo() from public, anon;
revoke all on function public.admin_listar() from public, anon;
revoke all on function public.admin_definir_ia_limite(uuid, int) from public, anon;
grant execute on function public.ia_meu_saldo() to authenticated;
grant execute on function public.admin_listar() to authenticated;
grant execute on function public.admin_definir_ia_limite(uuid, int) to authenticated;
do $$
declare f text;
begin
  foreach f in array array['ia_limite_de(uuid)', 'ia_consumir(uuid)', 'ia_devolver(uuid)', 'ia_consumir_wa(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;
