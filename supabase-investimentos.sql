-- =====================================================================
--  Pra Onde Foi? · INVESTIMENTOS + TAXAS DO BANCO CENTRAL (atualização automática)
--  Antes de rodar: Database → Extensions → ative "pg_net" e "pg_cron".
--  Pode rodar de novo sem problema. Só acrescenta; não mexe no que já existe.
-- =====================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 1) INVESTIMENTOS ------------------------------------------------------
create table if not exists public.investimentos (
  id          uuid primary key default gen_random_uuid(),
  controle_id uuid not null references public.controles(id) on delete cascade,
  criado_por  uuid references auth.users(id) on delete set null,
  nome        text not null check (char_length(nome) between 1 and 60),
  tipo        text not null check (tipo in ('poupanca','cdb','lci','lca','tesouro_selic','tesouro_ipca','tesouro_pre','acao','fii','outro')),
  indexador   text not null check (indexador in ('cdi','selic','ipca','pre','poupanca','cotacao','manual')),
  taxa        numeric(8,4),            -- % do CDI (110) · IPCA + (6) · prefixado (12) · Selic + (0,1)
  vencimento  date,
  isento      boolean not null default false,   -- LCI, LCA e poupança não pagam IR
  ticker      text check (ticker is null or ticker ~ '^[A-Z0-9]{4,7}$'),
  cotacao     numeric(14,4) check (cotacao is null or cotacao > 0),   -- ações/FIIs: preço atual (por enquanto informado à mão)
  cotacao_em  date,
  criado_em   timestamptz not null default now()
);
create index if not exists investimentos_controle_idx on public.investimentos (controle_id);

create table if not exists public.inv_movs (
  id              uuid primary key default gen_random_uuid(),
  investimento_id uuid not null references public.investimentos(id) on delete cascade,
  controle_id     uuid not null references public.controles(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  tipo            text not null check (tipo in ('aporte','resgate','saldo')),   -- saldo = "hoje vale X" (tipo Outro)
  valor           numeric(14,2) not null check (valor > 0),
  quantidade      numeric(18,6) check (quantidade is null or quantidade > 0),   -- ações/FIIs
  data            date not null,
  lancamento_id   uuid references public.lancamentos(id) on delete set null,
  criado_em       timestamptz not null default now()
);
create index if not exists inv_movs_inv_idx on public.inv_movs (investimento_id);
create index if not exists inv_movs_controle_idx on public.inv_movs (controle_id);

-- 2) TAXAS DO BANCO CENTRAL (CDI, Selic e IPCA) ----------------------------
create table if not exists public.indices (
  serie text not null check (serie in ('cdi','selic','ipca','selic_meta')),
  data  date not null,
  valor numeric(12,8) not null,   -- CDI e Selic: % ao dia · IPCA: % no mês
  primary key (serie, data)
);
alter table public.indices drop constraint if exists indices_serie_check;
alter table public.indices add constraint indices_serie_check check (serie in ('cdi','selic','ipca','selic_meta'));
create table if not exists public.indices_pedidos (
  req    bigint primary key,
  serie  text not null,
  criado timestamptz not null default now()
);

-- 3) REGRAS DE ACESSO ----------------------------------------------------
alter table public.investimentos   enable row level security;
alter table public.inv_movs        enable row level security;
alter table public.indices         enable row level security;
alter table public.indices_pedidos enable row level security;
drop policy if exists "inv_ler" on public.investimentos;
create policy "inv_ler" on public.investimentos for select to authenticated
  using (public.eh_aprovado() and public.eh_membro(controle_id));
drop policy if exists "inv_movs_ler" on public.inv_movs;
create policy "inv_movs_ler" on public.inv_movs for select to authenticated
  using (public.eh_aprovado() and public.eh_membro(controle_id));
drop policy if exists "indices_ler" on public.indices;
create policy "indices_ler" on public.indices for select to authenticated using (true);
-- indices_pedidos: ninguém lê pela internet (sem regra = sem acesso)

revoke all on public.investimentos, public.inv_movs, public.indices, public.indices_pedidos from anon;
revoke all on public.indices_pedidos from authenticated;
grant select on public.investimentos, public.inv_movs, public.indices to authenticated;

