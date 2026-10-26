-- =====================================================================
--  Pra Onde Foi? · CONTAS A PAGAR
--  Rodar depois do supabase-controles.sql. Pode rodar de novo sem problema.
--  Não apaga nem altera nada do que já existe.
-- =====================================================================

-- 1) TABELAS -----------------------------------------------------------

-- A conta em si (Luz, Aluguel, Cartão…). Uma linha por conta, não por mês.
create table if not exists public.contas (
  id          uuid primary key default gen_random_uuid(),
  controle_id uuid not null references public.controles(id) on delete cascade,
  criado_por  uuid references auth.users(id) on delete set null,
  nome        text not null check (char_length(nome) between 1 and 60),
  categoria   text not null check (char_length(categoria) between 1 and 60),
  valor       numeric(12,2) not null check (valor > 0),
  dia         smallint not null check (dia between 1 and 31),
  tipo        text not null check (tipo in ('fixa','parcelada','unica')),
  inicio      date not null check (extract(day from inicio) = 1),   -- 1º mês em que aparece
  parcelas    smallint check (parcelas between 2 and 240),          -- só para parcelada
  fim         date check (fim is null or extract(day from fim) = 1), -- fixa encerrada: último mês
  criado_em   timestamptz not null default now(),
  check ((tipo = 'parcelada') = (parcelas is not null))
);
create index if not exists contas_controle_idx on public.contas (controle_id);

-- Divisão: quanto cabe a cada pessoa (peso proporcional ao valor da conta)
create table if not exists public.conta_partes (
  conta_id uuid not null references public.contas(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  peso     numeric(12,2) not null check (peso > 0),
  primary key (conta_id, user_id)
);

-- Valor diferente só num mês (ex.: a luz deste mês veio R$ 187,30)
create table if not exists public.conta_meses (
  conta_id uuid not null references public.contas(id) on delete cascade,
  mes      date not null check (extract(day from mes) = 1),
  valor    numeric(12,2) not null check (valor > 0),
  primary key (conta_id, mes)
);

-- Pagamentos (podem ser vários por conta/mês: parcial, cada um a sua parte)
create table if not exists public.pagamentos (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references public.contas(id) on delete cascade,
  controle_id   uuid not null references public.controles(id) on delete cascade,
  mes           date not null check (extract(day from mes) = 1),
  user_id       uuid references auth.users(id) on delete set null,
  valor         numeric(12,2) not null check (valor > 0),
  data          date not null,
  -- a saída criada em Lançamentos; se alguém apagar a saída, o pagamento some junto
  lancamento_id uuid references public.lancamentos(id) on delete cascade,
  criado_em     timestamptz not null default now()
);
create index if not exists pagamentos_controle_mes_idx on public.pagamentos (controle_id, mes);
create index if not exists pagamentos_conta_mes_idx on public.pagamentos (conta_id, mes);

-- 2) FUNÇÕES DE APOIO ---------------------------------------------------

create or replace function public.conta_ocorre(p_tipo text, p_inicio date, p_parcelas int, p_fim date, m date)
returns boolean language sql immutable as $$
  select case p_tipo
    when 'unica'     then m = p_inicio
    when 'parcelada' then m >= p_inicio and m < (p_inicio + make_interval(months => p_parcelas))::date
    else                  m >= p_inicio and (p_fim is null or m <= p_fim)
  end;
$$;

create or replace function public.eh_membro_conta(conta uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.contas c
                   join public.membros m on m.controle_id = c.controle_id and m.user_id = auth.uid()
                  where c.id = conta);
$$;

-- 3) REGRAS DE ACESSO (só leitura direta; mudanças passam pelas funções) --
alter table public.contas       enable row level security;
alter table public.conta_partes enable row level security;
alter table public.conta_meses  enable row level security;
alter table public.pagamentos   enable row level security;

drop policy if exists "contas_ler" on public.contas;
create policy "contas_ler" on public.contas for select to authenticated
  using (public.eh_aprovado() and public.eh_membro(controle_id));
drop policy if exists "partes_ler" on public.conta_partes;
create policy "partes_ler" on public.conta_partes for select to authenticated
  using (public.eh_aprovado() and public.eh_membro_conta(conta_id));
drop policy if exists "meses_ler" on public.conta_meses;
create policy "meses_ler" on public.conta_meses for select to authenticated
  using (public.eh_aprovado() and public.eh_membro_conta(conta_id));
