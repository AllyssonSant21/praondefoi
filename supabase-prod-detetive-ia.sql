-- =====================================================================
--  Pra Onde Foi? · PROD: DETETIVE (TELEGRAM) + LEITURA POR IA + LIBERAÇÃO POR CONTA
--  Junta, na ordem, os scripts que só tinham rodado no HMG.
--  Rodar UMA vez no SQL Editor do PROD (pode rodar de novo sem estragar).
--  Antes: o prod já tem os scripts 1 a 18, o supabase-fundador.sql e o supabase-tema.sql.
--  Depois de rodar, NINGUÉM ganha nada sozinho: o admin libera IA e Detetive conta por conta (⋮ no painel).
-- =====================================================================


-- para poder rodar de novo: funções que mudaram de formato ao longo dos scripts
drop function if exists public.whatsapp_meu();

-- ===================== supabase-whatsapp.sql =====================
-- =====================================================================
--  Pra Onde Foi? · BOT DO WHATSAPP (teste no HMG)
--  Rodar depois do supabase-cartoes3.sql. Pode rodar de novo sem problema.
--  Não apaga nem altera nada do que já existe.
--
--  Como o número é ligado à conta (sem risco de alguém usar o número de outro):
--  1) no app, a pessoa pede um código de 6 dígitos (vale 15 minutos);
--  2) ela manda o código para o bot pelo próprio WhatsApp;
--  3) o número que mandou (confirmado pela Meta) fica ligado à conta dela.
--  O bot (função do Supabase) usa as funções bot_* abaixo, que só ele pode chamar.
-- =====================================================================

-- número ligado → conta e controle onde o bot lança
create table if not exists public.whatsapp_vinculos (
  wa_id        text primary key check (wa_id ~ '^[0-9]{8,15}$'),
  user_id      uuid not null unique references auth.users(id) on delete cascade,
  controle_id  uuid references public.controles(id) on delete set null,
  ultimo_lanc  uuid,
  criado_em    timestamptz not null default now()
);

-- códigos de ligação (1 por pessoa, vale 15 minutos)
create table if not exists public.whatsapp_codigos (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  codigo       text not null unique check (codigo ~ '^[0-9]{6}$'),
  controle_id  uuid not null references public.controles(id) on delete cascade,
  expira       timestamptz not null
);

-- mensagens recebidas (evita lançar 2x se a Meta reenviar; limite de mensagens por minuto)
create table if not exists public.whatsapp_msgs (
  id         text primary key,
  wa_id      text not null,
  ok         boolean not null default true,     -- false = código errado (conta pras tentativas)
  criado_em  timestamptz not null default now()
);
create index if not exists whatsapp_msgs_wa_idx on public.whatsapp_msgs (wa_id, criado_em);

alter table public.whatsapp_vinculos enable row level security;
alter table public.whatsapp_codigos  enable row level security;
alter table public.whatsapp_msgs     enable row level security;
drop policy if exists wa_vinc_ver on public.whatsapp_vinculos;
create policy wa_vinc_ver on public.whatsapp_vinculos for select to authenticated using (user_id = auth.uid());
revoke all on public.whatsapp_vinculos, public.whatsapp_codigos, public.whatsapp_msgs from anon, authenticated;
grant select on public.whatsapp_vinculos to authenticated;

-- ---------- funções do app (pessoa logada) ----------

-- gera o código para ligar o WhatsApp; o bot vai lançar no controle escolhido
create or replace function public.whatsapp_gerar_codigo(cid uuid)
returns text language plpgsql security definer set search_path = public as $$
declare cod text; tent int := 0;
begin
  perform public.exigir_aprovado();
  if cid is null or not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if not public.modulo_ativo(cid, 'lanc') then raise exception 'Este controle não compartilha Lançamentos.'; end if;
  loop
    cod := lpad((('x' || substr(md5(gen_random_uuid()::text), 1, 7))::bit(28)::int % 1000000)::text, 6, '0');
    exit when not exists (select 1 from public.whatsapp_codigos where codigo = cod and user_id <> auth.uid());
    tent := tent + 1; if tent > 20 then raise exception 'Tente de novo.'; end if;
  end loop;
  insert into public.whatsapp_codigos (user_id, codigo, controle_id, expira)
  values (auth.uid(), cod, cid, now() + interval '15 minutes')
  on conflict (user_id) do update set codigo = excluded.codigo, controle_id = excluded.controle_id, expira = excluded.expira;
  return cod;
