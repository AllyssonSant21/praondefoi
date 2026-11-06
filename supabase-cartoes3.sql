-- =====================================================================
--  Pra Onde Foi? · CARTÕES, PARTE 3
--  Rodar depois do supabase-cartoes2.sql. Pode rodar de novo sem problema.
--  Não apaga nem altera nada do que já existe.
--
--  Compra antiga lançada com a data de verdade (ex.: janeiro, em 12x):
--  as parcelas cujas faturas já venceram ficam de fora ("já pagas").
--  A data guardada é sempre a da compra; a fatura guardada é a da 1ª parcela que entra.
-- =====================================================================

-- primeira fatura que ainda não venceu (a do mês, se o vencimento ainda não passou; senão a do mês seguinte)
create or replace function public.fatura_pendente(p_vence int, p_hoje date default current_date)
returns date language sql immutable as $$
  select (case when p_hoje <= (date_trunc('month', p_hoje)::date
                               + (least(p_vence, extract(day from (date_trunc('month', p_hoje) + interval '1 month - 1 day'))::int) - 1))
               then date_trunc('month', p_hoje) else date_trunc('month', p_hoje) + interval '1 month' end)::date;
$$;

-- lançar ou editar uma compra.
-- p_parcela_ini = parcela que entra no app (1 + quantas já foram pagas). Vazio: o app calcula pela data.
create or replace function public.salvar_compra(p_id uuid, p_cartao uuid, p_desc text, p_cat text, p_valor numeric, p_parcelas int, p_data date, p_parcela_ini int)
returns date language plpgsql security definer set search_path = public as $$
declare k public.cartoes%rowtype; x public.compras_cartao%rowtype; d text := btrim(coalesce(p_desc, ''));
        cat text := btrim(coalesce(p_cat, '')); v numeric := round(coalesce(p_valor, 0), 2);
        f0 date; fp date; ini int; f date;
        meses text[] := array['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
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
  if p_data is null or p_data > current_date + 400 or p_data < current_date - 800 then raise exception 'Data da compra inválida.'; end if;
  f0 := public.fatura_da_compra(k.fecha, k.vence, p_data);             -- fatura da 1ª parcela
  if p_parcela_ini is null then
    fp := public.fatura_pendente(k.vence);                              -- primeira fatura que ainda não venceu
    ini := greatest(1, ((extract(year from age(fp, f0)) * 12 + extract(month from age(fp, f0)))::int) + 1);
    if fp < f0 then ini := 1; end if;
  else
    ini := p_parcela_ini;
  end if;
  if ini > p_parcelas then
    raise exception 'Essa compra já foi toda paga: a última parcela caiu na fatura de %/%. Não precisa lançar.',
      meses[extract(month from (f0 + make_interval(months => p_parcelas - 1)))::int], to_char(f0 + make_interval(months => p_parcelas - 1), 'YY');
  end if;
  if ini < 1 then raise exception 'Parcelas já pagas inválidas.'; end if;
  f := (f0 + make_interval(months => ini - 1))::date;                    -- fatura da 1ª parcela que entra no app
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

-- versão sem a parcela (usada pelo "Pagar com" em Lançamentos): o app calcula pela data
create or replace function public.salvar_compra(p_id uuid, p_cartao uuid, p_desc text, p_cat text, p_valor numeric, p_parcelas int, p_data date)
returns date language sql security definer set search_path = public as $$
  select public.salvar_compra(p_id, p_cartao, p_desc, p_cat, p_valor, p_parcelas, p_data, null::int);
$$;

-- mudou o fechamento/vencimento do cartão: recalcula as compras ainda não pagas mantendo as parcelas já pagas
create or replace function public.recalcular_faturas_cartao(p_cartao uuid)
returns void language sql security definer set search_path = public as $$
  update public.compras_cartao x
     set fatura = (public.fatura_da_compra(c.fecha, c.vence, x.data) + make_interval(months => x.parcela_ini - 1))::date
    from public.cartoes c
   where c.id = x.cartao_id and x.cartao_id = p_cartao and not x.ajuste
     and not exists (select 1 from public.pag_faturas p where p.cartao_id = p_cartao and p.mes >= x.fatura);
$$;

-- (mesma função de antes, agora usando o recálculo que respeita as parcelas já pagas)
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
      perform public.recalcular_faturas_cartao(nid);
    end if;
  end if;
  return nid;
end $$;

do $$
declare f text;
begin
  foreach f in array array['salvar_compra(uuid, uuid, text, text, numeric, int, date, int)', 'salvar_compra(uuid, uuid, text, text, numeric, int, date)',
                           'salvar_cartao(uuid, uuid, text, text, text, int, int, numeric)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.recalcular_faturas_cartao(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.fatura_pendente(int, date) from public, anon';
end $$;