drop policy if exists "pag_ler" on public.pagamentos;
create policy "pag_ler" on public.pagamentos for select to authenticated
  using (public.eh_aprovado() and public.eh_membro(controle_id));

-- 4) AÇÕES ---------------------------------------------------------------

-- Criar (p_id nulo) ou editar uma conta. p_partes: [{"user_id":"…","peso":1}, …] ou [] para não dividir.
create or replace function public.salvar_conta(
  p_id uuid, cid uuid, p_nome text, p_categoria text, p_valor numeric, p_dia int,
  p_tipo text, p_inicio date, p_parcelas int, p_partes jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  nid uuid; n text := btrim(coalesce(p_nome,'')); cat text := btrim(coalesce(p_categoria,''));
  ini date := date_trunc('month', p_inicio)::date; parc int; p jsonb; eh_pessoal boolean;
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select controle_id into cid from public.contas where id = p_id and criado_por = auth.uid();
    if cid is null then raise exception 'Só quem criou a conta pode editar.'; end if;
  end if;
  if cid is null or not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if char_length(n) not between 1 and 60 then raise exception 'O nome precisa ter de 1 a 60 caracteres.'; end if;
  if char_length(cat) not between 1 and 60 then raise exception 'Escolha uma categoria.'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if p_dia is null or p_dia not between 1 and 31 then raise exception 'O dia do vencimento vai de 1 a 31.'; end if;
  if p_tipo not in ('fixa','parcelada','unica') then raise exception 'Tipo de conta inválido.'; end if;
  if ini is null then raise exception 'Informe o mês.'; end if;
  parc := case when p_tipo = 'parcelada' then p_parcelas end;
  if p_tipo = 'parcelada' and (parc is null or parc not between 2 and 240) then
    raise exception 'O número de parcelas vai de 2 a 240.';
  end if;

  select pessoal into eh_pessoal from public.controles where id = cid;
  p_partes := coalesce(p_partes, '[]'::jsonb);
  if jsonb_typeof(p_partes) <> 'array' then raise exception 'Divisão inválida.'; end if;
  if eh_pessoal and jsonb_array_length(p_partes) > 0 then raise exception 'O "Meu controle" não tem divisão.'; end if;
  for p in select * from jsonb_array_elements(p_partes) loop
    if not exists (select 1 from public.membros where controle_id = cid and user_id = (p->>'user_id')::uuid) then
      raise exception 'Só dá para dividir com quem participa do controle.';
    end if;
    if coalesce((p->>'peso')::numeric, 0) <= 0 then raise exception 'Cada parte precisa ter valor maior que zero.'; end if;
  end loop;

  if p_id is null then
    insert into public.contas (controle_id, criado_por, nome, categoria, valor, dia, tipo, inicio, parcelas)
    values (cid, auth.uid(), n, cat, round(p_valor, 2), p_dia, p_tipo, ini, parc) returning id into nid;
  else
    nid := p_id;
    update public.contas set nome = n, categoria = cat, valor = round(p_valor, 2), dia = p_dia, tipo = p_tipo,
           inicio = ini, parcelas = parc, fim = case when p_tipo = 'fixa' then fim end
     where id = nid;
    delete from public.conta_partes where conta_id = nid;
  end if;
  insert into public.conta_partes (conta_id, user_id, peso)
  select nid, (e->>'user_id')::uuid, round((e->>'peso')::numeric, 2) from jsonb_array_elements(p_partes) e
  on conflict (conta_id, user_id) do update set peso = excluded.peso;
  return nid;
end $$;

-- Valor só de um mês (null volta ao valor normal)
create or replace function public.valor_do_mes(conta uuid, p_mes date, p_valor numeric)
returns void language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_mes)::date;
begin
  perform public.exigir_aprovado();
  if not exists (select 1 from public.contas where id = conta and criado_por = auth.uid()) then
    raise exception 'Só quem criou a conta pode mudar o valor.';
  end if;
  if p_valor is null then
    delete from public.conta_meses where conta_id = conta and mes = m;
  else
    if p_valor <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
    insert into public.conta_meses (conta_id, mes, valor) values (conta, m, round(p_valor, 2))
    on conflict (conta_id, mes) do update set valor = excluded.valor;
  end if;
end $$;