end $$;

-- como está a ligação (número com final escondido + controle)
create or replace function public.whatsapp_meu()
returns table (final text, controle_id uuid, controle_nome text) language sql stable security definer set search_path = public as $$
  select right(v.wa_id, 4), v.controle_id, c.nome
    from public.whatsapp_vinculos v left join public.controles c on c.id = v.controle_id
   where v.user_id = auth.uid();
$$;

-- muda o controle onde o bot lança
create or replace function public.whatsapp_definir_controle(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_aprovado();
  if cid is null or not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if not public.modulo_ativo(cid, 'lanc') then raise exception 'Este controle não compartilha Lançamentos.'; end if;
  update public.whatsapp_vinculos set controle_id = cid where user_id = auth.uid();
end $$;

-- desliga o WhatsApp da conta
create or replace function public.whatsapp_desligar()
returns void language sql security definer set search_path = public as $$
  delete from public.whatsapp_vinculos where user_id = auth.uid();
  delete from public.whatsapp_codigos  where user_id = auth.uid();
$$;

-- ---------- funções do bot (só a função do Supabase, com a chave de serviço) ----------

-- registra a mensagem: 'ok', 'repetida' (a Meta reenviou) ou 'limite' (mensagens demais)
create or replace function public.bot_registrar_msg(p_id text, p_wa text)
returns text language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.whatsapp_msgs (id, wa_id) values (p_id, p_wa) on conflict (id) do nothing;
  if not found then return 'repetida'; end if;
  select count(*) into n from public.whatsapp_msgs where wa_id = p_wa and criado_em > now() - interval '1 minute';
  if n > 20 then return 'limite'; end if;
  select count(*) into n from public.whatsapp_msgs where wa_id = p_wa and criado_em > now() - interval '1 day';
  if n > 300 then return 'limite'; end if;
  delete from public.whatsapp_msgs where criado_em < now() - interval '3 days';
  return 'ok';
end $$;

-- quem é esse número: conta, nome, controle e categorias próprias do controle
create or replace function public.bot_contexto(p_wa text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.whatsapp_vinculos%rowtype; p public.perfis%rowtype; cid uuid; cnome text;
begin
  select * into v from public.whatsapp_vinculos where wa_id = p_wa;
  if v.wa_id is null then return null; end if;
  select * into p from public.perfis where id = v.user_id;
  cid := v.controle_id;
  -- saiu do controle ou o controle sumiu: volta para o "Meu controle"
  if cid is null or not exists (select 1 from public.membros where controle_id = cid and user_id = v.user_id)
     or not public.modulo_ativo(cid, 'lanc') then
    select id into cid from public.controles where dono = v.user_id and pessoal;
  end if;
  select nome into cnome from public.controles where id = cid;
  return jsonb_build_object(
    'user_id', v.user_id, 'nome', p.nome, 'aprovado', coalesce(p.status = 'aprovado', false),
    'controle_id', cid, 'controle_nome', cnome,
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'tipo', tipo))
                              from public.categorias where controle_id = cid and not oculta), '[]'::jsonb));
end $$;

-- liga o número à conta pelo código. Erros: 'invalido', 'bloqueado' (5 erros na última hora)
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
  delete from public.whatsapp_vinculos where wa_id = p_wa or user_id = c.user_id;
  insert into public.whatsapp_vinculos (wa_id, user_id, controle_id) values (p_wa, c.user_id, c.controle_id);
  delete from public.whatsapp_codigos where user_id = c.user_id;
  select nome into cnome from public.controles where id = c.controle_id;
  return jsonb_build_object('ok', true, 'nome', (select nome from public.perfis where id = c.user_id), 'controle_nome', cnome);
end $$;

-- lança uma entrada ou saída
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
  update public.whatsapp_vinculos set ultimo_lanc = nid where wa_id = p_wa;
  return jsonb_build_object('id', nid, 'controle_nome', ctx->>'controle_nome');
end $$;

