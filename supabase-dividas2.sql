-- =====================================================================
--  Pra Onde Foi? · DÍVIDAS, PARTE 2 · AÇÕES E HISTÓRICO
--  Rodar depois do supabase-dividas.sql. Pode rodar de novo.
--
--  Tocar na dívida abre um resumo com "O que aconteceu?":
--  quitei, fechei um acordo, paguei uma parte, estou negociando...
--  Cada mudança fica no histórico da dívida.
-- =====================================================================

alter table public.dividas add column if not exists quitada_valor numeric(12,2);

create table if not exists public.divida_eventos (
  id         uuid primary key default gen_random_uuid(),
  divida_id  uuid not null references public.dividas(id) on delete cascade,
  quando     date not null default current_date,
  texto      text not null check (char_length(texto) <= 160),
  criado_em  timestamptz not null default now()
);
create index if not exists divida_eventos_idx on public.divida_eventos (divida_id, quando);
alter table public.divida_eventos enable row level security;
drop policy if exists divida_eventos_ler on public.divida_eventos;
create policy divida_eventos_ler on public.divida_eventos for select to authenticated
  using (exists (select 1 from public.dividas d where d.id = divida_id and public.eh_aprovado() and public.eh_membro(d.controle_id)));
revoke all on public.divida_eventos from anon;
revoke insert, update, delete on public.divida_eventos from authenticated;
grant select on public.divida_eventos to authenticated;

