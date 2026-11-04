-- =====================================================================
--  Pra Onde Foi? · PAINEL DE USO (portal admin)
--  Rodar depois do supabase-seguranca3.sql. Pode rodar de novo sem problema.
--  Não apaga nem altera dados de ninguém.
--
--  O admin vê só DATAS e QUANTIDADES por conta (último acesso, quantos lançamentos).
--  Nunca vê valores, descrições ou categorias dos lançamentos.
-- =====================================================================

-- quando a pessoa abriu o app pela última vez (o login fica salvo, então "último login" não basta)
alter table public.perfis add column if not exists ultimo_acesso timestamptz;

-- o app chama ao abrir e ao voltar para a tela; grava no máximo a cada 15 minutos
create or replace function public.registrar_acesso()
returns void language sql security definer set search_path = public as $$
  update public.perfis set ultimo_acesso = now()
   where id = auth.uid() and (ultimo_acesso is null or ultimo_acesso < now() - interval '15 minutes');
$$;
revoke all on function public.registrar_acesso() from public, anon;
grant execute on function public.registrar_acesso() to authenticated;

-- uso por conta, só para administradores
create or replace function public.admin_uso()
returns table(id uuid, criado_em timestamptz, ultimo_acesso timestamptz, ultimo_login timestamptz,
              lanc_total bigint, lanc_30d bigint, ultimo_lanc timestamptz, controles_comp int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  return query
  select p.id, p.criado_em, p.ultimo_acesso,
         (select (to_jsonb(u) ->> 'last_sign_in_at')::timestamptz from auth.users u where u.id = p.id),
         (select count(*) from public.lancamentos l where l.user_id = p.id),
         (select count(*) from public.lancamentos l where l.user_id = p.id and l.criado_em > now() - interval '30 days'),
         (select max(l.criado_em) from public.lancamentos l where l.user_id = p.id),
         (select count(*)::int from public.membros m join public.controles c on c.id = m.controle_id
           where m.user_id = p.id and not c.pessoal)
    from public.perfis p;
end $$;
revoke all on function public.admin_uso() from public, anon;
grant execute on function public.admin_uso() to authenticated;

create index if not exists lancamentos_user_criado on public.lancamentos (user_id, criado_em desc);
