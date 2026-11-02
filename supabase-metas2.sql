-- =====================================================================
--  Pra Onde Foi? · METAS CONCLUÍDAS ("usei o dinheiro")
--  Rodar depois do supabase-metas.sql (e do supabase-seguranca2.sql).
--  Pode rodar de novo sem problema. Não apaga dados.
-- =====================================================================

-- meta encerrada = o dinheiro juntado foi usado (viagem feita, carro comprado…)
alter table public.metas add column if not exists encerrada_em timestamptz;
alter table public.metas add column if not exists usado numeric(12,2);
alter table public.metas add column if not exists mov_uso uuid;   -- movimento que zerou a meta (para poder desfazer)

-- Criar ou editar: igual a antes, mas uma meta encerrada continua marcada como concluída
create or replace function public.salvar_meta(p_id uuid, cid uuid, p_nome text, p_icone text, p_alvo numeric, p_prazo date)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid; n text := btrim(coalesce(p_nome, '')); ic text := btrim(coalesce(p_icone, ''));
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select controle_id into cid from public.metas where id = p_id and criado_por = auth.uid();
    if cid is null then raise exception 'Só quem criou a meta pode editar.'; end if;
  end if;
  if cid is null or not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if char_length(n) not between 1 and 60 then raise exception 'Dê um nome para a meta (até 60 caracteres).'; end if;
  if ic = '' then ic := '🎯'; end if;
  if char_length(ic) > 8 then raise exception 'Ícone inválido.'; end if;
  if p_alvo is null or p_alvo <= 0 then raise exception 'Informe o valor do objetivo.'; end if;
  if p_id is null then
    insert into public.metas (controle_id, criado_por, nome, icone, alvo, prazo)
    values (cid, auth.uid(), n, ic, round(p_alvo, 2), date_trunc('month', p_prazo)::date) returning id into nid;
  else
    nid := p_id;
    update public.metas set nome = n, icone = ic, alvo = round(p_alvo, 2), prazo = date_trunc('month', p_prazo)::date where id = nid;
  end if;
  update public.metas set concluida_em = case when encerrada_em is not null then concluida_em
                                              when public.meta_saldo(nid) >= alvo then coalesce(concluida_em, now()) end
   where id = nid;
  return nid;
end $$;