-- valor no jeito brasileiro: 1.234,56
create or replace function public.brl_txt(v numeric) returns text language sql immutable as $$
  select replace(replace(replace(to_char(v, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.')
$$;

-- o histórico se escreve sozinho quando a dívida nasce ou muda de situação
create or replace function public.divida_registra() returns trigger
language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if tg_op = 'UPDATE' and new.situacao is not distinct from old.situacao then return new; end if;
  if tg_op = 'INSERT' then   -- os valores chegam logo depois (salvar_divida grava em duas etapas)
    insert into public.divida_eventos (divida_id, texto) values (new.id, 'cadastrada');
    return new;
  end if;
  t := case new.situacao
    when 'pagando'    then 'pagando' || coalesce(': ' || new.parcelas::text || ' × R$ ' || public.brl_txt(new.parcela_valor), '')
    when 'atrasada'   then 'atrasada' || coalesce(': R$ ' || public.brl_txt(new.atraso_valor), '') || coalesce(' desde ' || to_char(new.atraso_desde, 'DD/MM'), '')
    when 'acordo'     then 'acordo' || coalesce(': ' || new.parcelas::text || ' × R$ ' || public.brl_txt(new.parcela_valor), '')
    when 'negociando' then 'negociando' || coalesce(' · proposta: ' || new.proposta, '')
    when 'combinado'  then 'combinado' || coalesce(': R$ ' || public.brl_txt(new.combinado_valor), '') || coalesce(' até ' || to_char(new.combinado_ate, 'DD/MM/YYYY'), '')
    when 'quitada'    then 'quitada' || coalesce(' por R$ ' || public.brl_txt(new.quitada_valor), '')
  end;
  insert into public.divida_eventos (divida_id, quando, texto)
  values (new.id, case when new.situacao = 'quitada' then coalesce(new.quitada_em, current_date) else current_date end,
          left(coalesce(t, new.situacao), 160));
  return new;
end $$;
drop trigger if exists divida_eventos_fmt on public.divida_eventos;
drop function if exists public.divida_eventos_fmt();
drop function if exists public.divida_registra_fmt(text);
drop trigger if exists divida_registra on public.dividas;
create trigger divida_registra after insert or update of situacao on public.dividas for each row execute function public.divida_registra();

-- lança um pagamento da dívida como saída (categoria Dívidas, no nome de quem pagou)
create or replace function public.divida_lancar(d public.dividas, p_valor numeric, p_data date, p_desc text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.lancamentos (user_id, controle_id, tipo, descricao, categoria, valor, data)
  values (auth.uid(), d.controle_id, 'exp', left(p_desc, 200), 'Dívidas', round(p_valor, 2), p_data);
end $$;

-- ✅ quitei
create or replace function public.quitar_divida(p_id uuid, p_valor numeric, p_data date, p_lancar boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare d public.dividas%rowtype;
begin
  perform public.exigir_aprovado();
  select * into d from public.dividas where id = p_id;
  if d.id is null or not public.eh_membro(d.controle_id) then raise exception 'Dívida não encontrada.'; end if;
  if p_valor is not null and (p_valor <= 0 or p_valor > 99999999) then raise exception 'Valor inválido.'; end if;
  if p_data is null or p_data > current_date + 1 or current_date - p_data > 3660 then raise exception 'Data inválida.'; end if;
  perform public.divida_aposentar_conta(d.conta_id);
  perform public.divida_aposentar_conta(d.conta_atraso_id);
  update public.dividas set situacao = 'quitada', quitada_em = p_data, quitada_valor = round(p_valor, 2),
         conta_id = null, conta_atraso_id = null where id = p_id;
  if p_lancar and p_valor is not null then perform public.divida_lancar(d, p_valor, p_data, 'Quitação: ' || d.nome); end if;
end $$;

-- 💸 paguei uma parte (do atraso, ou do valor combinado/cobrado quando não há conta em Contas a pagar)
create or replace function public.divida_pagar_parte(p_id uuid, p_valor numeric, p_data date, p_lancar boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare d public.dividas%rowtype; resto numeric;
begin
  perform public.exigir_aprovado();
  select * into d from public.dividas where id = p_id;
  if d.id is null or not public.eh_membro(d.controle_id) then raise exception 'Dívida não encontrada.'; end if;
  if p_valor is null or p_valor <= 0 or p_valor > 99999999 then raise exception 'Valor inválido.'; end if;
  if p_data is null or p_data > current_date + 1 or current_date - p_data > 3660 then raise exception 'Data inválida.'; end if;
  if d.situacao = 'atrasada' and d.conta_atraso_id is not null then
    -- pelo próprio Contas a pagar: o pagamento já vira saída em Lançamentos
    perform public.pagar_conta(d.conta_atraso_id, (select inicio from public.contas where id = d.conta_atraso_id), p_valor, p_data);
  else
    resto := case d.situacao when 'atrasada' then d.atraso_valor when 'combinado' then d.combinado_valor when 'negociando' then d.cobrado end;
    if resto is null then raise exception 'Nesta situação, use Quitei ou Contas a pagar.'; end if;
    if p_valor >= resto then raise exception 'Esse valor quita a dívida: use Quitei.'; end if;
    update public.dividas set
      atraso_valor    = case when situacao = 'atrasada'   then atraso_valor - p_valor else atraso_valor end,
      combinado_valor = case when situacao = 'combinado'  then combinado_valor - p_valor else combinado_valor end,
      cobrado         = case when situacao = 'negociando' then cobrado - p_valor else cobrado end
    where id = p_id;
    if p_lancar then perform public.divida_lancar(d, p_valor, p_data, 'Pagamento: ' || d.nome); end if;
  end if;
  insert into public.divida_eventos (divida_id, quando, texto)
  values (p_id, p_data, 'pagou R$ ' || public.brl_txt(p_valor));
end $$;

-- entrada de acordo: lança a saída e registra
create or replace function public.divida_entrada(p_id uuid, p_valor numeric, p_data date)
returns void language plpgsql security definer set search_path = public as $$
declare d public.dividas%rowtype;
begin
  perform public.exigir_aprovado();
  select * into d from public.dividas where id = p_id;
  if d.id is null or not public.eh_membro(d.controle_id) then raise exception 'Dívida não encontrada.'; end if;
  if p_valor is null or p_valor <= 0 or p_valor > 99999999 then raise exception 'Valor inválido.'; end if;
  if p_data is null or p_data > current_date + 1 or current_date - p_data > 3660 then raise exception 'Data inválida.'; end if;
  perform public.divida_lancar(d, p_valor, p_data, 'Entrada do acordo: ' || d.nome);
end $$;

-- a lista agora traz o histórico (últimos 12 acontecimentos)
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
        'eventos', coalesce((select jsonb_agg(jsonb_build_object('quando', e.quando, 'texto', e.texto) order by e.quando desc, e.criado_em desc)
                               from (select * from public.divida_eventos e2 where e2.divida_id = d.id order by e2.quando desc, e2.criado_em desc limit 12) e), '[]'::jsonb),
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

-- dívidas que já existiam ganham o "cadastrada" no histórico
insert into public.divida_eventos (divida_id, quando, texto)
select d.id, d.criado_em::date, 'cadastrada' from public.dividas d
 where not exists (select 1 from public.divida_eventos e where e.divida_id = d.id);

do $$ begin
  revoke all on function public.divida_registra() from public, anon, authenticated;
  revoke all on function public.divida_lancar(public.dividas, numeric, date, text) from public, anon, authenticated;
  revoke all on function public.quitar_divida(uuid, numeric, date, boolean) from public, anon;
  grant execute on function public.quitar_divida(uuid, numeric, date, boolean) to authenticated;
  revoke all on function public.divida_pagar_parte(uuid, numeric, date, boolean) from public, anon;
  grant execute on function public.divida_pagar_parte(uuid, numeric, date, boolean) to authenticated;
  revoke all on function public.divida_entrada(uuid, numeric, date) from public, anon;
  grant execute on function public.divida_entrada(uuid, numeric, date) to authenticated;
  revoke all on function public.listar_dividas(uuid) from public, anon;
  grant execute on function public.listar_dividas(uuid) to authenticated;
end $$;

notify pgrst, 'reload schema';
