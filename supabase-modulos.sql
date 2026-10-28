-- =====================================================================
--  Pra Onde Foi? · O QUE CADA CONTROLE COMPARTILHA
--  (gastos, contas a pagar, metas, investimentos — o dono escolhe)
--  Rodar por último (depois de metas e investimentos). Pode rodar de novo.
--  Controles que já existem começam com tudo ligado. Nada é apagado.
-- =====================================================================

alter table public.controles add column if not exists modulos text[] not null default array['lanc','contas','metas','invest'];
alter table public.controles drop constraint if exists controles_modulos_chk;
alter table public.controles add constraint controles_modulos_chk
  check (cardinality(modulos) >= 1 and modulos <@ array['lanc','contas','metas','invest']);

-- área ligada neste controle? (o "Meu controle" sempre tem tudo)
create or replace function public.modulo_ativo(cid uuid, m text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select pessoal or m = any(modulos) from public.controles where id = cid), false);
$$;

-- o dono liga e desliga as áreas
create or replace function public.definir_modulos(cid uuid, p_modulos text[])
returns void language plpgsql security definer set search_path = public as $$
declare ms text[];
begin
  perform public.exigir_aprovado();
  if not public.eh_dono(cid) then raise exception 'Só o dono escolhe o que o controle compartilha.'; end if;
  if (select pessoal from public.controles where id = cid) then raise exception 'O "Meu controle" sempre tem tudo.'; end if;
  select array_agg(distinct x order by x) into ms from unnest(coalesce(p_modulos, '{}')) x where x in ('lanc','contas','metas','invest');
  if ms is null or cardinality(ms) = 0 then raise exception 'Deixe pelo menos uma área ligada.'; end if;
  update public.controles set modulos = ms where id = cid;
end $$;

-- a lista de controles passa a dizer quais áreas cada um tem
drop function if exists public.meus_controles();
create function public.meus_controles()
returns table (id uuid, nome text, pessoal boolean, sou_dono boolean, participantes int, codigo text, codigo_expira timestamptz, modulos text[])
language sql stable security definer set search_path = public as $$
  select c.id, c.nome, c.pessoal, c.dono = auth.uid(),
         (select count(*)::int from public.membros m2 where m2.controle_id = c.id),
         case when c.dono = auth.uid() and c.codigo_expira > now() then c.codigo end,
         case when c.dono = auth.uid() and c.codigo_expira > now() then c.codigo_expira end,
         case when c.pessoal then array['lanc','contas','metas','invest'] else c.modulos end
    from public.controles c
    join public.membros m on m.controle_id = c.id and m.user_id = auth.uid()
   where public.eh_aprovado()
   order by c.pessoal desc, c.criado_em;
$$;

-- o banco não deixa criar nada numa área desligada (nem por fora do app)
create or replace function public.checar_modulo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.modulo_ativo(new.controle_id, tg_argv[0]) then
    raise exception 'Este controle não compartilha %.',
      case tg_argv[0] when 'contas' then 'Contas a pagar' when 'metas' then 'Metas' when 'invest' then 'Investimentos' else 'Lançamentos' end;
  end if;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values ('contas','contas'), ('pagamentos','contas'), ('metas','metas'), ('meta_movs','metas'),
                                 ('investimentos','invest'), ('inv_movs','invest')) as t(tabela, modulo) loop
    if to_regclass('public.' || r.tabela) is not null then
      execute format('drop trigger if exists checar_modulo on public.%I', r.tabela);
      execute format('create trigger checar_modulo before insert on public.%I for each row execute function public.checar_modulo(%L)', r.tabela, r.modulo);
    end if;
  end loop;
end $$;

-- lançamentos digitados pela pessoa: só se o controle compartilha Lançamentos
-- (pagamentos de contas, metas e investimentos continuam podendo gerar lançamento)
drop policy if exists "lanc_criar" on public.lancamentos;
create policy "lanc_criar" on public.lancamentos for insert to authenticated
  with check (user_id = auth.uid() and public.eh_aprovado() and public.eh_membro(controle_id) and public.modulo_ativo(controle_id, 'lanc'));

do $$
declare f text;
begin
  foreach f in array array['modulo_ativo(uuid, text)', 'definir_modulos(uuid, text[])', 'meus_controles()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.checar_modulo() from public, anon, authenticated';
end $$;