-- apaga o último lançamento feito pelo bot
create or replace function public.bot_desfazer(p_wa text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_vinculos%rowtype; l public.lancamentos%rowtype;
begin
  select * into v from public.whatsapp_vinculos where wa_id = p_wa;
  if v.wa_id is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  select * into l from public.lancamentos where id = v.ultimo_lanc and user_id = v.user_id;
  if l.id is null then return jsonb_build_object('erro', 'nada'); end if;
  delete from public.lancamentos where id = l.id;
  update public.whatsapp_vinculos set ultimo_lanc = null where wa_id = p_wa;
  return jsonb_build_object('descricao', l.descricao, 'valor', l.valor, 'tipo', l.tipo);
end $$;

-- resumo de um período: entradas, saídas e as categorias com mais gasto
create or replace function public.bot_resumo(p_wa text, p_de date, p_ate date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); cid uuid;
begin
  if ctx is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  if not (ctx->>'aprovado')::boolean then return jsonb_build_object('erro', 'nao_aprovado'); end if;
  cid := (ctx->>'controle_id')::uuid;
  return jsonb_build_object(
    'controle_nome', ctx->>'controle_nome',
    'saidas',   coalesce((select sum(valor) from public.lancamentos where controle_id = cid and tipo = 'exp' and data between p_de and p_ate), 0),
    'entradas', coalesce((select sum(valor) from public.lancamentos where controle_id = cid and tipo = 'inc' and data between p_de and p_ate), 0),
    'qtd',      (select count(*) from public.lancamentos where controle_id = cid and data between p_de and p_ate),
    'top', coalesce((select jsonb_agg(t) from (
              select categoria, sum(valor) as total from public.lancamentos
               where controle_id = cid and tipo = 'exp' and data between p_de and p_ate
               group by categoria order by 2 desc limit 3) t), '[]'::jsonb));
end $$;

do $$
declare f text;
begin
  foreach f in array array['whatsapp_gerar_codigo(uuid)', 'whatsapp_meu()', 'whatsapp_definir_controle(uuid)', 'whatsapp_desligar()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['bot_registrar_msg(text, text)', 'bot_contexto(text)', 'bot_vincular(text, text, text)',
                           'bot_lancar(text, text, text, text, numeric, date)', 'bot_desfazer(text)', 'bot_resumo(text, date, date)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;


-- ===================== supabase-bot-telegram.sql =====================
-- =====================================================================
--  Pra Onde Foi? · BOT TAMBÉM NO TELEGRAM (teste no HMG)
--  Rodar depois do supabase-whatsapp.sql. Pode rodar de novo sem problema.
--  O mesmo vínculo serve para os dois: número do WhatsApp ou 'tg' + id do Telegram.
--  Cada conta fica ligada a UM canal por vez (ligar outro troca).
-- =====================================================================

alter table public.whatsapp_vinculos drop constraint if exists whatsapp_vinculos_wa_id_check;
alter table public.whatsapp_vinculos add constraint whatsapp_vinculos_wa_id_check check (wa_id ~ '^(tg)?[0-9]{5,20}$');

-- como está a ligação: canal, final do número (WhatsApp) e controle
drop function if exists public.whatsapp_meu();
create function public.whatsapp_meu()
returns table (canal text, final text, controle_id uuid, controle_nome text) language sql stable security definer set search_path = public as $$
  select case when v.wa_id like 'tg%' then 'telegram' else 'whatsapp' end,
         case when v.wa_id like 'tg%' then null else right(v.wa_id, 4) end,
         v.controle_id, c.nome
    from public.whatsapp_vinculos v left join public.controles c on c.id = v.controle_id
   where v.user_id = auth.uid();
$$;
revoke all on function public.whatsapp_meu() from public, anon;
grant execute on function public.whatsapp_meu() to authenticated;


-- ===================== supabase-bot2.sql =====================
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


-- ===================== supabase-bot3.sql =====================
-- =====================================================================
--  Pra Onde Foi? · BOT, PARTE 3 (teste no HMG)
--  Rodar depois do supabase-bot2.sql. Pode rodar de novo sem problema.
--
--  1) Editar pelo chat: "o último era 45", "era farmácia", "mudar valor da luz para 210",
--     "renomear a conta X para água", "mudar vencimento da luz para dia 15"
--  2) Aprender: quando a pessoa corrige a categoria, o bot lembra (só para ela)
--  3) Frases que o bot não entendeu ou que a pessoa desfez/corrigiu ficam guardadas 30 dias
--     (só quando a função estiver com BOT_APRENDER=1; usar só no HMG)
-- =====================================================================

