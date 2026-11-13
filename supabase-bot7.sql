-- =====================================================================
--  Pra Onde Foi? · BOT, PARTE 7 · TELEGRAM E WHATSAPP AO MESMO TEMPO
--  Rodar depois do supabase-bot6.sql. Pode rodar de novo.
--
--  Antes cada conta só podia ligar UM canal no Detetive Grana.
--  Agora pode ter o Telegram e o WhatsApp ligados juntos
--  (no máximo um de cada), e desligar cada um separado.
-- =====================================================================

-- de que canal é cada vínculo (os do Telegram começam com "tg")
alter table public.whatsapp_vinculos
  add column if not exists canal text generated always as (case when wa_id like 'tg%' then 'telegram' else 'whatsapp' end) stored;

-- troca a trava "uma conta = um canal" por "uma conta = um de cada canal"
alter table public.whatsapp_vinculos drop constraint if exists whatsapp_vinculos_user_id_key;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_vinculos_user_canal_key') then
    alter table public.whatsapp_vinculos add constraint whatsapp_vinculos_user_canal_key unique (user_id, canal);
  end if;
end $$;

-- ligar: só troca o vínculo do MESMO canal (ligar o WhatsApp não desliga o Telegram)
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
  -- código pedido para um celular: só esse celular pode usar
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

-- os canais ligados da conta (agora pode vir mais de uma linha)
create or replace function public.whatsapp_meu()
returns table (canal text, final text, controle_id uuid, controle_nome text)
language sql stable security definer set search_path = public as $$
  select v.canal,
         case when v.canal = 'telegram' then null else right(v.wa_id, 4) end,
         v.controle_id, c.nome
    from public.whatsapp_vinculos v left join public.controles c on c.id = v.controle_id
   where v.user_id = auth.uid()
   order by v.canal;
$$;

-- desligar só um canal ('telegram' ou 'whatsapp'); o whatsapp_desligar() sem nada continua desligando tudo
create or replace function public.whatsapp_desligar(p_canal text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_canal is null or p_canal not in ('telegram', 'whatsapp') then raise exception 'Canal inválido.'; end if;
  delete from public.whatsapp_vinculos where user_id = auth.uid() and canal = p_canal;
  if not exists (select 1 from public.whatsapp_vinculos where user_id = auth.uid()) then
    delete from public.whatsapp_codigos where user_id = auth.uid();
  end if;
end $$;

do $$ begin
  revoke all on function public.whatsapp_desligar(text) from public, anon;
  grant execute on function public.whatsapp_desligar(text) to authenticated;
  revoke all on function public.whatsapp_meu() from public, anon;
  grant execute on function public.whatsapp_meu() to authenticated;
  revoke all on function public.bot_vincular(text, text, text) from public, anon, authenticated;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.bot_vincular(text, text, text) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
