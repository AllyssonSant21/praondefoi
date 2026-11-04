-- =====================================================================
--  Pra Onde Foi? · CARTÕES DE CRÉDITO
--  Rodar depois do supabase-categorias.sql. Pode rodar de novo sem problema.
--  Não apaga nem altera nada do que já existe.
--
--  O app NUNCA guarda dados do cartão: nada de número, CVV, validade, senha,
--  agência ou conta. Só um apelido, o banco (para a cor), o dia que a fatura
--  fecha, o dia que vence e, se a pessoa quiser, o limite.
--
--  Compra no cartão não mexe no saldo do mês. Ela vai para a fatura; quando a
--  fatura é paga, aí sim entra uma saída em Lançamentos.
-- =====================================================================

-- 1) TABELAS -----------------------------------------------------------
create table if not exists public.cartoes (
  id          uuid primary key default gen_random_uuid(),
  controle_id uuid not null references public.controles(id) on delete cascade,
  nome        text not null check (char_length(btrim(nome)) between 1 and 30),
  banco       text check (banco is null or char_length(banco) <= 20),   -- chave da lista de bancos (só para a cor)
  icone       text check (icone is null or char_length(icone) <= 8),
  fecha       smallint not null check (fecha between 1 and 31),
  vence       smallint not null check (vence between 1 and 31),
  limite      numeric(12,2) check (limite is null or limite > 0),
  oculto      boolean not null default false,
  criado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em   timestamptz not null default now()
);
create index if not exists cartoes_controle_idx on public.cartoes (controle_id);

-- compra (à vista ou parcelada). fatura = mês da fatura da 1ª parcela (dia 1)
create table if not exists public.compras_cartao (
  id          uuid primary key default gen_random_uuid(),
  cartao_id   uuid not null references public.cartoes(id) on delete cascade,
  controle_id uuid not null references public.controles(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  descricao   text not null check (char_length(btrim(descricao)) between 1 and 200),
  categoria   text not null check (char_length(categoria) between 1 and 60),
  valor       numeric(12,2) not null check (valor > 0),
  parcelas    smallint not null default 1 check (parcelas between 1 and 24),
  data        date not null,
  fatura      date not null check (extract(day from fatura) = 1),
  criado_em   timestamptz not null default now()
);
create index if not exists compras_cartao_idx on public.compras_cartao (cartao_id, fatura);
create index if not exists compras_controle_idx on public.compras_cartao (controle_id, fatura);

-- pagamento da fatura (pode ser em partes). Cria a saída em Lançamentos.
create table if not exists public.pag_faturas (
  id            uuid primary key default gen_random_uuid(),
  cartao_id     uuid not null references public.cartoes(id) on delete cascade,
  controle_id   uuid not null references public.controles(id) on delete cascade,
  mes           date not null check (extract(day from mes) = 1),
  user_id       uuid references auth.users(id) on delete set null,
  valor         numeric(12,2) not null check (valor > 0),
  data          date not null,
  lancamento_id uuid references public.lancamentos(id) on delete cascade,  -- apagou a saída, o pagamento some junto
  criado_em     timestamptz not null default now()
);
create index if not exists pag_faturas_idx on public.pag_faturas (cartao_id, mes);

-- 2) ÁREA "CARTÕES" NOS CONTROLES COMPARTILHADOS ------------------------
do $$
declare ja boolean;
begin
  select coalesce(bool_or(pg_get_constraintdef(oid) like '%cartoes%'), false) into ja
    from pg_constraint where conname = 'controles_modulos_chk';
  alter table public.controles drop constraint if exists controles_modulos_chk;
  alter table public.controles add constraint controles_modulos_chk
    check (cardinality(modulos) >= 1 and modulos <@ array['lanc','contas','metas','invest','cartoes']);
  -- só na 1ª vez: quem já compartilha os gastos passa a compartilhar os cartões também
  if not ja then
    update public.controles set modulos = modulos || array['cartoes'] where 'lanc' = any(modulos) and not ('cartoes' = any(modulos));
  end if;
end $$;
alter table public.controles alter column modulos set default array['lanc','contas','metas','invest','cartoes'];

