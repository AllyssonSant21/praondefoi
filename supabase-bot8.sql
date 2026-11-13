-- =====================================================================
--  Pra Onde Foi? · BOT, PARTE 8 · DE ONDE VEIO CADA LANÇAMENTO
--  Rodar depois do supabase-bot7.sql. Pode rodar de novo.
--
--  Lançamentos feitos pelo Detetive guardam o canal (telegram / whatsapp)
--  e se vieram de foto, PDF ou áudio lido por IA. O app mostra um
--  robozinho ao lado deles, com a explicação de onde vieram.
-- =====================================================================

alter table public.lancamentos add column if not exists origem text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lancamentos_origem_ok') then
    alter table public.lancamentos add constraint lancamentos_origem_ok
      check (origem is null or origem in ('telegram', 'whatsapp', 'telegram_ia', 'whatsapp_ia'));
  end if;
end $$;

-- o banco preenche sozinho a partir do que a função do bot avisou (o app nunca escolhe)
create or replace function public.lanc_origem() returns trigger language plpgsql as $$
begin
  new.origem := nullif(current_setting('pof.origem', true), '');
  return new;
end $$;
drop trigger if exists lanc_origem on public.lancamentos;
create trigger lanc_origem before insert on public.lancamentos for each row execute function public.lanc_origem();
-- e ninguém muda depois (editar um lançamento no app não apaga a origem)
create or replace function public.lanc_origem_fixa() returns trigger language plpgsql as $$
begin
  new.origem := old.origem;
  return new;
end $$;
drop trigger if exists lanc_origem_fixa on public.lancamentos;
create trigger lanc_origem_fixa before update on public.lancamentos for each row execute function public.lanc_origem_fixa();

-- lançar pelo bot: agora diz o canal e se veio de leitura por IA
drop function if exists public.bot_lancar(text, text, text, text, numeric, date);
create or replace function public.bot_lancar(p_wa text, p_tipo text, p_desc text, p_cat text, p_valor numeric, p_data date, p_ia boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); nid uuid; uid uuid; cid uuid;
begin
  if ctx is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  if not (ctx->>'aprovado')::boolean then return jsonb_build_object('erro', 'nao_aprovado'); end if;
  uid := (ctx->>'user_id')::uuid; cid := (ctx->>'controle_id')::uuid;
  if cid is null then return jsonb_build_object('erro', 'sem_controle'); end if;
  if p_tipo not in ('exp', 'inc') or p_valor is null or p_valor <= 0 or p_valor > 9999999
     or p_data is null or abs(p_data - current_date) > 400 then
    return jsonb_build_object('erro', 'dados');
  end if;
  perform set_config('pof.origem', (case when p_wa like 'tg%' then 'telegram' else 'whatsapp' end) || (case when p_ia then '_ia' else '' end), true);
  insert into public.lancamentos (user_id, tipo, descricao, categoria, valor, data, controle_id)
  values (uid, p_tipo, left(coalesce(nullif(btrim(p_desc), ''), p_cat), 200), left(p_cat, 60), round(p_valor, 2), p_data, cid)
  returning id into nid;
  perform set_config('pof.origem', '', true);
  update public.whatsapp_vinculos set ultimo_lanc = nid, ultimo_tipo = 'lanc', ultimo_id = nid where wa_id = p_wa;
  return jsonb_build_object('id', nid, 'controle_nome', ctx->>'controle_nome');
end $$;

-- "paguei a luz" pelo bot também fica marcado
CREATE OR REPLACE FUNCTION public.bot_pagar_conta(p_wa text, p_conta uuid, p_mes date, p_valor numeric, p_data date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb := public.bot_contexto(p_wa); uid uuid; cid uuid; c public.contas%rowtype;
        m date := date_trunc('month', p_mes)::date; total numeric; pago numeric; falta numeric;
        v numeric := round(coalesce(p_valor, 0), 2); descr text; lid uuid; pid uuid;
begin
  perform set_config('pof.origem', case when p_wa like 'tg%' then 'telegram' else 'whatsapp' end, true);
  if ctx is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  if not (ctx->>'aprovado')::boolean then return jsonb_build_object('erro', 'nao_aprovado'); end if;
  uid := (ctx->>'user_id')::uuid; cid := (ctx->>'controle_id')::uuid;
  select * into c from public.contas where id = p_conta and controle_id = cid for update;
  if c.id is null or not public.conta_ocorre(c.tipo, c.inicio, c.parcelas, c.fim, m) then return jsonb_build_object('erro', 'conta'); end if;
  if p_data is null or abs(p_data - current_date) > 400 then return jsonb_build_object('erro', 'dados'); end if;
  select coalesce((select valor from public.conta_meses where conta_id = c.id and mes = m), c.valor) into total;
  select coalesce(sum(valor), 0) into pago from public.pagamentos where conta_id = c.id and mes = m;
  falta := total - pago;
  if falta <= 0 then return jsonb_build_object('erro', 'ja_paga'); end if;
  if v <= 0 then v := falta; end if;
  if v > falta then return jsonb_build_object('erro', 'maior', 'falta', falta); end if;
  descr := c.nome || case when c.tipo = 'parcelada'
             then ' ' || ((extract(year from age(m, c.inicio)) * 12 + extract(month from age(m, c.inicio)))::int + 1) || '/' || c.parcelas
             else '' end;
  insert into public.lancamentos (user_id, controle_id, tipo, descricao, categoria, valor, data)
  values (uid, c.controle_id, 'exp', descr, c.categoria, v, p_data) returning id into lid;
  insert into public.pagamentos (conta_id, controle_id, mes, user_id, valor, data, lancamento_id)
  values (c.id, c.controle_id, m, uid, v, p_data, lid) returning id into pid;
  update public.whatsapp_vinculos set ultimo_lanc = null, ultimo_tipo = 'pag', ultimo_id = pid where wa_id = p_wa;
  return jsonb_build_object('nome', descr, 'valor', v, 'mes', m, 'falta', falta - v);
end $function$;

do $$ begin
  revoke all on function public.bot_lancar(text, text, text, text, numeric, date, boolean) from public, anon, authenticated;
  revoke all on function public.bot_pagar_conta(text, uuid, date, numeric, date) from public, anon, authenticated;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.bot_lancar(text, text, text, text, numeric, date, boolean) to service_role;
    grant execute on function public.bot_pagar_conta(text, uuid, date, numeric, date) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