alter table public.whatsapp_vinculos add column if not exists ultimo_texto text;

-- dicionário de cada pessoa: palavra → categoria
create table if not exists public.bot_dicionario (
  user_id   uuid not null references auth.users(id) on delete cascade,
  termo     text not null check (char_length(termo) between 2 and 60),
  tipo      text not null check (tipo in ('exp', 'inc')),
  categoria text not null check (char_length(categoria) between 1 and 60),
  criado_em timestamptz not null default now(),
  primary key (user_id, termo, tipo)
);
alter table public.bot_dicionario enable row level security;
drop policy if exists bot_dic_ver on public.bot_dicionario;
create policy bot_dic_ver on public.bot_dicionario for select to authenticated using (user_id = auth.uid());
drop policy if exists bot_dic_apagar on public.bot_dicionario;
create policy bot_dic_apagar on public.bot_dicionario for delete to authenticated using (user_id = auth.uid());
revoke all on public.bot_dicionario from anon, authenticated;
grant select, delete on public.bot_dicionario to authenticated;

-- frases para melhorar o bot (apagadas depois de 30 dias)
create table if not exists public.bot_frases (
  id        bigint generated always as identity primary key,
  user_id   uuid references auth.users(id) on delete cascade,
  texto     text not null,
  motivo    text not null check (motivo in ('nao_entendi', 'desfeito', 'corrigido', 'recusado')),
  criado_em timestamptz not null default now()
);
alter table public.bot_frases enable row level security;   -- ninguém lê pelo app; você olha pelo SQL
revoke all on public.bot_frases from anon, authenticated;

-- quem é esse número (agora com o dicionário da pessoa)
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
    'ultimo_tipo', v.ultimo_tipo, 'ultimo_texto', v.ultimo_texto,
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'tipo', tipo))
                              from public.categorias where controle_id = cid and not oculta), '[]'::jsonb),
    'dicionario', coalesce((select jsonb_agg(jsonb_build_object('termo', termo, 'tipo', tipo, 'categoria', categoria))
                              from (select * from public.bot_dicionario where user_id = v.user_id order by criado_em desc limit 300) d), '[]'::jsonb));
end $$;

-- guarda o texto da última coisa que o bot fez (para registrar se a pessoa desfizer/corrigir)
create or replace function public.bot_guardar_texto(p_wa text, p_texto text)
returns void language sql security definer set search_path = public as $$
  update public.whatsapp_vinculos set ultimo_texto = left(p_texto, 500) where wa_id = p_wa;
$$;

