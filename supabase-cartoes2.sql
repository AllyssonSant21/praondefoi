-- =====================================================================
--  Pra Onde Foi? · CARTÕES, PARTE 2
--  Rodar depois do supabase-cartoes.sql. Pode rodar de novo sem problema.
--  Não apaga nem altera nada do que já existe.
--
--  1) Parcelado que já estava rolando antes do app ("estou na parcela 5 de 10")
--  2) Saldo anterior: um valor que já estava na fatura (sem lançar compra por compra)
-- =====================================================================

alter table public.compras_cartao add column if not exists parcela_ini smallint not null default 1;
alter table public.compras_cartao add column if not exists ajuste boolean not null default false;
alter table public.compras_cartao drop constraint if exists compras_parcela_ini_chk;
alter table public.compras_cartao add constraint compras_parcela_ini_chk check (parcela_ini between 1 and parcelas);

-- total de uma fatura: soma das parcelas que caem nela.
-- A compra começa a cair na fatura "fatura" pela parcela "parcela_ini" (centavos que sobram ficam na parcela 1)
create or replace function public.total_fatura(p_cartao uuid, p_mes date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(
           case when j = 0 then valor - trunc(valor / parcelas, 2) * (parcelas - 1) else trunc(valor / parcelas, 2) end), 0)
    from (select c.valor, c.parcelas,
                 c.parcela_ini - 1 + ((extract(year from age(p_mes, c.fatura)) * 12 + extract(month from age(p_mes, c.fatura)))::int) as j
            from public.compras_cartao c
           where c.cartao_id = p_cartao and c.fatura <= p_mes) x
   where j >= 0 and j < parcelas;
$$;

-- lançar ou editar uma compra (agora com a parcela em que já está)
create or replace function public.salvar_compra(p_id uuid, p_cartao uuid, p_desc text, p_cat text, p_valor numeric, p_parcelas int, p_data date, p_parcela_ini int)
returns date language plpgsql security definer set search_path = public as $$
declare k public.cartoes%rowtype; x public.compras_cartao%rowtype; d text := btrim(coalesce(p_desc, ''));
        cat text := btrim(coalesce(p_cat, '')); v numeric := round(coalesce(p_valor, 0), 2); f date; ini int := coalesce(p_parcela_ini, 1);
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select * into x from public.compras_cartao where id = p_id;
    if x.id is null or not public.eh_membro(x.controle_id) then raise exception 'Compra não encontrada.'; end if;
    if x.user_id is distinct from auth.uid() and not public.eh_dono(x.controle_id) then raise exception 'Só quem lançou a compra pode mudar.'; end if;
    if x.ajuste then raise exception 'Isso é um saldo anterior da fatura. Edite pelo botão da fatura.'; end if;
  end if;
  select * into k from public.cartoes where id = p_cartao;
  if k.id is null or not public.eh_membro(k.controle_id) then raise exception 'Cartão não encontrado.'; end if;
  if x.id is not null and x.controle_id <> k.controle_id then raise exception 'Cartão não encontrado.'; end if;
  if not public.modulo_ativo(k.controle_id, 'cartoes') then raise exception 'Este controle não compartilha Cartões.'; end if;
  if char_length(d) not between 1 and 200 then raise exception 'Escreva uma descrição.'; end if;
  if char_length(cat) not between 1 and 60 then raise exception 'Escolha uma categoria.'; end if;
  if v <= 0 or v > 9999999 then raise exception 'Informe um valor maior que zero.'; end if;
  if p_parcelas is null or p_parcelas not between 1 and 24 then raise exception 'As parcelas vão de 1 a 24.'; end if;
  if ini not between 1 and p_parcelas then raise exception 'A parcela atual tem que estar entre 1 e %.', p_parcelas; end if;
  if p_data is null or abs(p_data - current_date) > 800 then raise exception 'Data inválida.'; end if;
  f := public.fatura_da_compra(k.fecha, k.vence, p_data);
  if p_id is null then
    insert into public.compras_cartao (cartao_id, controle_id, user_id, descricao, categoria, valor, parcelas, parcela_ini, data, fatura)
    values (k.id, k.controle_id, auth.uid(), d, cat, v, p_parcelas, ini, p_data, f);
  else
    update public.compras_cartao set cartao_id = k.id, descricao = d, categoria = cat, valor = v, parcelas = p_parcelas,
           parcela_ini = ini, data = p_data, fatura = f
     where id = p_id;
  end if;
  return f;
