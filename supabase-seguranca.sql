-- =====================================================================
--  Pra Onde Foi? · AJUSTES DE SEGURANÇA
--  Rodar depois dos outros scripts. Pode rodar de novo sem problema.
--  Não apaga nem altera nenhum dado.
-- =====================================================================

-- (garante as colunas do perfil, caso o supabase-perfil.sql ainda não tenha sido rodado)
alter table public.perfis add column if not exists nome text;
alter table public.perfis add column if not exists foto text;

-- 1) E-MAIL NUNCA APARECE INTEIRO PARA OUTRAS PESSOAS
--    "maria@usuarios.local" vira "maria"; "joana.silva@gmail.com" vira "jo•••@gmail.com"
create or replace function public.login_publico(e text)
returns text language sql immutable as $$
  select case
    when e is null then null
    when e like '%@usuarios.local' then split_part(e, '@', 1)
    else left(split_part(e, '@', 1), 2) || '•••@' || split_part(e, '@', 2)
  end;
$$;

drop function if exists public.participantes(uuid);
create function public.participantes(cid uuid)
returns table (user_id uuid, login text, eh_dono boolean, entrou_em timestamptz, nome text, foto text)
language sql stable security definer set search_path = public as $$
  select m.user_id, public.login_publico(p.email), c.dono = m.user_id, m.entrou_em, p.nome, p.foto
    from public.membros m
    join public.controles c on c.id = m.controle_id
    left join public.perfis p on p.id = m.user_id
   where m.controle_id = cid and public.eh_membro(cid)
   order by m.entrou_em;
$$;

drop function if exists public.meus_convites();
create function public.meus_convites()
returns table (id uuid, controle_nome text, de_login text, de_nome text)
language sql stable security definer set search_path = public as $$
  select v.id, c.nome, public.login_publico(p.email), p.nome
    from public.convites v
    join public.controles c on c.id = v.controle_id
    left join public.perfis p on p.id = v.convidado_por
   where v.convidado = auth.uid() and public.eh_aprovado()
   order by v.criado_em;
$$;

create or replace function public.convites_enviados(cid uuid)
returns table (id uuid, login text, criado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select v.id, public.login_publico(p.email), v.criado_em
    from public.convites v left join public.perfis p on p.id = v.convidado
   where v.controle_id = cid and public.eh_dono(cid)
   order by v.criado_em;
$$;

-- 2) CADA PESSOA LÊ SÓ O PRÓPRIO PERFIL.
--    O admin passa a ver a lista por uma função que entrega só usuário, nome e situação
--    (sem e-mail de aviso, WhatsApp ou foto).
drop policy if exists "perfis_ler" on public.perfis;
create policy "perfis_ler" on public.perfis for select to authenticated using (id = auth.uid());

create or replace function public.admin_listar()
returns table (id uuid, email text, status text, is_admin boolean, criado_em timestamptz, nome text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  return query select p.id, p.email, p.status, p.is_admin, p.criado_em, p.nome
                 from public.perfis p order by p.criado_em desc;
end $$;

-- 3) CONVITE NÃO REVELA SE UM USUÁRIO EXISTE OU SE ESTÁ APROVADO
create or replace function public.convidar(cid uuid, p_login text)
returns void language plpgsql security definer set search_path = public as $$
declare alvo public.perfis%rowtype;
begin
  perform public.exigir_aprovado();
  if not public.eh_dono(cid) then raise exception 'Só o dono pode convidar.'; end if;
  if (select pessoal from public.controles where id = cid) then raise exception 'O "Meu controle" é só seu. Crie um controle compartilhado para convidar alguém.'; end if;
  select * into alvo from public.perfis where lower(email) = lower(btrim(p_login));
  if alvo.id is null or alvo.is_admin or alvo.status <> 'aprovado' then
    raise exception 'Não foi possível convidar. Confira o usuário: a pessoa precisa ter uma conta aprovada no app.';
  end if;
  if exists (select 1 from public.membros where controle_id = cid and user_id = alvo.id) then
    raise exception 'Essa pessoa já participa deste controle.';
  end if;
  insert into public.convites (controle_id, convidado, convidado_por)
  values (cid, alvo.id, auth.uid()) on conflict (controle_id, convidado) do nothing;
end $$;

-- 4) PERMISSÕES
do $$
declare f text;
begin
  foreach f in array array['login_publico(text)', 'participantes(uuid)', 'meus_convites()', 'convites_enviados(uuid)',
                           'admin_listar()', 'convidar(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
