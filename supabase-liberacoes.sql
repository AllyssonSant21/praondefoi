-- =====================================================================
--  Pra Onde Foi? · LIBERAR RECURSOS POR CONTA (IA e Detetive)
--  Rodar depois do supabase-bot8.sql. Pode rodar de novo.
--
--  O administrador escolhe, conta por conta, quem pode usar:
--    · leitura por IA (foto, PDF e áudio)
--    · o Detetive Grana (bot no Telegram / WhatsApp)
--  Quem não foi liberado não vê os botões no app e o banco recusa o uso.
--  O administrador sempre pode usar tudo.
-- =====================================================================

alter table public.perfis add column if not exists ia_liberada  boolean not null default false;
alter table public.perfis add column if not exists bot_liberado boolean not null default false;

create or replace function public.pode_ia(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.ia_liberada or p.is_admin from public.perfis p where p.id = p_uid), false);
$$;
create or replace function public.pode_bot(p_uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.bot_liberado or p.is_admin from public.perfis p where p.id = p_uid), false);
$$;

-- o que a própria pessoa pode usar (o app esconde o resto)
create or replace function public.meus_recursos() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ia', public.pode_ia(auth.uid()), 'bot', public.pode_bot(auth.uid()));
$$;

-- IA: só gasta leitura de quem foi liberado
create or replace function public.ia_consumir(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare lim int; n int;
begin
  if not exists (select 1 from public.perfis where id = p_uid and status = 'aprovado') then
    return jsonb_build_object('erro', 'nao_aprovado');
  end if;
  if not public.pode_ia(p_uid) then return jsonb_build_object('erro', 'nao_liberado'); end if;
  lim := coalesce(public.ia_limite_de(p_uid), public.ia_limite_mes());
  insert into public.ia_uso (user_id, mes, leituras) values (p_uid, public.bot_mes_atual(), 0) on conflict do nothing;
  update public.ia_uso set leituras = leituras + 1
   where user_id = p_uid and mes = public.bot_mes_atual() and leituras < lim
  returning leituras into n;
  if n is null then return jsonb_build_object('erro', 'sem_saldo', 'limite', lim); end if;
  return jsonb_build_object('ok', true, 'restam', lim - n, 'limite', lim);
end $$;

create or replace function public.ia_meu_saldo()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('usadas', coalesce((select leituras from public.ia_uso where user_id = auth.uid() and mes = public.bot_mes_atual()), 0),
                            'limite', coalesce(public.ia_limite_de(auth.uid()), public.ia_limite_mes()),
                            'liberada', public.pode_ia(auth.uid()));
$$;

-- Detetive: o código de ligar só vale para quem foi liberado
create or replace function public.bot_vincular(p_wa text, p_msg text, p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.whatsapp_codigos%rowtype; n int; cnome text;
        v_canal text := case when p_wa like 'tg%' then 'telegram' else 'whatsapp' end;
begin
  select count(*) into n from public.whatsapp_msgs where wa_id = p_wa and not ok and criado_em > now() - interval '1 hour';
  if n >= 5 then return jsonb_build_object('erro', 'bloqueado'); end if;
  select * into c from public.whatsapp_codigos where codigo = p_codigo and expira > now();
  if c.user_id is null then
    update public.whatsapp_msgs set ok = false where id = p_msg;
    return jsonb_build_object('erro', 'invalido');
  end if;
  if not public.pode_bot(c.user_id) then return jsonb_build_object('erro', 'nao_liberado'); end if;
  if c.telefone is not null and p_wa not like 'tg%' and not public.mesmo_celular(c.telefone, p_wa) then
    update public.whatsapp_msgs set ok = false where id = p_msg;
    return jsonb_build_object('erro', 'outro_numero');
  end if;
  delete from public.whatsapp_vinculos where wa_id = p_wa or (user_id = c.user_id and canal = v_canal);
  insert into public.whatsapp_vinculos (wa_id, user_id, controle_id) values (p_wa, c.user_id, c.controle_id);
  delete from public.whatsapp_codigos where user_id = c.user_id;
  select nome into cnome from public.controles where id = c.controle_id;
  return jsonb_build_object('ok', true, 'nome', (select nome from public.perfis where id = c.user_id), 'controle_nome', cnome);
end $$;

-- gerar código: só quem foi liberado
create or replace function public.bot_pode_gerar() returns trigger language plpgsql as $$
begin
  if not public.pode_bot(new.user_id) then raise exception 'O Detetive Grana ainda não foi liberado para a sua conta.'; end if;
  return new;
end $$;
drop trigger if exists bot_pode_gerar on public.whatsapp_codigos;
create trigger bot_pode_gerar before insert or update on public.whatsapp_codigos for each row execute function public.bot_pode_gerar();

-- painel do administrador: liga/desliga cada recurso. Desligar o Detetive desconecta os canais da pessoa
create or replace function public.admin_liberar(alvo uuid, p_recurso text, sim boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  if p_recurso = 'ia' then update public.perfis set ia_liberada = coalesce(sim, false) where id = alvo;
  elsif p_recurso = 'bot' then
    update public.perfis set bot_liberado = coalesce(sim, false) where id = alvo;
    if not coalesce(sim, false) then
      delete from public.whatsapp_vinculos where user_id = alvo;
      delete from public.whatsapp_codigos where user_id = alvo;
    end if;
  else raise exception 'Recurso inválido.';
  end if;
  if not found then raise exception 'Conta não encontrada.'; end if;
end $$;

drop function if exists public.admin_listar();
create function public.admin_listar()
returns table (id uuid, email text, status text, is_admin boolean, criado_em timestamptz, nome text, fundador boolean,
               wa_limite int, wa_padrao int, wa_usadas int, ia_limite int, ia_padrao int, ia_usadas int,
               ia_liberada boolean, bot_liberado boolean, canais text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  return query select p.id, p.email, p.status, p.is_admin, p.criado_em, p.nome, p.fundador,
                      p.wa_limite, case when p.fundador then public.bot_limite_fundador() else public.bot_limite_mes() end,
                      coalesce((select b.respostas from public.bot_uso b where b.user_id = p.id and b.mes = public.bot_mes_atual()), 0),
                      p.ia_limite, public.ia_limite_mes(),
                      coalesce((select i.leituras from public.ia_uso i where i.user_id = p.id and i.mes = public.bot_mes_atual()), 0),
                      p.ia_liberada, p.bot_liberado,
                      (select string_agg(v.canal, ',' order by v.canal) from public.whatsapp_vinculos v where v.user_id = p.id)
                 from public.perfis p order by p.criado_em desc;
end $$;

do $$ begin
  revoke all on function public.pode_ia(uuid) from public, anon, authenticated;
  revoke all on function public.pode_bot(uuid) from public, anon, authenticated;
  revoke all on function public.meus_recursos() from public, anon;
  grant execute on function public.meus_recursos() to authenticated;
  revoke all on function public.ia_meu_saldo() from public, anon;
  grant execute on function public.ia_meu_saldo() to authenticated;
  revoke all on function public.admin_liberar(uuid, text, boolean) from public, anon;
  grant execute on function public.admin_liberar(uuid, text, boolean) to authenticated;
  revoke all on function public.admin_listar() from public, anon;
  grant execute on function public.admin_listar() to authenticated;
  revoke all on function public.ia_consumir(uuid) from public, anon, authenticated;
  revoke all on function public.bot_vincular(text, text, text) from public, anon, authenticated;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.ia_consumir(uuid) to service_role;
    grant execute on function public.bot_vincular(text, text, text) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
