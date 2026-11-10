-- =====================================================================
--  Pra Onde Foi? · BOT, PARTE 2 (teste no HMG)
--  Rodar depois do supabase-bot-telegram.sql. Pode rodar de novo sem problema.
--
--  1) O bot pergunta o que faltou ("Quanto foi a luz?") e lembra a resposta por 10 minutos
--  2) Cria conta a pagar ("conta de luz 180 vence dia 20")
--  3) Paga conta a pagar ("paguei a luz")
--  4) "desfazer" desfaz o último que o bot fez: lançamento, conta criada ou pagamento
-- =====================================================================

alter table public.whatsapp_vinculos add column if not exists pendente    jsonb;
alter table public.whatsapp_vinculos add column if not exists pendente_em timestamptz;
alter table public.whatsapp_vinculos add column if not exists ultimo_tipo text;
alter table public.whatsapp_vinculos add column if not exists ultimo_id   uuid;

-- quem é esse número (agora com o que ficou pendente e se o controle tem Contas a pagar)
create or replace function public.bot_contexto(p_wa text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.whatsapp_vinculos%rowtype; p public.perfis%rowtype; cid uuid; cnome text;
begin
  select * into v from public.whatsapp_vinculos where wa_id = p_wa;
  if v.wa_id is null then return null; end if;
  select * into p from public.perfis where id = v.user_id;
  cid := v.controle_id;
  if cid is null or not exists (select 1 from public.membros where controle_id = cid and user_id = v.user_id)
     or not public.modulo_ativo(cid, 'lanc') then
    select id into cid from public.controles where dono = v.user_id and pessoal;
  end if;
  select nome into cnome from public.controles where id = cid;
  return jsonb_build_object(
    'user_id', v.user_id, 'nome', p.nome, 'aprovado', coalesce(p.status = 'aprovado', false),
    'controle_id', cid, 'controle_nome', cnome, 'tem_contas', public.modulo_ativo(cid, 'contas'),
    'pendente', case when v.pendente_em > now() - interval '10 minutes' then v.pendente end,
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'tipo', tipo))
                              from public.categorias where controle_id = cid and not oculta), '[]'::jsonb));
end $$;

-- guarda (ou limpa, com null) a pergunta em aberto: {"texto": "...", "falta": "valor" | "dia"}
create or replace function public.bot_pendente(p_wa text, p_pendente jsonb)
returns void language sql security definer set search_path = public as $$
  update public.whatsapp_vinculos
     set pendente = p_pendente, pendente_em = case when p_pendente is null then null else now() end
   where wa_id = p_wa;
$$;

-- lança uma entrada ou saída (agora guardando o "último" para o desfazer)
create or replace function public.bot_lancar(p_wa text, p_tipo text, p_desc text, p_cat text, p_valor numeric, p_data date)
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
  insert into public.lancamentos (user_id, tipo, descricao, categoria, valor, data, controle_id)
  values (uid, p_tipo, left(coalesce(nullif(btrim(p_desc), ''), p_cat), 200), left(p_cat, 60), round(p_valor, 2), p_data, cid)
  returning id into nid;
  update public.whatsapp_vinculos set ultimo_lanc = nid, ultimo_tipo = 'lanc', ultimo_id = nid where wa_id = p_wa;
  return jsonb_build_object('id', nid, 'controle_nome', ctx->>'controle_nome');
end $$;

-- cria conta a pagar. Começa no mês do próximo vencimento (se o dia já passou, no mês que vem)
create or replace function public.bot_criar_conta(p_wa text, p_nome text, p_cat text, p_valor numeric, p_dia int, p_tipo text, p_parcelas int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); uid uuid; cid uuid; nid uuid; ini date;
        n text := left(btrim(coalesce(p_nome, '')), 60); cat text := left(btrim(coalesce(p_cat, '')), 60);
begin
  if ctx is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  if not (ctx->>'aprovado')::boolean then return jsonb_build_object('erro', 'nao_aprovado'); end if;
  uid := (ctx->>'user_id')::uuid; cid := (ctx->>'controle_id')::uuid;
  if not public.modulo_ativo(cid, 'contas') then return jsonb_build_object('erro', 'sem_contas'); end if;
  if char_length(n) < 1 or char_length(cat) < 1 or p_valor is null or p_valor <= 0 or p_valor > 9999999
     or p_dia is null or p_dia not between 1 and 31 or p_tipo not in ('fixa', 'unica', 'parcelada')
     or (p_tipo = 'parcelada' and (p_parcelas is null or p_parcelas not between 2 and 240)) then
    return jsonb_build_object('erro', 'dados');
  end if;
  ini := date_trunc('month', current_date)::date;
  if p_dia < extract(day from current_date) then ini := (ini + interval '1 month')::date; end if;
  insert into public.contas (controle_id, criado_por, nome, categoria, valor, dia, tipo, inicio, parcelas)
  values (cid, uid, n, cat, round(p_valor, 2), p_dia, p_tipo, ini, case when p_tipo = 'parcelada' then p_parcelas end)
  returning id into nid;
  update public.whatsapp_vinculos set ultimo_tipo = 'conta', ultimo_id = nid where wa_id = p_wa;
  return jsonb_build_object('id', nid, 'inicio', ini, 'controle_nome', ctx->>'controle_nome');