end $$;

-- a versão antiga (sem a parcela atual) continua funcionando: começa na parcela 1
create or replace function public.salvar_compra(p_id uuid, p_cartao uuid, p_desc text, p_cat text, p_valor numeric, p_parcelas int, p_data date)
returns date language sql security definer set search_path = public as $$
  select public.salvar_compra(p_id, p_cartao, p_desc, p_cat, p_valor, p_parcelas, p_data, 1);
$$;

-- saldo anterior: um valor que já estava numa fatura (fica como uma linha "Saldo anterior" nela)
create or replace function public.salvar_ajuste_fatura(p_id uuid, p_cartao uuid, p_mes date, p_valor numeric, p_desc text)
returns uuid language plpgsql security definer set search_path = public as $$
declare k public.cartoes%rowtype; x public.compras_cartao%rowtype; m date := date_trunc('month', p_mes)::date;
        v numeric := round(coalesce(p_valor, 0), 2); d text := coalesce(nullif(btrim(coalesce(p_desc, '')), ''), 'Saldo anterior da fatura');
        dia date; nid uuid;
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select * into x from public.compras_cartao where id = p_id;
    if x.id is null or not public.eh_membro(x.controle_id) or not x.ajuste then raise exception 'Saldo não encontrado.'; end if;
    if x.user_id is distinct from auth.uid() and not public.eh_dono(x.controle_id) then raise exception 'Só quem lançou pode mudar.'; end if;
  end if;
  select * into k from public.cartoes where id = coalesce(p_cartao, x.cartao_id);
  if k.id is null or not public.eh_membro(k.controle_id) then raise exception 'Cartão não encontrado.'; end if;
  if not public.modulo_ativo(k.controle_id, 'cartoes') then raise exception 'Este controle não compartilha Cartões.'; end if;
  if m is null or abs(m - date_trunc('month', current_date)::date) > 800 then raise exception 'Escolha o mês da fatura.'; end if;
  if v <= 0 or v > 9999999 then raise exception 'Informe um valor maior que zero.'; end if;
  if char_length(d) > 200 then raise exception 'Descrição muito longa.'; end if;
  -- a data fica no meio do período da fatura (14 dias depois do fechamento anterior),
  -- para o saldo aparecer junto com as compras daquela fatura
  dia := (case when k.vence <= k.fecha then m - interval '2 month' else m - interval '1 month' end)::date;
  dia := dia + (least(k.fecha, extract(day from (dia + interval '1 month - 1 day'))::int) - 1) + 14;
  if p_id is null then
    insert into public.compras_cartao (cartao_id, controle_id, user_id, descricao, categoria, valor, parcelas, parcela_ini, data, fatura, ajuste)
    values (k.id, k.controle_id, auth.uid(), d, 'Outros', v, 1, 1, dia, m, true) returning id into nid;
  else
    nid := p_id;
    update public.compras_cartao set cartao_id = k.id, descricao = d, valor = v, data = dia, fatura = m where id = nid;
  end if;
  return nid;
end $$;

-- mudou o fechamento/vencimento do cartão: o saldo anterior fica na fatura que a pessoa escolheu
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
    if c.fecha <> p_fecha or c.vence <> p_vence then
      update public.compras_cartao x set fatura = public.fatura_da_compra(p_fecha, p_vence, x.data)
       where x.cartao_id = nid and not x.ajuste
         and not exists (select 1 from public.pag_faturas p where p.cartao_id = nid and p.mes >= x.fatura);
    end if;
  end if;
  return nid;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'salvar_compra(uuid, uuid, text, text, numeric, int, date, int)', 'salvar_compra(uuid, uuid, text, text, numeric, int, date)',
    'salvar_ajuste_fatura(uuid, uuid, date, numeric, text)', 'salvar_cartao(uuid, uuid, text, text, text, int, int, numeric)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.total_fatura(uuid, date) from public, anon, authenticated';
  -- funções internas de registro: ninguém chama direto (fecha o que sobrou aberto)
  foreach f in array array['ev_usuarios()', 'ev_perfis()', 'ev_membros()', 'ev_controles()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
