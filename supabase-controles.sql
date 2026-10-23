-- =====================================================================
--  Pra Onde Foi? · CONTROLES COMPARTILHADOS (casal / família)
--  Rode DEPOIS do supabase-setup.sql, no SQL Editor → Run.
--  Pode rodar de novo sem problema. Lançamentos já existentes vão
--  automaticamente para o "Meu controle" de quem lançou.
-- =====================================================================

-- 1) TABELAS -----------------------------------------------------------
create table if not exists public.controles (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (char_length(nome) between 1 and 40),
  dono           uuid references auth.users(id) on delete set null,
  pessoal        boolean not null default false,
  codigo         text unique,
  codigo_expira  timestamptz,
  criado_em      timestamptz not null default now()
);
create unique index if not exists controles_um_pessoal_por_dono on public.controles (dono) where pessoal;

create table if not exists public.membros (
  controle_id  uuid not null references public.controles(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  entrou_em    timestamptz not null default now(),
  primary key (controle_id, user_id)
);
create index if not exists membros_user_idx on public.membros (user_id);

create table if not exists public.convites (
  id             uuid primary key default gen_random_uuid(),
  controle_id    uuid not null references public.controles(id) on delete cascade,
  convidado      uuid not null references auth.users(id) on delete cascade,
  convidado_por  uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  unique (controle_id, convidado)
);

-- 2) LANÇAMENTOS PASSAM A PERTENCER A UM CONTROLE -----------------------
alter table public.lancamentos add column if not exists controle_id uuid references public.controles(id) on delete cascade;
-- se a conta de quem lançou for excluída, o lançamento continua no controle compartilhado
alter table public.lancamentos alter column user_id drop not null;
alter table public.lancamentos drop constraint if exists lancamentos_user_id_fkey;
alter table public.lancamentos add constraint lancamentos_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete set null;
create index if not exists lancamentos_controle_data_idx on public.lancamentos (controle_id, data);

-- migra lançamentos antigos para o "Meu controle" de cada pessoa
do $$
declare r record; cid uuid;
begin
  for r in select distinct user_id from public.lancamentos where controle_id is null and user_id is not null loop
    select id into cid from public.controles where dono = r.user_id and pessoal;
    if cid is null then
      insert into public.controles (nome, dono, pessoal) values ('Meu controle', r.user_id, true) returning id into cid;
    end if;
    insert into public.membros (controle_id, user_id) values (cid, r.user_id) on conflict do nothing;
    update public.lancamentos set controle_id = cid where user_id = r.user_id and controle_id is null;
  end loop;
end $$;
alter table public.lancamentos alter column controle_id set not null;

-- 3) FUNÇÕES DE APOIO --------------------------------------------------
create or replace function public.eh_membro(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.membros where controle_id = cid and user_id = auth.uid());
$$;

create or replace function public.eh_dono(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.controles where id = cid and dono = auth.uid());
$$;

create or replace function public.exigir_aprovado()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_aprovado() then raise exception 'Sua conta não está liberada.'; end if;
end $$;

-- 4) REGRAS DE ACESSO (RLS) --------------------------------------------
alter table public.controles enable row level security;
alter table public.membros   enable row level security;
alter table public.convites  enable row level security;

drop policy if exists "ctrl_ler" on public.controles;
create policy "ctrl_ler" on public.controles for select to authenticated
  using (public.eh_membro(id));

drop policy if exists "memb_ler" on public.membros;
create policy "memb_ler" on public.membros for select to authenticated
  using (public.eh_membro(controle_id));

drop policy if exists "conv_ler" on public.convites;
create policy "conv_ler" on public.convites for select to authenticated
  using (convidado = auth.uid() or public.eh_dono(controle_id));
-- (criar, alterar e apagar controles/membros/convites só pelas funções abaixo)

-- Lançamentos: participantes do controle veem e lançam; só quem lançou apaga/edita.
-- O administrador NÃO é participante de nada, então não vê nada.
drop policy if exists "lanc_ler"    on public.lancamentos;
drop policy if exists "lanc_criar"  on public.lancamentos;
drop policy if exists "lanc_editar" on public.lancamentos;
drop policy if exists "lanc_apagar" on public.lancamentos;

create policy "lanc_ler" on public.lancamentos for select to authenticated
  using (public.eh_aprovado() and public.eh_membro(controle_id));

create policy "lanc_criar" on public.lancamentos for insert to authenticated
  with check (user_id = auth.uid() and public.eh_aprovado() and public.eh_membro(controle_id));

create policy "lanc_editar" on public.lancamentos for update to authenticated
  using (user_id = auth.uid() and public.eh_aprovado() and public.eh_membro(controle_id))
  with check (user_id = auth.uid() and public.eh_aprovado() and public.eh_membro(controle_id));

create policy "lanc_apagar" on public.lancamentos for delete to authenticated
  using (user_id = auth.uid() and public.eh_aprovado() and public.eh_membro(controle_id));

-- 5) AÇÕES DO APP ------------------------------------------------------