end $$;

-- contas a pagar em aberto (mês passado, este e o próximo), para o "paguei a luz"
create or replace function public.bot_contas_abertas(p_wa text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); cid uuid;
begin
  if ctx is null or not (ctx->>'aprovado')::boolean then return '[]'::jsonb; end if;
  cid := (ctx->>'controle_id')::uuid;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome, 'mes', x.mes, 'dia', x.dia, 'falta', x.falta) order by x.mes desc, x.nome)
      from (select c.id, c.nome, c.dia, m.mes,
                   coalesce((select valor from public.conta_meses where conta_id = c.id and mes = m.mes), c.valor)
                   - coalesce((select sum(valor) from public.pagamentos where conta_id = c.id and mes = m.mes), 0) as falta
              from public.contas c
             cross join (values (date_trunc('month', current_date)::date),
                                ((date_trunc('month', current_date) - interval '1 month')::date),
                                ((date_trunc('month', current_date) + interval '1 month')::date)) m(mes)
             where c.controle_id = cid and public.conta_ocorre(c.tipo, c.inicio, c.parcelas, c.fim, m.mes)) x
     where x.falta > 0), '[]'::jsonb);
end $$;

-- paga uma conta (mesma regra do app: cria a saída em Lançamentos e o pagamento)
create or replace function public.bot_pagar_conta(p_wa text, p_conta uuid, p_mes date, p_valor numeric, p_data date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); uid uuid; cid uuid; c public.contas%rowtype;
        m date := date_trunc('month', p_mes)::date; total numeric; pago numeric; falta numeric;
        v numeric := round(coalesce(p_valor, 0), 2); descr text; lid uuid; pid uuid;
begin
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
end $$;

-- desfaz o último que o bot fez
create or replace function public.bot_desfazer(p_wa text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_vinculos%rowtype; l public.lancamentos%rowtype; k public.contas%rowtype; pg public.pagamentos%rowtype;
        tipo text; idd uuid;
begin
  select * into v from public.whatsapp_vinculos where wa_id = p_wa;
  if v.wa_id is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  tipo := coalesce(v.ultimo_tipo, case when v.ultimo_lanc is not null then 'lanc' end);
  idd := coalesce(v.ultimo_id, v.ultimo_lanc);
  if tipo = 'lanc' then
    select * into l from public.lancamentos where id = idd and user_id = v.user_id;
    if l.id is null then return jsonb_build_object('erro', 'nada'); end if;
    delete from public.lancamentos where id = l.id;
    update public.whatsapp_vinculos set ultimo_lanc = null, ultimo_tipo = null, ultimo_id = null where wa_id = p_wa;
    return jsonb_build_object('tipo', 'lanc', 'descricao', l.descricao, 'valor', l.valor);
  elsif tipo = 'conta' then
    select * into k from public.contas where id = idd and criado_por = v.user_id;
    if k.id is null then return jsonb_build_object('erro', 'nada'); end if;
    if exists (select 1 from public.pagamentos where conta_id = k.id) then return jsonb_build_object('erro', 'conta_com_pagamento'); end if;
    delete from public.contas where id = k.id;
    update public.whatsapp_vinculos set ultimo_tipo = null, ultimo_id = null where wa_id = p_wa;
    return jsonb_build_object('tipo', 'conta', 'descricao', k.nome, 'valor', k.valor);
  elsif tipo = 'pag' then
    select * into pg from public.pagamentos where id = idd and user_id = v.user_id;
    if pg.id is null then return jsonb_build_object('erro', 'nada'); end if;
    select * into k from public.contas where id = pg.conta_id;
    if pg.lancamento_id is not null then delete from public.lancamentos where id = pg.lancamento_id;   -- leva o pagamento junto
    else delete from public.pagamentos where id = pg.id; end if;
    update public.whatsapp_vinculos set ultimo_tipo = null, ultimo_id = null where wa_id = p_wa;
    return jsonb_build_object('tipo', 'pag', 'descricao', k.nome, 'valor', pg.valor);
  end if;
  return jsonb_build_object('erro', 'nada');
end $$;

do $$
declare f text;
begin
  foreach f in array array['bot_contexto(text)', 'bot_pendente(text, jsonb)', 'bot_lancar(text, text, text, text, numeric, date)',
                           'bot_criar_conta(text, text, text, numeric, int, text, int)', 'bot_contas_abertas(text)',
                           'bot_pagar_conta(text, uuid, date, numeric, date)', 'bot_desfazer(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;
