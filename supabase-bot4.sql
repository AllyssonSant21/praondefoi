-- =====================================================================
--  Pra Onde Foi? · BOT, PARTE 4 · DETETIVE GRANA (teste no HMG)
--  Rodar depois do supabase-bot3.sql. Pode rodar de novo sem problema.
--
--  Ligar o WhatsApp com um toque: a pessoa digita o celular no app (opcional),
--  toca em "Abrir conversa" e só envia a mensagem pronta. O bot confere se quem
--  mandou é o MESMO número digitado + o código escondido na mensagem.
--  Nada é pago: é a pessoa que começa a conversa.
-- =====================================================================

alter table public.whatsapp_codigos add column if not exists telefone text;

-- guarda o celular esperado no código que está valendo (só dígitos, com 55)
create or replace function public.whatsapp_definir_telefone(p_tel text)
returns text language plpgsql security definer set search_path = public as $$
declare t text := regexp_replace(coalesce(p_tel, ''), '\D', '', 'g');
begin
  perform public.exigir_aprovado();
  if char_length(t) in (10, 11) then t := '55' || t; end if;
  if t !~ '^55[1-9][0-9][0-9]{8,9}$' then raise exception 'Celular inválido. Use DDD + número, tipo (65) 99999-9999.'; end if;
  update public.whatsapp_codigos set telefone = t where user_id = auth.uid() and expira > now();
  if not found then raise exception 'O código venceu. Feche e abra de novo.'; end if;
  return t;
end $$;
revoke all on function public.whatsapp_definir_telefone(text) from public, anon;
grant execute on function public.whatsapp_definir_telefone(text) to authenticated;

-- mesmo celular? (o WhatsApp às vezes manda sem o 9 da frente: compara DDD + 8 últimos)
create or replace function public.mesmo_celular(a text, b text)
returns boolean language sql immutable as $$
  select substr(a, 3, 2) = substr(b, 3, 2) and right(a, 8) = right(b, 8);
$$;

-- liga o número à conta pelo código. Erros: 'invalido', 'bloqueado', 'outro_numero'
create or replace function public.bot_vincular(p_wa text, p_msg text, p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.whatsapp_codigos%rowtype; n int; cnome text;
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
  delete from public.whatsapp_vinculos where wa_id = p_wa or user_id = c.user_id;
  insert into public.whatsapp_vinculos (wa_id, user_id, controle_id) values (p_wa, c.user_id, c.controle_id);
  delete from public.whatsapp_codigos where user_id = c.user_id;
  select nome into cnome from public.controles where id = c.controle_id;
  return jsonb_build_object('ok', true, 'nome', (select nome from public.perfis where id = c.user_id), 'controle_nome', cnome);
end $$;
revoke all on function public.bot_vincular(text, text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.bot_vincular(text, text, text) to service_role;
  end if;
end $$;
