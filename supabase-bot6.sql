-- =====================================================================
--  Pra Onde Foi? · BOT, PARTE 6 · SALDO DO WHATSAPP POR CONTA
--  Rodar depois do supabase-bot5.sql e do supabase-fundador.sql. Pode rodar de novo.
--
--  Quanto cada pessoa pode usar o Detetive no WhatsApp por mês:
--    assinante do Completo → 300 respostas · fundador → 150 respostas
--  O administrador pode mudar o número de qualquer conta no painel
--  (vazio = volta para o padrão).
-- =====================================================================

alter table public.perfis add column if not exists wa_limite int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'perfis_wa_limite_ok') then
    alter table public.perfis add constraint perfis_wa_limite_ok check (wa_limite is null or wa_limite between 0 and 3000);
  end if;
end $$;

-- padrões (mude aqui se quiser)
create or replace function public.bot_limite_mes()      returns int language sql immutable as $$ select 300 $$;
create or replace function public.bot_limite_fundador() returns int language sql immutable as $$ select 150 $$;

-- saldo de uma conta: o número que o admin definiu, senão o padrão (fundador ou assinante)
create or replace function public.bot_limite_de(p_uid uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(p.wa_limite, case when p.fundador then public.bot_limite_fundador() else public.bot_limite_mes() end)
    from public.perfis p where p.id = p_uid;
$$;

create or replace function public.bot_saldo(p_wa text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid; u public.bot_uso%rowtype; lim int;
begin
  select user_id into uid from public.whatsapp_vinculos where wa_id = p_wa;
  if uid is null then return null; end if;
  lim := coalesce(public.bot_limite_de(uid), public.bot_limite_mes());
  select * into u from public.bot_uso where user_id = uid and mes = public.bot_mes_atual();
  return jsonb_build_object('usadas', coalesce(u.respostas, 0), 'limite', lim,
                            'esgotado', coalesce(u.respostas, 0) >= lim, 'avisou_fim', coalesce(u.avisou_fim, false));
end $$;

create or replace function public.bot_contar_resposta(p_wa text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid; u public.bot_uso%rowtype; lim int; aviso boolean := false;
begin
  select user_id into uid from public.whatsapp_vinculos where wa_id = p_wa;
  if uid is null then return null; end if;
  lim := coalesce(public.bot_limite_de(uid), public.bot_limite_mes());
  insert into public.bot_uso (user_id, mes, respostas) values (uid, public.bot_mes_atual(), 1)
  on conflict (user_id, mes) do update set respostas = public.bot_uso.respostas + 1
  returning * into u;
  if not u.avisou_80 and lim > 0 and u.respostas >= ceil(lim * 0.8) then
    update public.bot_uso set avisou_80 = true where user_id = uid and mes = u.mes;
    aviso := true;
  end if;
  return jsonb_build_object('usadas', u.respostas, 'limite', lim, 'restam', greatest(lim - u.respostas, 0), 'aviso80', aviso);
end $$;

create or replace function public.bot_meu_saldo()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('usadas', coalesce((select respostas from public.bot_uso where user_id = auth.uid() and mes = public.bot_mes_atual()), 0),
                            'limite', coalesce(public.bot_limite_de(auth.uid()), public.bot_limite_mes()));
$$;

-- painel: lista de contas agora com o saldo do WhatsApp e quanto já usou no mês
drop function if exists public.admin_listar();
create function public.admin_listar()
returns table (id uuid, email text, status text, is_admin boolean, criado_em timestamptz, nome text, fundador boolean,
               wa_limite int, wa_padrao int, wa_usadas int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  return query select p.id, p.email, p.status, p.is_admin, p.criado_em, p.nome, p.fundador,
                      p.wa_limite, case when p.fundador then public.bot_limite_fundador() else public.bot_limite_mes() end,
                      coalesce((select b.respostas from public.bot_uso b where b.user_id = p.id and b.mes = public.bot_mes_atual()), 0)
                 from public.perfis p order by p.criado_em desc;
end $$;

-- painel: define o saldo de uma conta (null = volta ao padrão)
create or replace function public.admin_definir_wa_limite(alvo uuid, p_limite int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  if p_limite is not null and p_limite not between 0 and 3000 then raise exception 'Use um número de 0 a 3000.'; end if;
  update public.perfis set wa_limite = p_limite where id = alvo;
  if not found then raise exception 'Conta não encontrada.'; end if;
end $$;

revoke all on function public.bot_limite_de(uuid) from public, anon, authenticated;
revoke all on function public.admin_listar() from public, anon;
revoke all on function public.admin_definir_wa_limite(uuid, int) from public, anon;
grant execute on function public.admin_listar() to authenticated;
grant execute on function public.admin_definir_wa_limite(uuid, int) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.bot_limite_de(uuid) to service_role;
  end if;
end $$;