create or replace function public.definir_modulos(cid uuid, p_modulos text[])
returns void language plpgsql security definer set search_path = public as $$
declare ms text[];
begin
  perform public.exigir_aprovado();
  if not public.eh_dono(cid) then raise exception 'Só o dono escolhe o que o controle compartilha.'; end if;
  if (select pessoal from public.controles where id = cid) then raise exception 'O "Meu controle" sempre tem tudo.'; end if;
  select array_agg(distinct x order by x) into ms from unnest(coalesce(p_modulos, '{}')) x where x in ('lanc','contas','metas','invest','cartoes');
  if ms is null or cardinality(ms) = 0 then raise exception 'Deixe pelo menos uma área ligada.'; end if;
  update public.controles set modulos = ms where id = cid;
end $$;

create or replace function public.meus_controles()
returns table (id uuid, nome text, pessoal boolean, sou_dono boolean, participantes int, codigo text, codigo_expira timestamptz, modulos text[])
language sql stable security definer set search_path = public as $$
  select c.id, c.nome, c.pessoal, c.dono = auth.uid(),
         (select count(*)::int from public.membros m2 where m2.controle_id = c.id),
         case when c.dono = auth.uid() and c.codigo_expira > now() then c.codigo end,
         case when c.dono = auth.uid() and c.codigo_expira > now() then c.codigo_expira end,
         case when c.pessoal then array['lanc','contas','metas','invest','cartoes'] else c.modulos end
    from public.controles c
    join public.membros m on m.controle_id = c.id and m.user_id = auth.uid()
   where public.eh_aprovado()
   order by c.pessoal desc, c.criado_em;
$$;

-- 3) LEITURA: quem participa do controle vê; mudanças só pelas funções ---
alter table public.cartoes        enable row level security;
alter table public.compras_cartao enable row level security;
alter table public.pag_faturas    enable row level security;
drop policy if exists cartoes_ler on public.cartoes;
create policy cartoes_ler on public.cartoes for select to authenticated using (public.eh_aprovado() and public.eh_membro(controle_id));
drop policy if exists compras_ler on public.compras_cartao;
create policy compras_ler on public.compras_cartao for select to authenticated using (public.eh_aprovado() and public.eh_membro(controle_id));
drop policy if exists pagfat_ler on public.pag_faturas;
create policy pagfat_ler on public.pag_faturas for select to authenticated using (public.eh_aprovado() and public.eh_membro(controle_id));
revoke all on public.cartoes, public.compras_cartao, public.pag_faturas from anon;
revoke insert, update, delete, truncate, references, trigger on public.cartoes, public.compras_cartao, public.pag_faturas from authenticated;
grant select on public.cartoes, public.compras_cartao, public.pag_faturas to authenticated;

-- 4) CONTAS DA FATURA ----------------------------------------------------
-- em qual fatura (mês do vencimento) cai uma compra feita em p_data
create or replace function public.fatura_da_compra(p_fecha int, p_vence int, p_data date)
returns date language sql immutable as $$
  -- comprou no dia do fechamento ou depois: vai para a próxima fatura
  select (date_trunc('month', p_data)
          + make_interval(months => (case when extract(day from p_data) >= least(p_fecha, extract(day from (date_trunc('month', p_data) + interval '1 month - 1 day'))::int) then 1 else 0 end)
                                  + (case when p_vence <= p_fecha then 1 else 0 end)))::date;
$$;

-- total de uma fatura: soma das parcelas que caem nela (centavos que sobram ficam na 1ª parcela)
create or replace function public.total_fatura(p_cartao uuid, p_mes date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(
           case when k = 0 then valor - trunc(valor / parcelas, 2) * (parcelas - 1) else trunc(valor / parcelas, 2) end), 0)
    from (select c.valor, c.parcelas,
                 ((extract(year from age(p_mes, c.fatura)) * 12 + extract(month from age(p_mes, c.fatura)))::int) as k
            from public.compras_cartao c
           where c.cartao_id = p_cartao and c.fatura <= p_mes) x
   where k >= 0 and k < parcelas;
$$;

