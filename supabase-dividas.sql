-- =====================================================================
--  Pra Onde Foi? · DÍVIDAS (dentro de Contas a pagar)
--  Rodar depois do supabase-contas.sql. Pode rodar de novo sem problema.
--
--  Cada dívida tem uma situação (pagando, atrasada, em acordo, negociando,
--  combinado, quitada). Conforme a situação, o banco cria sozinho as contas
--  em "Contas a pagar" (as parcelas, o valor atrasado, o prazo combinado).
--  Pagar a parcela em Contas a pagar já faz a dívida andar.
-- =====================================================================

create table if not exists public.dividas (
  id              uuid primary key default gen_random_uuid(),
  controle_id     uuid not null references public.controles(id) on delete cascade,
  criado_por      uuid references auth.users(id) on delete set null,
  nome            text not null check (char_length(nome) between 1 and 60),
  credor          text check (credor is null or char_length(credor) <= 60),
  tipo            text not null default 'outra' check (tipo in ('emprestimo','financiamento','cartao','pessoa','outra')),
  situacao        text not null check (situacao in ('pagando','atrasada','acordo','negociando','combinado','quitada')),
  -- pagando / atrasada / acordo: as parcelas que faltam a partir da próxima
  parcela_valor   numeric(12,2) check (parcela_valor is null or parcela_valor > 0),
  parcelas        smallint check (parcelas is null or parcelas between 1 and 480),
  proxima         date,
  juros           numeric(6,3) check (juros is null or juros between 0 and 100),
  -- atrasada
  atraso_valor    numeric(12,2) check (atraso_valor is null or atraso_valor > 0),
  atraso_desde    date,
  -- em acordo
  acordo_antes    numeric(12,2) check (acordo_antes is null or acordo_antes > 0),
  acordo_entrada  numeric(12,2) check (acordo_entrada is null or acordo_entrada >= 0),
  -- negociando
  cobrado         numeric(12,2) check (cobrado is null or cobrado > 0),
  proposta        text check (proposta is null or char_length(proposta) <= 120),
  -- combinado
  combinado_valor numeric(12,2) check (combinado_valor is null or combinado_valor > 0),
  combinado_ate   date,
  em_contas       boolean not null default true,     -- colocar em Contas a pagar
  conta_id        uuid references public.contas(id) on delete set null,   -- parcelas / prazo
  conta_atraso_id uuid references public.contas(id) on delete set null,   -- valor atrasado
  quitada_em      date,
  criado_em       timestamptz not null default now()
);
create index if not exists dividas_controle_idx on public.dividas (controle_id);

alter table public.dividas enable row level security;
drop policy if exists dividas_ler on public.dividas;
create policy dividas_ler on public.dividas for select to authenticated
  using (public.eh_aprovado() and public.eh_membro(controle_id));
-- dívidas ficam junto de Contas a pagar: só onde o controle compartilha Contas
drop trigger if exists checar_modulo on public.dividas;
create trigger checar_modulo before insert on public.dividas for each row execute function public.checar_modulo('contas');

-- tira uma conta da dívida de Contas a pagar sem perder o que já foi pago:
-- sem pagamentos some; com pagamentos fica só até o último mês pago
create or replace function public.divida_aposentar_conta(p_conta uuid)
returns void language plpgsql security definer set search_path = public as $$
declare ult date;
begin
  if p_conta is null then return; end if;
  select max(mes) into ult from public.pagamentos where conta_id = p_conta;
  if ult is null then
    delete from public.contas where id = p_conta;
  else
    update public.contas set tipo = 'fixa', parcelas = null, fim = ult where id = p_conta and tipo <> 'unica';
  end if;
end $$;

-- cria a conta de uma dívida (uma parcela = conta única; várias = parcelada)
create or replace function public.divida_nova_conta(cid uuid, p_nome text, p_valor numeric, p_data date, p_n int)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  insert into public.contas (controle_id, criado_por, nome, categoria, valor, dia, tipo, inicio, parcelas)
  values (cid, auth.uid(), left(p_nome, 60), 'Dívidas', round(p_valor, 2), extract(day from p_data)::int,
          case when coalesce(p_n, 1) >= 2 then 'parcelada' else 'unica' end,
          date_trunc('month', p_data)::date, case when coalesce(p_n, 1) >= 2 then least(p_n, 240) end)
  returning id into nid;
  return nid;
