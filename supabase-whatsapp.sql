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