-- 5) AÇÕES ---------------------------------------------------------------
create or replace function public.pode_mexer_cartao(p_criado_por uuid, p_controle uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_criado_por is not distinct from auth.uid() or public.eh_dono(p_controle);
$$;

-- criar ou editar um cartão (só apelido, banco, fechamento, vencimento e limite)
create or replace function public.salvar_cartao(p_id uuid, cid uuid, p_nome text, p_banco text, p_icone text,
                                                p_fecha int, p_vence int, p_limite numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(p_nome, '')); b text := nullif(btrim(coalesce(p_banco, '')), '');
        ic text := nullif(btrim(coalesce(p_icone, '')), ''); c public.cartoes%rowtype; nid uuid;
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select * into c from public.cartoes where id = p_id;
    if c.id is null or not public.eh_membro(c.controle_id) then raise exception 'Cartão não encontrado.'; end if;
    if not public.pode_mexer_cartao(c.criado_por, c.controle_id) then raise exception 'Só quem cadastrou o cartão (ou o dono do controle) pode mudar.'; end if;
    cid := c.controle_id;
  end if;
  if cid is null or not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if not public.modulo_ativo(cid, 'cartoes') then raise exception 'Este controle não compartilha Cartões.'; end if;
  if char_length(n) not between 1 and 30 then raise exception 'Dê um apelido para o cartão (até 30 caracteres).'; end if;
  -- não deixa digitar número de cartão no apelido (12+ dígitos seguidos)
  if regexp_replace(n, '[\s.-]', '', 'g') ~ '\d{12,}' then raise exception 'Não coloque o número do cartão. Use só um apelido, como "Nubank".'; end if;
  if b is not null and (char_length(b) > 20 or b !~ '^[a-z0-9_]+$') then raise exception 'Banco inválido.'; end if;
  if ic is not null and char_length(ic) > 8 then raise exception 'Ícone inválido.'; end if;
  if p_fecha is null or p_fecha not between 1 and 31 then raise exception 'O dia do fechamento vai de 1 a 31.'; end if;
  if p_vence is null or p_vence not between 1 and 31 then raise exception 'O dia do vencimento vai de 1 a 31.'; end if;
  if p_limite is not null and (p_limite <= 0 or p_limite > 9999999) then raise exception 'Limite inválido.'; end if;
  if p_id is null then
    if (select count(*) from public.cartoes where controle_id = cid) >= 15 then raise exception 'Este controle já tem 15 cartões.'; end if;
    insert into public.cartoes (controle_id, nome, banco, icone, fecha, vence, limite)
    values (cid, n, b, ic, p_fecha, p_vence, round(p_limite, 2)) returning id into nid;
  else
    nid := p_id;
    update public.cartoes set nome = n, banco = b, icone = ic, fecha = p_fecha, vence = p_vence, limite = round(p_limite, 2) where id = nid;
    -- mudou o fechamento/vencimento: as compras ainda não pagas são recalculadas
    if c.fecha <> p_fecha or c.vence <> p_vence then
      update public.compras_cartao x set fatura = public.fatura_da_compra(p_fecha, p_vence, x.data)
       where x.cartao_id = nid
         and not exists (select 1 from public.pag_faturas p where p.cartao_id = nid and p.mes >= x.fatura);
    end if;
  end if;
  return nid;
end $$;

-- esconder (mantém as compras) ou excluir de vez (some com as compras; as saídas já pagas continuam)
create or replace function public.ocultar_cartao(p_id uuid, p_oculto boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c public.cartoes%rowtype;
begin
  perform public.exigir_aprovado();
  select * into c from public.cartoes where id = p_id;
  if c.id is null or not public.eh_membro(c.controle_id) then raise exception 'Cartão não encontrado.'; end if;
  if not public.pode_mexer_cartao(c.criado_por, c.controle_id) then raise exception 'Só quem cadastrou o cartão (ou o dono do controle) pode mudar.'; end if;
  update public.cartoes set oculto = coalesce(p_oculto, true) where id = p_id;
end $$;

create or replace function public.excluir_cartao(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.cartoes%rowtype;
begin
  perform public.exigir_aprovado();
  select * into c from public.cartoes where id = p_id;
  if c.id is null or not public.eh_membro(c.controle_id) then raise exception 'Cartão não encontrado.'; end if;
  if not public.pode_mexer_cartao(c.criado_por, c.controle_id) then raise exception 'Só quem cadastrou o cartão (ou o dono do controle) pode excluir.'; end if;
  update public.pag_faturas set lancamento_id = null where cartao_id = p_id;   -- as faturas pagas continuam em Lançamentos
  delete from public.cartoes where id = p_id;
end $$;

-- lançar ou editar uma compra no cartão
create or replace function public.salvar_compra(p_id uuid, p_cartao uuid, p_desc text, p_cat text, p_valor numeric, p_parcelas int, p_data date)
returns date language plpgsql security definer set search_path = public as $$
declare k public.cartoes%rowtype; x public.compras_cartao%rowtype; d text := btrim(coalesce(p_desc, ''));
        cat text := btrim(coalesce(p_cat, '')); v numeric := round(coalesce(p_valor, 0), 2); f date;
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select * into x from public.compras_cartao where id = p_id;
    if x.id is null or not public.eh_membro(x.controle_id) then raise exception 'Compra não encontrada.'; end if;
    if x.user_id is distinct from auth.uid() and not public.eh_dono(x.controle_id) then raise exception 'Só quem lançou a compra pode mudar.'; end if;
  end if;
  select * into k from public.cartoes where id = p_cartao;
  if k.id is null or not public.eh_membro(k.controle_id) then raise exception 'Cartão não encontrado.'; end if;
  if x.id is not null and x.controle_id <> k.controle_id then raise exception 'Cartão não encontrado.'; end if;
  if not public.modulo_ativo(k.controle_id, 'cartoes') then raise exception 'Este controle não compartilha Cartões.'; end if;
  if char_length(d) not between 1 and 200 then raise exception 'Escreva uma descrição.'; end if;
  if char_length(cat) not between 1 and 60 then raise exception 'Escolha uma categoria.'; end if;
  if v <= 0 or v > 9999999 then raise exception 'Informe um valor maior que zero.'; end if;
  if p_parcelas is null or p_parcelas not between 1 and 24 then raise exception 'As parcelas vão de 1 a 24.'; end if;
  if p_data is null or abs(p_data - current_date) > 800 then raise exception 'Data da compra inválida.'; end if;
  f := public.fatura_da_compra(k.fecha, k.vence, p_data);
  if p_id is null then
    insert into public.compras_cartao (cartao_id, controle_id, user_id, descricao, categoria, valor, parcelas, data, fatura)
    values (k.id, k.controle_id, auth.uid(), d, cat, v, p_parcelas, p_data, f);
  else
    update public.compras_cartao set cartao_id = k.id, descricao = d, categoria = cat, valor = v, parcelas = p_parcelas, data = p_data, fatura = f
     where id = p_id;
  end if;
  return f;
end $$;

create or replace function public.excluir_compra(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare x public.compras_cartao%rowtype;
begin
  perform public.exigir_aprovado();
  select * into x from public.compras_cartao where id = p_id;
  if x.id is null or not public.eh_membro(x.controle_id) then raise exception 'Compra não encontrada.'; end if;
  if x.user_id is distinct from auth.uid() and not public.eh_dono(x.controle_id) then raise exception 'Só quem lançou a compra pode excluir.'; end if;
  delete from public.compras_cartao where id = p_id;
end $$;

-- pagar a fatura (tudo ou parte): cria a saída em Lançamentos, categoria "Cartão de crédito"
create or replace function public.pagar_fatura(p_cartao uuid, p_mes date, p_valor numeric, p_data date)
returns uuid language plpgsql security definer set search_path = public as $$
declare k public.cartoes%rowtype; m date := date_trunc('month', p_mes)::date; v numeric := round(coalesce(p_valor, 0), 2);
        total numeric; pago numeric; falta numeric; lid uuid; pid uuid;
        meses text[] := array['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
begin
  perform public.exigir_aprovado();
  select * into k from public.cartoes where id = p_cartao for update;
  if k.id is null or not public.eh_membro(k.controle_id) then raise exception 'Cartão não encontrado.'; end if;
  if m is null then raise exception 'Informe o mês da fatura.'; end if;
  if v <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if p_data is null or abs(p_data - current_date) > 400 then raise exception 'Data do pagamento inválida.'; end if;
  total := public.total_fatura(k.id, m);
  select coalesce(sum(valor), 0) into pago from public.pag_faturas where cartao_id = k.id and mes = m;
  falta := total - pago;
  if falta <= 0 then raise exception 'Essa fatura já está paga.'; end if;
  if v > falta then raise exception 'O valor é maior do que falta pagar (R$ %).', translate(to_char(falta, 'FM999,999,990.00'), ',.', '.,'); end if;
  insert into public.lancamentos (user_id, controle_id, tipo, descricao, categoria, valor, data)
  values (auth.uid(), k.controle_id, 'exp', 'Fatura ' || k.nome || ' · ' || meses[extract(month from m)::int] || '/' || to_char(m, 'YY'),
          'Cartão de crédito', v, p_data) returning id into lid;
  insert into public.pag_faturas (cartao_id, controle_id, mes, user_id, valor, data, lancamento_id)
  values (k.id, k.controle_id, m, auth.uid(), v, p_data, lid) returning id into pid;
  return pid;
end $$;

create or replace function public.desfazer_pag_fatura(pag uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  perform public.exigir_aprovado();
  select lancamento_id into lid from public.pag_faturas where id = pag and user_id = auth.uid();
  if not found then raise exception 'Só quem pagou pode desfazer.'; end if;
  delete from public.pag_faturas where id = pag;
  if lid is not null then delete from public.lancamentos where id = lid; end if;
end $$;

-- "Cartão de crédito" passa a ser categoria do app (não dá para criar outra com esse nome)
create or replace function public.salvar_categoria(p_id uuid, cid uuid, p_nome text, p_icone text, p_tipo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(p_nome, '')); ic text := nullif(btrim(coalesce(p_icone, '')), ''); antigo text; nid uuid; c public.categorias%rowtype;
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select * into c from public.categorias where id = p_id;
    if c.id is null or not public.eh_membro(c.controle_id) then raise exception 'Categoria não encontrada.'; end if;
    if c.criado_por is distinct from auth.uid() and not public.eh_dono(c.controle_id) then
      raise exception 'Só quem criou a categoria (ou o dono do controle) pode mudar.';
    end if;
    cid := c.controle_id; antigo := c.nome;
  end if;
  if cid is null or not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if char_length(n) not between 1 and 30 then raise exception 'Dê um nome para a categoria (até 30 caracteres).'; end if;
  if lower(n) in ('mercado','moradia','contas','transporte','saúde','saude','lazer','educação','educacao','outros','salário','salario','renda extra','metas',
                  'cartão de crédito','cartao de credito') then
    raise exception 'Essa categoria já existe no app.';
  end if;
  if p_tipo not in ('exp','inc','ambos') then raise exception 'Escolha se é para saída, entrada ou as duas.'; end if;
  if ic is not null and char_length(ic) > 8 then raise exception 'Ícone inválido.'; end if;
  if exists (select 1 from public.categorias where controle_id = cid and lower(btrim(nome)) = lower(n) and id is distinct from p_id) then
    raise exception 'Já existe uma categoria com esse nome neste controle.';
  end if;
  if p_id is null then
    if (select count(*) from public.categorias where controle_id = cid) >= 40 then
      raise exception 'Este controle já tem 40 categorias. Esconda ou renomeie alguma.';
    end if;
    insert into public.categorias (controle_id, tipo, nome, icone) values (cid, p_tipo, n, ic) returning id into nid;
  else
    nid := p_id;
    update public.categorias set nome = n, icone = ic, tipo = p_tipo where id = nid;
    if antigo is distinct from n then
      update public.lancamentos set categoria = n where controle_id = cid and categoria = antigo;
      update public.contas set categoria = n where controle_id = cid and categoria = antigo;
      update public.compras_cartao set categoria = n where controle_id = cid and categoria = antigo;
    end if;
  end if;
  return nid;
end $$;

-- 6) PERMISSÕES -----------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'definir_modulos(uuid, text[])', 'meus_controles()',
    'salvar_cartao(uuid, uuid, text, text, text, int, int, numeric)', 'ocultar_cartao(uuid, boolean)', 'excluir_cartao(uuid)',
    'salvar_compra(uuid, uuid, text, text, numeric, int, date)', 'excluir_compra(uuid)',
    'pagar_fatura(uuid, date, numeric, date)', 'desfazer_pag_fatura(uuid)', 'salvar_categoria(uuid, uuid, text, text, text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- funções internas: só o próprio banco usa
  foreach f in array array['total_fatura(uuid, date)', 'pode_mexer_cartao(uuid, uuid)', 'fatura_da_compra(int, int, date)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- 7) TEMPO REAL (a outra pessoa do controle vê na hora) --------------------
do $$
declare t text;
begin
  foreach t in array array['cartoes','compras_cartao','pag_faturas'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object or undefined_object then null;
    end;
  end loop;
end $$;
