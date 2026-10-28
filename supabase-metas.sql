-- =====================================================================
--  Pra Onde Foi? · METAS (viagem, reserva de emergência, carro…)
--  Rodar depois dos outros scripts. Pode rodar de novo sem problema.
--  Só acrescenta tabelas novas; não mexe em nada do que já existe.
-- =====================================================================

create table if not exists public.metas (
  id          uuid primary key default gen_random_uuid(),
  controle_id uuid not null references public.controles(id) on delete cascade,
  criado_por  uuid references auth.users(id) on delete set null,
  nome        text not null check (char_length(nome) between 1 and 60),
  icone       text not null default '🎯' check (char_length(icone) between 1 and 8),
  alvo        numeric(12,2) not null check (alvo > 0),
  prazo       date check (prazo is null or extract(day from prazo) = 1),   -- mês em que quer chegar
  concluida_em timestamptz,
  criado_em   timestamptz not null default now()
);
create index if not exists metas_controle_idx on public.metas (controle_id);

-- Cada vez que alguém guarda ou retira dinheiro de uma meta
create table if not exists public.meta_movs (
  id            uuid primary key default gen_random_uuid(),
  meta_id       uuid not null references public.metas(id) on delete cascade,
  controle_id   uuid not null references public.controles(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  tipo          text not null check (tipo in ('guardar','retirar')),
  valor         numeric(12,2) not null check (valor > 0),
  data          date not null,
  lancamento_id uuid references public.lancamentos(id) on delete set null,   -- se também foi lançado em Lançamentos
  criado_em     timestamptz not null default now()
);
create index if not exists meta_movs_meta_idx on public.meta_movs (meta_id);
create index if not exists meta_movs_controle_idx on public.meta_movs (controle_id);

alter table public.metas     enable row level security;
alter table public.meta_movs enable row level security;
drop policy if exists "metas_ler" on public.metas;
create policy "metas_ler" on public.metas for select to authenticated
  using (public.eh_aprovado() and public.eh_membro(controle_id));
drop policy if exists "meta_movs_ler" on public.meta_movs;
create policy "meta_movs_ler" on public.meta_movs for select to authenticated
  using (public.eh_aprovado() and public.eh_membro(controle_id));

-- saldo de uma meta
create or replace function public.meta_saldo(meta uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when tipo = 'guardar' then valor else -valor end), 0) from public.meta_movs where meta_id = meta;
$$;

-- Criar (p_id nulo) ou editar uma meta (só quem criou edita)
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
  -- marca ou desmarca como concluída
  update public.metas set concluida_em = case when public.meta_saldo(nid) >= alvo then coalesce(concluida_em, now()) end where id = nid;
  return nid;
end $$;

create or replace function public.excluir_meta(meta uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_aprovado();
  if not exists (select 1 from public.metas where id = meta and criado_por = auth.uid()) then
    raise exception 'Só quem criou a meta pode excluir.';
  end if;
  delete from public.metas where id = meta;   -- lançamentos já feitos continuam em Lançamentos
end $$;

-- Guardar ou retirar. p_lancar = true também cria a saída (guardar) ou entrada (retirar) em Lançamentos.
create or replace function public.mover_meta(meta uuid, p_tipo text, p_valor numeric, p_data date, p_lancar boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare m public.metas%rowtype; v numeric := round(coalesce(p_valor, 0), 2); saldo numeric; lid uuid; mid uuid;
begin
  perform public.exigir_aprovado();
  select * into m from public.metas where id = meta for update;
  if m.id is null or not public.eh_membro(m.controle_id) then raise exception 'Meta não encontrada.'; end if;
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

-- Desfazer um movimento seu (apaga também o lançamento que ele criou)
create or replace function public.desfazer_meta_mov(mov uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.meta_movs%rowtype;
begin
  perform public.exigir_aprovado();
  select * into r from public.meta_movs where id = mov and user_id = auth.uid();
  if r.id is null then raise exception 'Só quem fez pode desfazer.'; end if;
  if r.tipo = 'guardar' and public.meta_saldo(r.meta_id) - r.valor < 0 then
    raise exception 'Não dá para desfazer: o valor já foi retirado da meta.';
  end if;
  delete from public.meta_movs where id = mov;
  if r.lancamento_id is not null then delete from public.lancamentos where id = r.lancamento_id; end if;
  update public.metas set concluida_em = case when public.meta_saldo(r.meta_id) >= alvo then coalesce(concluida_em, now()) end where id = r.meta_id;
end $$;

revoke all on public.metas, public.meta_movs from anon;
grant select on public.metas, public.meta_movs to authenticated;

do $$
declare f text;
begin
  foreach f in array array['meta_saldo(uuid)', 'salvar_meta(uuid, uuid, text, text, numeric, date)', 'excluir_meta(uuid)',
                           'mover_meta(uuid, text, numeric, date, boolean)', 'desfazer_meta_mov(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['metas','meta_movs'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object or undefined_object then null;
    end;
  end loop;
end $$;