-- cria o "Meu controle" da pessoa, se ainda não existir
create or replace function public.garantir_controle_pessoal()
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  perform public.exigir_aprovado();
  select id into cid from public.controles where dono = auth.uid() and pessoal;
  if cid is null then
    insert into public.controles (nome, dono, pessoal) values ('Meu controle', auth.uid(), true) returning id into cid;
  end if;
  insert into public.membros (controle_id, user_id) values (cid, auth.uid()) on conflict do nothing;
  return cid;
end $$;

-- lista os controles de que a pessoa participa
create or replace function public.meus_controles()
returns table (id uuid, nome text, pessoal boolean, sou_dono boolean, participantes int,
               codigo text, codigo_expira timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.nome, c.pessoal, c.dono = auth.uid(),
         (select count(*)::int from public.membros m2 where m2.controle_id = c.id),
         case when c.dono = auth.uid() and c.codigo_expira > now() then c.codigo end,
         case when c.dono = auth.uid() and c.codigo_expira > now() then c.codigo_expira end
    from public.controles c
    join public.membros m on m.controle_id = c.id and m.user_id = auth.uid()
   where public.eh_aprovado()
   order by c.pessoal desc, c.criado_em;
$$;

-- participantes de um controle (só para quem participa dele)
create or replace function public.participantes(cid uuid)
returns table (user_id uuid, login text, eh_dono boolean, entrou_em timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.email, c.dono = m.user_id, m.entrou_em
    from public.membros m
    join public.controles c on c.id = m.controle_id
    left join public.perfis p on p.id = m.user_id
   where m.controle_id = cid and public.eh_membro(cid)
   order by m.entrou_em;
$$;

create or replace function public.criar_controle(p_nome text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; n text := btrim(coalesce(p_nome,''));
begin
  perform public.exigir_aprovado();
  if char_length(n) not between 1 and 40 then raise exception 'O nome precisa ter de 1 a 40 caracteres.'; end if;
  if (select count(*) from public.controles where dono = auth.uid() and not pessoal) >= 20 then
    raise exception 'Você já tem controles demais.';
  end if;
  insert into public.controles (nome, dono) values (n, auth.uid()) returning id into cid;
  insert into public.membros (controle_id, user_id) values (cid, auth.uid());
  return cid;
end $$;

create or replace function public.renomear_controle(cid uuid, p_nome text)
returns void language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(p_nome,''));
begin
  perform public.exigir_aprovado();
  if not public.eh_dono(cid) then raise exception 'Só o dono pode renomear.'; end if;
  if char_length(n) not between 1 and 40 then raise exception 'O nome precisa ter de 1 a 40 caracteres.'; end if;
  update public.controles set nome = n where id = cid;
end $$;

-- convidar pelo usuário ou e-mail (o app manda já no formato de login)
create or replace function public.convidar(cid uuid, p_login text)
returns void language plpgsql security definer set search_path = public as $$
declare alvo public.perfis%rowtype;
begin
  perform public.exigir_aprovado();
  if not public.eh_dono(cid) then raise exception 'Só o dono pode convidar.'; end if;
  if (select pessoal from public.controles where id = cid) then raise exception 'O "Meu controle" é só seu. Crie um controle compartilhado para convidar alguém.'; end if;
  select * into alvo from public.perfis where lower(email) = lower(btrim(p_login));
  if alvo.id is null or alvo.is_admin then raise exception 'Não encontramos ninguém com esse usuário.'; end if;
  if alvo.status <> 'aprovado' then raise exception 'Essa pessoa ainda não teve a conta aprovada.'; end if;
  if exists (select 1 from public.membros where controle_id = cid and user_id = alvo.id) then
    raise exception 'Essa pessoa já participa deste controle.';
  end if;
  insert into public.convites (controle_id, convidado, convidado_por)
  values (cid, alvo.id, auth.uid()) on conflict (controle_id, convidado) do nothing;
end $$;

-- convites que o dono enviou e ainda não foram respondidos
create or replace function public.convites_enviados(cid uuid)
returns table (id uuid, login text, criado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select v.id, p.email, v.criado_em
    from public.convites v left join public.perfis p on p.id = v.convidado
   where v.controle_id = cid and public.eh_dono(cid)
   order by v.criado_em;
$$;

create or replace function public.cancelar_convite(conv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.convites v where v.id = conv and public.eh_dono(v.controle_id);
end $$;

-- convites que a pessoa recebeu
create or replace function public.meus_convites()
returns table (id uuid, controle_nome text, de_login text)
language sql stable security definer set search_path = public as $$
  select v.id, c.nome, p.email
    from public.convites v
    join public.controles c on c.id = v.controle_id
    left join public.perfis p on p.id = v.convidado_por
   where v.convidado = auth.uid() and public.eh_aprovado()
   order by v.criado_em;
$$;

create or replace function public.responder_convite(conv uuid, aceitar boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  perform public.exigir_aprovado();
  select controle_id into cid from public.convites where id = conv and convidado = auth.uid();
  if cid is null then raise exception 'Convite não encontrado.'; end if;
  if aceitar then
    insert into public.membros (controle_id, user_id) values (cid, auth.uid()) on conflict do nothing;
  end if;
  delete from public.convites where id = conv;
  return case when aceitar then cid end;
end $$;

-- código de convite (vale 48 horas)
create or replace function public.gerar_codigo(cid uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  letras constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea; cod text; i int;
begin
  perform public.exigir_aprovado();
  if not public.eh_dono(cid) then raise exception 'Só o dono pode gerar código.'; end if;
  if (select pessoal from public.controles where id = cid) then raise exception 'O "Meu controle" não pode ser compartilhado.'; end if;
  loop
    b := extensions.gen_random_bytes(6); cod := '';
    for i in 0..5 loop
      cod := cod || substr(letras, (get_byte(b, i) % length(letras)) + 1, 1);
      if i = 2 then cod := cod || '-'; end if;
    end loop;
    exit when not exists (select 1 from public.controles where codigo = cod);
  end loop;
  update public.controles set codigo = cod, codigo_expira = now() + interval '48 hours' where id = cid;
  return cod;
end $$;

create or replace function public.cancelar_codigo(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_dono(cid) then raise exception 'Só o dono pode cancelar o código.'; end if;
  update public.controles set codigo = null, codigo_expira = null where id = cid;
end $$;

create or replace function public.entrar_com_codigo(p_codigo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; cod text := upper(regexp_replace(coalesce(p_codigo,''), '[^A-Za-z0-9]', '', 'g'));
begin
  perform public.exigir_aprovado();
  if length(cod) <> 6 then raise exception 'Código inválido.'; end if;
  cod := substr(cod, 1, 3) || '-' || substr(cod, 4, 3);
  select id into cid from public.controles where codigo = cod and codigo_expira > now() and not pessoal;
  if cid is null then raise exception 'Código inválido ou expirado. Peça um novo para quem te convidou.'; end if;
  insert into public.membros (controle_id, user_id) values (cid, auth.uid()) on conflict do nothing;
  delete from public.convites where controle_id = cid and convidado = auth.uid();
  return cid;
end $$;

-- sair: os lançamentos que a pessoa fez continuam no controle.
-- se o dono sair, o controle passa para quem participa há mais tempo;
-- se não sobrar ninguém, o controle é apagado.
create or replace function public.sair_controle(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare novo uuid;
begin
  if not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if (select pessoal from public.controles where id = cid) then raise exception 'Não dá para sair do "Meu controle".'; end if;
  delete from public.membros where controle_id = cid and user_id = auth.uid();
  if public.eh_dono(cid) then
    select user_id into novo from public.membros where controle_id = cid order by entrou_em limit 1;
    if novo is null then
      delete from public.controles where id = cid;
    else
      update public.controles set dono = novo, codigo = null, codigo_expira = null where id = cid;
    end if;
  end if;
end $$;

create or replace function public.remover_participante(cid uuid, alvo uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_dono(cid) then raise exception 'Só o dono pode remover participantes.'; end if;
  if alvo = auth.uid() then raise exception 'Para sair, use "Sair do controle".'; end if;
  delete from public.membros where controle_id = cid and user_id = alvo;
end $$;

create or replace function public.excluir_controle(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_dono(cid) then raise exception 'Só o dono pode excluir o controle.'; end if;
  if (select pessoal from public.controles where id = cid) then raise exception 'O "Meu controle" não pode ser excluído.'; end if;
  delete from public.controles where id = cid;
end $$;

-- 6) EXCLUIR CONTA (admin) agora também cuida dos controles ------------
create or replace function public.admin_excluir_usuario(alvo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record; novo uuid;
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  if alvo = auth.uid() then raise exception 'Você não pode excluir a própria conta por aqui.'; end if;
  delete from public.controles where dono = alvo and pessoal;           -- controle pessoal some junto
  for c in select id from public.controles where dono = alvo loop        -- compartilhados passam adiante
    select user_id into novo from public.membros
     where controle_id = c.id and user_id <> alvo order by entrou_em limit 1;
    if novo is null then delete from public.controles where id = c.id;
    else update public.controles set dono = novo, codigo = null, codigo_expira = null where id = c.id;
    end if;
  end loop;
  delete from auth.users where id = alvo;
end $$;

-- 7) PERMISSÕES --------------------------------------------------------
revoke all on public.controles, public.membros, public.convites from anon;
grant select on public.controles, public.membros, public.convites to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'eh_membro(uuid)','eh_dono(uuid)','exigir_aprovado()','garantir_controle_pessoal()','meus_controles()',
    'participantes(uuid)','criar_controle(text)','renomear_controle(uuid, text)','convidar(uuid, text)',
    'convites_enviados(uuid)','cancelar_convite(uuid)','meus_convites()','responder_convite(uuid, boolean)',
    'gerar_codigo(uuid)','cancelar_codigo(uuid)','entrar_com_codigo(text)','sair_controle(uuid)',
    'remover_participante(uuid, uuid)','excluir_controle(uuid)','admin_excluir_usuario(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