-- 4) AÇÕES ----------------------------------------------------------------
create or replace function public.salvar_investimento(
  p_id uuid, cid uuid, p_nome text, p_tipo text, p_indexador text, p_taxa numeric, p_vencimento date, p_ticker text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid; n text := btrim(coalesce(p_nome, '')); tk text := nullif(upper(btrim(coalesce(p_ticker, ''))), '');
        ix text := p_indexador; ok boolean;
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select controle_id into cid from public.investimentos where id = p_id and criado_por = auth.uid();
    if cid is null then raise exception 'Só quem cadastrou pode editar.'; end if;
  end if;
  if cid is null or not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if char_length(n) not between 1 and 60 then raise exception 'Dê um nome ao investimento (até 60 caracteres).'; end if;
  ok := case p_tipo
    when 'poupanca'      then ix = 'poupanca'
    when 'cdb'           then ix in ('cdi','pre','ipca')
    when 'lci'           then ix in ('cdi','pre','ipca')
    when 'lca'           then ix in ('cdi','pre','ipca')
    when 'tesouro_selic' then ix = 'selic'
    when 'tesouro_ipca'  then ix = 'ipca'
    when 'tesouro_pre'   then ix = 'pre'
    when 'acao'          then ix = 'cotacao'
    when 'fii'           then ix = 'cotacao'
    when 'outro'         then ix = 'manual'
    else false end;
  if not coalesce(ok, false) then raise exception 'Combinação de tipo e rentabilidade inválida.'; end if;
  if ix in ('cdi') and (p_taxa is null or p_taxa <= 0 or p_taxa > 300) then raise exception 'Informe quanto rende do CDI (ex.: 110).'; end if;
  if ix in ('pre','ipca') and (p_taxa is null or p_taxa < 0 or p_taxa > 100) then raise exception 'Informe a taxa ao ano (ex.: 12).'; end if;
  if ix = 'selic' and p_taxa is not null and (p_taxa < 0 or p_taxa > 10) then raise exception 'Taxa extra da Selic inválida.'; end if;
  if ix = 'cotacao' and (tk is null or tk !~ '^[A-Z0-9]{4,7}$') then raise exception 'Informe o código do ativo (ex.: PETR4, MXRF11).'; end if;
  if p_id is null then
    insert into public.investimentos (controle_id, criado_por, nome, tipo, indexador, taxa, vencimento, isento, ticker)
    values (cid, auth.uid(), n, p_tipo, ix, case when ix in ('cotacao','manual','poupanca') then null else p_taxa end,
            p_vencimento, p_tipo in ('lci','lca','poupanca'), case when ix = 'cotacao' then tk end)
    returning id into nid;
  else
    nid := p_id;
    update public.investimentos set nome = n, tipo = p_tipo, indexador = ix,
           taxa = case when ix in ('cotacao','manual','poupanca') then null else p_taxa end,
           vencimento = p_vencimento, isento = p_tipo in ('lci','lca','poupanca'), ticker = case when ix = 'cotacao' then tk end
     where id = nid;
  end if;
  return nid;
end $$;

create or replace function public.excluir_investimento(inv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_aprovado();
  if not exists (select 1 from public.investimentos where id = inv and criado_por = auth.uid()) then
    raise exception 'Só quem cadastrou pode excluir.';
  end if;
  delete from public.investimentos where id = inv;
end $$;

-- aporte, resgate ou "saldo de hoje". p_lancar: também lança em Lançamentos (aporte = saída, resgate = entrada)
create or replace function public.mover_investimento(inv uuid, p_tipo text, p_valor numeric, p_quantidade numeric, p_data date, p_lancar boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare i public.investimentos%rowtype; v numeric := round(coalesce(p_valor, 0), 2); lid uuid; mid uuid; qtd numeric;
begin
  perform public.exigir_aprovado();
  select * into i from public.investimentos where id = inv for update;
  if i.id is null or not public.eh_membro(i.controle_id) then raise exception 'Investimento não encontrado.'; end if;
  if p_tipo not in ('aporte','resgate','saldo') then raise exception 'Operação inválida.'; end if;
  if p_tipo = 'saldo' and i.indexador <> 'manual' then raise exception 'Este investimento é calculado automaticamente.'; end if;
  if v <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if p_data is null or p_data > current_date + 1 or p_data < date '1990-01-01' then raise exception 'Data inválida.'; end if;
  if i.indexador = 'cotacao' then
    if p_tipo = 'saldo' then raise exception 'Operação inválida.'; end if;
    if p_quantidade is null or p_quantidade <= 0 then raise exception 'Informe a quantidade.'; end if;
    if p_tipo = 'resgate' then
      select coalesce(sum(case when tipo = 'aporte' then quantidade else -quantidade end), 0) into qtd from public.inv_movs where investimento_id = inv;
      if p_quantidade > qtd then raise exception 'Você tem só % unidades deste ativo.', trim(to_char(qtd, 'FM999999990.######')); end if;
    end if;
  end if;
  if coalesce(p_lancar, false) and p_tipo <> 'saldo' then
    insert into public.lancamentos (user_id, controle_id, tipo, descricao, categoria, valor, data)
    values (auth.uid(), i.controle_id, case when p_tipo = 'aporte' then 'exp' else 'inc' end,
            case when p_tipo = 'aporte' then 'Aplicação: ' else 'Resgate: ' end || i.nome, 'Investimentos', v, p_data)
    returning id into lid;
  end if;
  insert into public.inv_movs (investimento_id, controle_id, user_id, tipo, valor, quantidade, data, lancamento_id)
  values (inv, i.controle_id, auth.uid(), p_tipo, v, case when i.indexador = 'cotacao' then p_quantidade end, p_data, lid)
  returning id into mid;
  return mid;
end $$;

create or replace function public.desfazer_inv_mov(mov uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.inv_movs%rowtype;
begin
  perform public.exigir_aprovado();
  select * into r from public.inv_movs where id = mov and user_id = auth.uid();
  if r.id is null then raise exception 'Só quem fez pode desfazer.'; end if;
  delete from public.inv_movs where id = mov;
  if r.lancamento_id is not null then delete from public.lancamentos where id = r.lancamento_id; end if;
end $$;

-- preço atual de ações e FIIs (por enquanto informado por quem participa do controle)
create or replace function public.atualizar_cotacao(inv uuid, p_preco numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_aprovado();
  if not exists (select 1 from public.investimentos where id = inv and indexador = 'cotacao' and public.eh_membro(controle_id)) then
    raise exception 'Investimento não encontrado.';
  end if;
  if p_preco is null or p_preco <= 0 then raise exception 'Informe um preço maior que zero.'; end if;
  update public.investimentos set cotacao = round(p_preco, 4), cotacao_em = current_date where id = inv;
end $$;

-- 5) ROBÔ DAS TAXAS: pede ao Banco Central e guarda na tabela "indices" --------
create or replace function public.indices_pedir(p_dias int default 40)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  base text := 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.';
  fim  text := to_char(current_date, 'DD/MM/YYYY');
  ini  text := to_char(current_date - greatest(p_dias, 5), 'DD/MM/YYYY');
  ini_ipca text := to_char(current_date - greatest(p_dias, 400), 'DD/MM/YYYY');
  r bigint;
begin
  r := net.http_get(url := base || '12/dados?formato=json&dataInicial=' || ini || '&dataFinal=' || fim, timeout_milliseconds := 30000);
  insert into public.indices_pedidos (req, serie) values (r, 'cdi') on conflict do nothing;
  r := net.http_get(url := base || '11/dados?formato=json&dataInicial=' || ini || '&dataFinal=' || fim, timeout_milliseconds := 30000);
  insert into public.indices_pedidos (req, serie) values (r, 'selic') on conflict do nothing;
  r := net.http_get(url := base || '433/dados?formato=json&dataInicial=' || ini_ipca || '&dataFinal=' || fim, timeout_milliseconds := 30000);
  insert into public.indices_pedidos (req, serie) values (r, 'ipca') on conflict do nothing;
  -- 432 = meta da Selic definida pelo Copom (% ao ano), só para mostrar na tela
  r := net.http_get(url := base || '432/dados?formato=json&dataInicial=' || ini || '&dataFinal=' || fim, timeout_milliseconds := 30000);
  insert into public.indices_pedidos (req, serie) values (r, 'selic_meta') on conflict do nothing;
end $$;

create or replace function public.indices_processar()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare p record; st int; ct text; n int := 0;
begin
  for p in select * from public.indices_pedidos order by criado loop
    select status_code, content into st, ct from net._http_response where id = p.req;
    if not found then
      if p.criado < now() - interval '2 hours' then delete from public.indices_pedidos where req = p.req; end if;
      continue;
    end if;
    if st = 200 and ct is not null and left(btrim(ct), 1) = '[' then
      insert into public.indices (serie, data, valor)
      select p.serie, to_date(e->>'data', 'DD/MM/YYYY'), replace(e->>'valor', ',', '.')::numeric
        from jsonb_array_elements(ct::jsonb) e
       where e->>'valor' ~ '^-?[0-9]+([.,][0-9]+)?$'
      on conflict (serie, data) do update set valor = excluded.valor;
      n := n + 1;
    end if;
    delete from public.indices_pedidos where req = p.req;
  end loop;
  return n;
end $$;

-- 6) PERMISSÕES ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['salvar_investimento(uuid, uuid, text, text, text, numeric, date, text)', 'excluir_investimento(uuid)',
                           'mover_investimento(uuid, text, numeric, numeric, date, boolean)', 'desfazer_inv_mov(uuid)',
                           'atualizar_cotacao(uuid, numeric)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- o robô só roda pelo agendador do banco, nunca pela internet
  execute 'revoke all on function public.indices_pedir(int) from public, anon, authenticated';
  execute 'revoke all on function public.indices_processar() from public, anon, authenticated';
end $$;

do $$
declare t text;
begin
  foreach t in array array['investimentos','inv_movs'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object or undefined_object then null;
    end;
  end loop;
end $$;

-- 7) AGENDA: busca as taxas 3x por dia (8h, 12h e 18h de Brasília) e guarda 5 min depois
select cron.schedule('pof-indices-pedir',     '0 11,15,21 * * *', 'select public.indices_pedir(40)');
select cron.schedule('pof-indices-processar', '5 11,15,21 * * *', 'select public.indices_processar()');

-- 8) PRIMEIRA CARGA: histórico de ~4 anos (fica pronto alguns segundos depois)
select public.indices_pedir(1500);