-- Conta fixa: para de aparecer a partir de p_mes (os meses anteriores ficam)
create or replace function public.encerrar_conta(conta uuid, p_mes date)
returns void language plpgsql security definer set search_path = public as $$
declare c public.contas%rowtype; m date := date_trunc('month', p_mes)::date;
begin
  perform public.exigir_aprovado();
  select * into c from public.contas where id = conta and criado_por = auth.uid();
  if c.id is null then raise exception 'Só quem criou a conta pode encerrar.'; end if;
  if m <= c.inicio then
    delete from public.contas where id = conta;
  else
    update public.contas set tipo = 'fixa', parcelas = null, fim = (m - interval '1 month')::date where id = conta;
  end if;
end $$;

create or replace function public.excluir_conta(conta uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_aprovado();
  if not exists (select 1 from public.contas where id = conta and criado_por = auth.uid()) then
    raise exception 'Só quem criou a conta pode excluir.';
  end if;
  delete from public.contas where id = conta;   -- as saídas já lançadas continuam em Lançamentos
end $$;

-- Pagar (tudo ou parte). Cria a saída em Lançamentos no nome de quem pagou.
create or replace function public.pagar_conta(conta uuid, p_mes date, p_valor numeric, p_data date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.contas%rowtype; m date := date_trunc('month', p_mes)::date;
  total numeric; pago numeric; falta numeric; v numeric := round(coalesce(p_valor,0), 2);
  descr text; lid uuid; pid uuid;
begin
  perform public.exigir_aprovado();
  select * into c from public.contas where id = conta for update;
  if c.id is null or not public.eh_membro(c.controle_id) then raise exception 'Conta não encontrada.'; end if;
  if not public.conta_ocorre(c.tipo, c.inicio, c.parcelas, c.fim, m) then raise exception 'Essa conta não existe neste mês.'; end if;
  if v <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if p_data is null or abs(p_data - current_date) > 400 then raise exception 'Data do pagamento inválida.'; end if;
  select coalesce((select valor from public.conta_meses where conta_id = conta and mes = m), c.valor) into total;
  select coalesce(sum(valor), 0) into pago from public.pagamentos where conta_id = conta and mes = m;
  falta := total - pago;
  if falta <= 0 then raise exception 'Essa conta já está paga.'; end if;
  if v > falta then raise exception 'O valor é maior do que falta pagar (R$ %).', translate(to_char(falta, 'FM999,999,990.00'), ',.', '.,'); end if;

  descr := c.nome || case when c.tipo = 'parcelada'
             then ' ' || ((extract(year from age(m, c.inicio)) * 12 + extract(month from age(m, c.inicio)))::int + 1) || '/' || c.parcelas
             else '' end;
  insert into public.lancamentos (user_id, controle_id, tipo, descricao, categoria, valor, data)
  values (auth.uid(), c.controle_id, 'exp', descr, c.categoria, v, p_data) returning id into lid;
  insert into public.pagamentos (conta_id, controle_id, mes, user_id, valor, data, lancamento_id)
  values (conta, c.controle_id, m, auth.uid(), v, p_data, lid) returning id into pid;
  return pid;
end $$;

-- Desfazer um pagamento seu: apaga o pagamento e a saída que ele criou
create or replace function public.desfazer_pagamento(pag uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  perform public.exigir_aprovado();
  select lancamento_id into lid from public.pagamentos where id = pag and user_id = auth.uid();
  if not found then raise exception 'Só quem pagou pode desfazer.'; end if;
  delete from public.pagamentos where id = pag;
  if lid is not null then delete from public.lancamentos where id = lid; end if;
end $$;

-- 5) PERMISSÕES -----------------------------------------------------------
revoke all on public.contas, public.conta_partes, public.conta_meses, public.pagamentos from anon;
grant select on public.contas, public.conta_partes, public.conta_meses, public.pagamentos to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'conta_ocorre(text, date, int, date, date)', 'eh_membro_conta(uuid)',
    'salvar_conta(uuid, uuid, text, text, numeric, int, text, date, int, jsonb)',
    'valor_do_mes(uuid, date, numeric)', 'encerrar_conta(uuid, date)', 'excluir_conta(uuid)',
    'pagar_conta(uuid, date, numeric, date)', 'desfazer_pagamento(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- 6) TEMPO REAL (a outra pessoa vê na hora) --------------------------------
do $$
declare t text;
begin
  foreach t in array array['lancamentos','membros','convites','contas','conta_partes','conta_meses','pagamentos'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