-- registra uma frase para melhorar o bot
create or replace function public.bot_anotar(p_wa text, p_texto text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_texto is null or btrim(p_texto) = '' then return; end if;
  insert into public.bot_frases (user_id, texto, motivo)
  values ((select user_id from public.whatsapp_vinculos where wa_id = p_wa), left(p_texto, 500), p_motivo);
  delete from public.bot_frases where criado_em < now() - interval '30 days';
end $$;

-- aprende: "drogaria ze" → Saúde (só para esta pessoa)
create or replace function public.bot_aprender(p_wa text, p_termo text, p_tipo text, p_cat text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := (select user_id from public.whatsapp_vinculos where wa_id = p_wa);
        t text := left(btrim(lower(coalesce(p_termo, ''))), 60);
begin
  if uid is null or char_length(t) < 2 or p_tipo not in ('exp', 'inc') or coalesce(btrim(p_cat), '') = '' then return; end if;
  insert into public.bot_dicionario (user_id, termo, tipo, categoria) values (uid, t, p_tipo, left(btrim(p_cat), 60))
  on conflict (user_id, termo, tipo) do update set categoria = excluded.categoria, criado_em = now();
end $$;

-- corrige o último lançamento feito pelo bot (o que vier null fica como está)
create or replace function public.bot_editar_ultimo(p_wa text, p_valor numeric, p_desc text, p_cat text, p_data date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_vinculos%rowtype; l public.lancamentos%rowtype; antes text;
begin
  select * into v from public.whatsapp_vinculos where wa_id = p_wa;
  if v.wa_id is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  if coalesce(v.ultimo_tipo, 'lanc') <> 'lanc' then return jsonb_build_object('erro', 'nao_e_lanc', 'ultimo', v.ultimo_tipo); end if;
  select * into l from public.lancamentos where id = coalesce(v.ultimo_id, v.ultimo_lanc) and user_id = v.user_id;
  if l.id is null then return jsonb_build_object('erro', 'nada'); end if;
  if p_valor is not null and (p_valor <= 0 or p_valor > 9999999) then return jsonb_build_object('erro', 'dados'); end if;
  if p_data is not null and abs(p_data - current_date) > 400 then return jsonb_build_object('erro', 'dados'); end if;
  antes := l.descricao;
  update public.lancamentos
     set valor = coalesce(round(p_valor, 2), valor),
         descricao = coalesce(left(nullif(btrim(p_desc), ''), 200), descricao),
         categoria = coalesce(left(nullif(btrim(p_cat), ''), 60), categoria),
         data = coalesce(p_data, data)
   where id = l.id returning * into l;
  return jsonb_build_object('tipo', l.tipo, 'descricao', l.descricao, 'categoria', l.categoria, 'valor', l.valor, 'data', l.data,
                            'antes_desc', antes);
end $$;

-- contas a pagar ativas do controle (para renomear / mudar valor / vencimento)
create or replace function public.bot_contas_ativas(p_wa text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); cid uuid;
begin
  if ctx is null or not (ctx->>'aprovado')::boolean then return '[]'::jsonb; end if;
  cid := (ctx->>'controle_id')::uuid;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'valor', valor, 'dia', dia, 'mes', inicio, 'falta', valor) order by nome)
                     from public.contas
                    where controle_id = cid
                      and (fim is null or fim >= date_trunc('month', current_date))
                      and (tipo <> 'unica' or inicio >= (date_trunc('month', current_date) - interval '1 month'))
                      and (tipo <> 'parcelada' or (inicio + make_interval(months => parcelas)) > date_trunc('month', current_date))), '[]'::jsonb);
end $$;

-- edita uma conta a pagar (só quem criou, igual no app)
create or replace function public.bot_editar_conta(p_wa text, p_conta uuid, p_nome text, p_valor numeric, p_dia int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); uid uuid; cid uuid; k public.contas%rowtype;
begin
  if ctx is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  if not (ctx->>'aprovado')::boolean then return jsonb_build_object('erro', 'nao_aprovado'); end if;
  uid := (ctx->>'user_id')::uuid; cid := (ctx->>'controle_id')::uuid;
  select * into k from public.contas where id = p_conta and controle_id = cid;
  if k.id is null then return jsonb_build_object('erro', 'conta'); end if;
  if k.criado_por is distinct from uid then return jsonb_build_object('erro', 'nao_e_sua'); end if;
  if p_nome is not null and char_length(btrim(p_nome)) not between 1 and 60 then return jsonb_build_object('erro', 'dados'); end if;
  if p_valor is not null and (p_valor <= 0 or p_valor > 9999999) then return jsonb_build_object('erro', 'dados'); end if;
  if p_dia is not null and p_dia not between 1 and 31 then return jsonb_build_object('erro', 'dados'); end if;
  update public.contas set nome = coalesce(btrim(p_nome), nome), valor = coalesce(round(p_valor, 2), valor), dia = coalesce(p_dia, dia)
   where id = k.id returning * into k;
  return jsonb_build_object('nome', k.nome, 'valor', k.valor, 'dia', k.dia);
end $$;