end $$;

-- salvar (criar ou editar). p_refazer: refaz as contas (mudou valor, parcelas, datas ou situação)
create or replace function public.salvar_divida(p_id uuid, cid uuid, p jsonb, p_refazer boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  d public.dividas%rowtype; nid uuid;
  sit text := p->>'situacao';
  n text := btrim(coalesce(p->>'nome', ''));
  pv numeric := nullif(p->>'parcela_valor', '')::numeric;
  pn int := nullif(p->>'parcelas', '')::int;
  px date := nullif(p->>'proxima', '')::date;
  av numeric := nullif(p->>'atraso_valor', '')::numeric;
  ad date := nullif(p->>'atraso_desde', '')::date;
  cv numeric := nullif(p->>'combinado_valor', '')::numeric;
  ca date := nullif(p->>'combinado_ate', '')::date;
  emc boolean := coalesce((p->>'em_contas')::boolean, true);
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select * into d from public.dividas where id = p_id;
    if d.id is null or not public.eh_membro(d.controle_id) then raise exception 'Dívida não encontrada.'; end if;
    cid := d.controle_id;
  end if;
  if cid is null or not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if char_length(n) not between 1 and 60 then raise exception 'O nome precisa ter de 1 a 60 caracteres.'; end if;
  if sit is null or sit not in ('pagando','atrasada','acordo','negociando','combinado','quitada') then raise exception 'Escolha a situação.'; end if;
  -- atrasada: as parcelas que ainda vão vencer são opcionais (ex.: cartão atrasado sem parcelas)
  if sit = 'atrasada' and pv is null and pn is null and px is null then
    null;
  elsif sit in ('pagando','atrasada','acordo') then
    if pv is null or pv <= 0 then raise exception 'Informe o valor da parcela.'; end if;
    if pn is null or pn not between 1 and 480 then raise exception 'Informe quantas parcelas faltam (1 a 480).'; end if;
    if px is null or abs(px - current_date) > 3660 then raise exception 'Informe a data da próxima parcela.'; end if;
  end if;
  if sit = 'atrasada' then
    if av is null or av <= 0 then raise exception 'Informe o valor em atraso.'; end if;
    if ad is null or ad > current_date or current_date - ad > 3660 then raise exception 'Informe desde quando está atrasada.'; end if;
  end if;
  if sit = 'negociando' and coalesce(nullif(p->>'cobrado', '')::numeric, 0) <= 0 then raise exception 'Informe o valor cobrado.'; end if;
  if sit = 'combinado' and (cv is null or cv <= 0) then raise exception 'Informe o valor combinado.'; end if;

  if p_id is null then
    insert into public.dividas (controle_id, criado_por, nome, situacao) values (cid, auth.uid(), n, sit) returning * into d;
    p_refazer := true;
  end if;
  nid := d.id;

  update public.dividas set
    nome = n, credor = nullif(left(btrim(coalesce(p->>'credor', '')), 60), ''),
    tipo = coalesce(nullif(p->>'tipo', ''), 'outra'), situacao = sit,
    parcela_valor = case when sit in ('pagando','atrasada','acordo') then round(pv, 2) end,
    parcelas      = case when sit in ('pagando','atrasada','acordo') then pn end,
    proxima       = case when sit in ('pagando','atrasada','acordo') then px end,
    juros         = nullif(p->>'juros', '')::numeric,
    atraso_valor  = case when sit = 'atrasada' then round(av, 2) end,
    atraso_desde  = case when sit = 'atrasada' then ad end,
    acordo_antes  = case when sit = 'acordo' then nullif(p->>'acordo_antes', '')::numeric end,
    acordo_entrada= case when sit = 'acordo' then nullif(p->>'acordo_entrada', '')::numeric end,
    cobrado       = case when sit = 'negociando' then round(nullif(p->>'cobrado', '')::numeric, 2) end,
    proposta      = case when sit = 'negociando' then nullif(left(btrim(coalesce(p->>'proposta', '')), 120), '') end,
    combinado_valor = case when sit = 'combinado' then round(cv, 2) end,
    combinado_ate   = case when sit = 'combinado' then ca end,
    em_contas     = emc,
    quitada_em    = case when sit = 'quitada' then coalesce(d.quitada_em, current_date) end
  where id = nid;

  if p_refazer then
    perform public.divida_aposentar_conta(d.conta_id);
    perform public.divida_aposentar_conta(d.conta_atraso_id);
    update public.dividas set conta_id = null, conta_atraso_id = null where id = nid;
    if emc then
      if sit in ('pagando','atrasada','acordo') and pv is not null then
        update public.dividas set conta_id = public.divida_nova_conta(cid, n, pv, px, pn) where id = nid;
      elsif sit = 'combinado' and ca is not null then
        update public.dividas set conta_id = public.divida_nova_conta(cid, n || ' (combinado)', cv, ca, 1) where id = nid;
      end if;
      if sit = 'atrasada' then
        update public.dividas set conta_atraso_id = public.divida_nova_conta(cid, n || ' (atrasado)', av, ad, 1) where id = nid;
      end if;
    end if;
  end if;
  return nid;
end $$;

-- excluir: as parcelas já pagas continuam em Lançamentos; as futuras somem de Contas a pagar
create or replace function public.excluir_divida(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d public.dividas%rowtype;
begin
  perform public.exigir_aprovado();
  select * into d from public.dividas where id = p_id;
  if d.id is null or not public.eh_membro(d.controle_id) then raise exception 'Dívida não encontrada.'; end if;
  perform public.divida_aposentar_conta(d.conta_id);
  perform public.divida_aposentar_conta(d.conta_atraso_id);
  delete from public.dividas where id = p_id;
end $$;

-- lista com as contas já feitas: quantas parcelas pagas, quanto falta, se o atraso já foi pago
create or replace function public.listar_dividas(cid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_aprovado();
  if not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'ordem', x->>'nome') from (
      select to_jsonb(d) || jsonb_build_object(
        'pagas', coalesce(pg.pagas, 0),
        'atraso_pago', coalesce(at.pago, 0),
        'ordem', case d.situacao when 'atrasada' then '1' when 'negociando' then '2' when 'pagando' then '3' when 'acordo' then '3'
                                   when 'combinado' then '4' else '9' end) as x
      from public.dividas d
      left join lateral (
        select count(*) as pagas from (
          select p2.mes from public.pagamentos p2 join public.contas c on c.id = p2.conta_id
           where p2.conta_id = d.conta_id
           group by p2.mes, c.valor
          having sum(p2.valor) >= coalesce((select valor from public.conta_meses cm where cm.conta_id = d.conta_id and cm.mes = p2.mes), c.valor)
        ) m) pg on true
      left join lateral (select sum(valor) as pago from public.pagamentos where conta_id = d.conta_atraso_id) at on true
      where d.controle_id = cid) t), '[]'::jsonb);
end $$;

revoke all on public.dividas from anon;
revoke insert, update, delete on public.dividas from authenticated;   -- mudanças só pelas funções
grant select on public.dividas to authenticated;

do $$ begin
  revoke all on function public.divida_aposentar_conta(uuid) from public, anon, authenticated;
  revoke all on function public.divida_nova_conta(uuid, text, numeric, date, int) from public, anon, authenticated;
  revoke all on function public.salvar_divida(uuid, uuid, jsonb, boolean) from public, anon;
  grant execute on function public.salvar_divida(uuid, uuid, jsonb, boolean) to authenticated;
  revoke all on function public.excluir_divida(uuid) from public, anon;
  grant execute on function public.excluir_divida(uuid) to authenticated;
  revoke all on function public.listar_dividas(uuid) from public, anon;
  grant execute on function public.listar_dividas(uuid) to authenticated;
end $$;

notify pgrst, 'reload schema';