-- Guardar ou retirar: não mexe em meta já encerrada
create or replace function public.mover_meta(meta uuid, p_tipo text, p_valor numeric, p_data date, p_lancar boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare m public.metas%rowtype; v numeric := round(coalesce(p_valor, 0), 2); saldo numeric; lid uuid; mid uuid;
begin
  perform public.exigir_aprovado();
  select * into m from public.metas where id = meta for update;
  if m.id is null or not public.eh_membro(m.controle_id) then raise exception 'Meta não encontrada.'; end if;
  if m.encerrada_em is not null then raise exception 'Esta meta já foi usada e está encerrada.'; end if;
  if p_tipo not in ('guardar','retirar') then raise exception 'Operação inválida.'; end if;
  if v <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if p_data is null or abs(p_data - current_date) > 400 then raise exception 'Data inválida.'; end if;
  saldo := public.meta_saldo(meta);
  if p_tipo = 'retirar' and v > saldo then
    raise exception 'Você só pode retirar até R$ % desta meta.', translate(to_char(saldo, 'FM999,999,990.00'), ',.', '.,');
  end if;
  if coalesce(p_lancar, false) then
    insert into public.lancamentos (user_id, controle_id, tipo, descricao, categoria, valor, data)
    values (auth.uid(), m.controle_id, case when p_tipo = 'guardar' then 'exp' else 'inc' end,
            case when p_tipo = 'guardar' then 'Guardado: ' else 'Retirado: ' end || m.nome, 'Metas', v, p_data)
    returning id into lid;
  end if;
  insert into public.meta_movs (meta_id, controle_id, user_id, tipo, valor, data, lancamento_id)
  values (meta, m.controle_id, auth.uid(), p_tipo, v, p_data, lid) returning id into mid;
  update public.metas set concluida_em = case when public.meta_saldo(meta) >= alvo then coalesce(concluida_em, now()) end where id = meta;
  return mid;
end $$;

-- Desfazer um movimento: numa meta encerrada, primeiro desfaz o "usei o dinheiro"
create or replace function public.desfazer_meta_mov(mov uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.meta_movs%rowtype;
begin
  perform public.exigir_aprovado();
  select * into r from public.meta_movs where id = mov and user_id = auth.uid();
  if r.id is null then raise exception 'Só quem fez pode desfazer.'; end if;
  if exists (select 1 from public.metas where id = r.meta_id and encerrada_em is not null) then
    raise exception 'Esta meta está encerrada. Use "Desfazer: usei o dinheiro" primeiro.';
  end if;
  if r.tipo = 'guardar' and public.meta_saldo(r.meta_id) - r.valor < 0 then
    raise exception 'Não dá para desfazer: o valor já foi retirado da meta.';
  end if;
  delete from public.meta_movs where id = mov;
  if r.lancamento_id is not null then delete from public.lancamentos where id = r.lancamento_id; end if;
  update public.metas set concluida_em = case when public.meta_saldo(r.meta_id) >= alvo then coalesce(concluida_em, now()) end where id = r.meta_id;
end $$;

-- "Usei o dinheiro": tira tudo da meta e encerra (fica em Concluídas como usada).
-- p_lancar = true também lança a saída em Lançamentos (só se o gasto ainda não foi lançado).
create or replace function public.usar_meta(meta uuid, p_data date, p_lancar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare m public.metas%rowtype; saldo numeric; lid uuid; mid uuid;
begin
  perform public.exigir_aprovado();
  select * into m from public.metas where id = meta for update;
  if m.id is null or not public.eh_membro(m.controle_id) then raise exception 'Meta não encontrada.'; end if;
  if m.encerrada_em is not null then raise exception 'Esta meta já foi usada.'; end if;
  if p_data is null or abs(p_data - current_date) > 400 then raise exception 'Data inválida.'; end if;
  saldo := public.meta_saldo(meta);
  if saldo <= 0 then raise exception 'Não há dinheiro guardado nesta meta.'; end if;
  if coalesce(p_lancar, false) then
    insert into public.lancamentos (user_id, controle_id, tipo, descricao, categoria, valor, data)
    values (auth.uid(), m.controle_id, 'exp', 'Usado: ' || m.nome, 'Metas', saldo, p_data) returning id into lid;
  end if;
  insert into public.meta_movs (meta_id, controle_id, user_id, tipo, valor, data, lancamento_id)
  values (meta, m.controle_id, auth.uid(), 'retirar', saldo, p_data, lid) returning id into mid;
  update public.metas set encerrada_em = now(), usado = saldo, mov_uso = mid,
         concluida_em = coalesce(concluida_em, now())
   where id = meta;
end $$;

-- Desfazer o "usei o dinheiro": o dinheiro volta para a meta (e some a saída, se tinha sido lançada)
create or replace function public.reabrir_meta(meta uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.metas%rowtype; lid uuid;
begin
  perform public.exigir_aprovado();
  select * into m from public.metas where id = meta for update;
  if m.id is null or not public.eh_membro(m.controle_id) then raise exception 'Meta não encontrada.'; end if;
  if m.encerrada_em is null then raise exception 'Esta meta não está encerrada.'; end if;
  if m.mov_uso is not null then
    select lancamento_id into lid from public.meta_movs where id = m.mov_uso;
    delete from public.meta_movs where id = m.mov_uso;
    if lid is not null then delete from public.lancamentos where id = lid; end if;
  end if;
  update public.metas set encerrada_em = null, usado = null, mov_uso = null,
         concluida_em = case when public.meta_saldo(meta) >= alvo then coalesce(concluida_em, now()) end
   where id = meta;
end $$;

do $$
declare f text;
begin
  foreach f in array array['salvar_meta(uuid, uuid, text, text, numeric, date)', 'mover_meta(uuid, text, numeric, date, boolean)',
                           'desfazer_meta_mov(uuid)', 'usar_meta(uuid, date, boolean)', 'reabrir_meta(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke all on function public.meta_saldo(uuid) from public, anon, authenticated;
end $$;