do $$
declare f text;
begin
  foreach f in array array['bot_contexto(text)', 'bot_guardar_texto(text, text)', 'bot_anotar(text, text, text)',
                           'bot_aprender(text, text, text, text)', 'bot_editar_ultimo(text, numeric, text, text, date)',
                           'bot_contas_ativas(text)', 'bot_editar_conta(text, uuid, text, numeric, int)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;

-- PARA VER AS FRASES (rode quando quiser e me mande o resultado):
--   select criado_em, motivo, texto from public.bot_frases order by criado_em desc limit 100;


-- ===================== supabase-bot4.sql =====================
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


-- ===================== supabase-bot5.sql =====================
-- =====================================================================
--  Pra Onde Foi? · BOT, PARTE 5 · SALDO MENSAL DO WHATSAPP
--  Rodar depois do supabase-bot4.sql. Pode rodar de novo sem problema.
--
--  Cada resposta do bot no WhatsApp custa (Meta). Cada pessoa tem um saldo de
--  300 respostas por mês: acumula dentro do mês e zera na virada.
--  Aos 80% o bot avisa; quando acaba, avisa uma vez e fica em silêncio até o
--  mês virar. O Telegram e o app não têm limite.
-- =====================================================================

create table if not exists public.bot_uso (
  user_id    uuid not null references auth.users(id) on delete cascade,
  mes        date not null,
  respostas  int  not null default 0,
  avisou_80  boolean not null default false,
  avisou_fim boolean not null default false,
  primary key (user_id, mes)
);
alter table public.bot_uso enable row level security;   -- só pelas funções abaixo
revoke all on public.bot_uso from anon, authenticated;

-- tamanho do saldo (mude aqui se quiser outro número)
create or replace function public.bot_limite_mes()
returns int language sql immutable as $$ select 300 $$;

-- mês atual no horário de Brasília
create or replace function public.bot_mes_atual()
returns date language sql stable as $$ select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date $$;

-- como está o saldo de quem mandou (null = número ainda não ligado a uma conta)
create or replace function public.bot_saldo(p_wa text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid; u public.bot_uso%rowtype;
begin
  select user_id into uid from public.whatsapp_vinculos where wa_id = p_wa;
  if uid is null then return null; end if;
  select * into u from public.bot_uso where user_id = uid and mes = public.bot_mes_atual();
  return jsonb_build_object('usadas', coalesce(u.respostas, 0), 'limite', public.bot_limite_mes(),
                            'esgotado', coalesce(u.respostas, 0) >= public.bot_limite_mes(),
                            'avisou_fim', coalesce(u.avisou_fim, false));
end $$;

-- conta 1 resposta enviada; diz se é hora do aviso de 80%
create or replace function public.bot_contar_resposta(p_wa text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid; u public.bot_uso%rowtype; lim int := public.bot_limite_mes(); aviso boolean := false;
begin
  select user_id into uid from public.whatsapp_vinculos where wa_id = p_wa;
  if uid is null then return null; end if;
  insert into public.bot_uso (user_id, mes, respostas) values (uid, public.bot_mes_atual(), 1)
  on conflict (user_id, mes) do update set respostas = public.bot_uso.respostas + 1
  returning * into u;
  if not u.avisou_80 and u.respostas >= ceil(lim * 0.8) then
    update public.bot_uso set avisou_80 = true where user_id = uid and mes = u.mes;
    aviso := true;
  end if;
  return jsonb_build_object('usadas', u.respostas, 'limite', lim, 'restam', greatest(lim - u.respostas, 0), 'aviso80', aviso);
end $$;

-- marca que o aviso de "saldo acabou" já foi mandado este mês
create or replace function public.bot_marcar_fim(p_wa text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select user_id into uid from public.whatsapp_vinculos where wa_id = p_wa;
  if uid is null then return; end if;
  insert into public.bot_uso (user_id, mes, respostas, avisou_fim) values (uid, public.bot_mes_atual(), 0, true)
  on conflict (user_id, mes) do update set avisou_fim = true;
end $$;

-- para o app: quanto a pessoa já usou este mês
create or replace function public.bot_meu_saldo()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('usadas', coalesce((select respostas from public.bot_uso where user_id = auth.uid() and mes = public.bot_mes_atual()), 0),
                            'limite', public.bot_limite_mes());
$$;

revoke all on function public.bot_meu_saldo() from public, anon;
grant execute on function public.bot_meu_saldo() to authenticated;
do $$
declare f text;
begin
  foreach f in array array['bot_saldo(text)', 'bot_contar_resposta(text)', 'bot_marcar_fim(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;


-- ===================== supabase-bot6.sql =====================
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


-- ===================== supabase-ia.sql =====================
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


-- ===================== supabase-bot7.sql =====================
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


-- ===================== supabase-bot8.sql =====================
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


-- ===================== supabase-liberacoes.sql =====================
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
