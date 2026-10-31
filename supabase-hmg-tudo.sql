-- =====================================================================
--  Pra Onde Foi? · BANCO COMPLETO PARA UM PROJETO NOVO (ex.: o de testes, HMG)
--  Junta os 11 scripts, na ordem certa. Cole tudo no SQL Editor e clique em Run.
--  ANTES: em Database → Extensions, ative "pg_net" e "pg_cron".
--  DEPOIS: crie a primeira conta pelo app — ela vira o administrador.
--  Não use no projeto oficial (lá os scripts já foram rodados um a um).
-- =====================================================================


-- #####################################################################
-- ### supabase-setup.sql
-- #####################################################################
-- =====================================================================
--  Controle Financeiro · configuração do banco no Supabase
--  Cole tudo no SQL Editor do seu projeto e clique em "Run".
--  Pode rodar de novo sem problema (não apaga dados).
-- =====================================================================

-- 1) PERFIS: uma linha por pessoa cadastrada (só e-mail e situação)
create table if not exists public.perfis (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  status     text not null default 'pendente'
             check (status in ('pendente','aprovado','bloqueado')),
  is_admin   boolean not null default false,
  criado_em  timestamptz not null default now()
);

-- 2) LANÇAMENTOS: os dados financeiros de cada pessoa
create table if not exists public.lancamentos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo       text not null check (tipo in ('exp','inc')),
  descricao  text not null check (char_length(descricao) between 1 and 200),
  categoria  text not null check (char_length(categoria) between 1 and 60),
  valor      numeric(12,2) not null check (valor > 0),
  data       date not null,
  criado_em  timestamptz not null default now()
);
create index if not exists lancamentos_user_data_idx on public.lancamentos (user_id, data);

-- 3) FUNÇÕES DE APOIO (usadas pelas regras de acesso)
create or replace function public.eh_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.perfis where id = auth.uid()), false);
$$;

create or replace function public.eh_aprovado()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'aprovado' from public.perfis where id = auth.uid()), false);
$$;

-- 4) TODA CONTA NOVA vira um perfil "pendente".
--    A PRIMEIRA conta criada no app vira o administrador, já aprovada.
create or replace function public.ao_criar_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  primeiro boolean;
begin
  select not exists (select 1 from public.perfis where is_admin) into primeiro;
  insert into public.perfis (id, email, status, is_admin)
  values (new.id, new.email,
          case when primeiro then 'aprovado' else 'pendente' end,
          primeiro)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.ao_criar_usuario();

-- 5) REGRAS DE ACESSO (Row Level Security)
alter table public.perfis      enable row level security;
alter table public.lancamentos enable row level security;

-- Perfis: cada um vê o próprio; o admin vê a lista (e-mail e situação).
-- Ninguém altera perfis direto: mudanças passam pelas funções de admin abaixo.
drop policy if exists "perfis_ler" on public.perfis;
create policy "perfis_ler" on public.perfis
  for select to authenticated
  using (id = auth.uid() or public.eh_admin());

-- Lançamentos: SÓ o dono, e só se estiver aprovado.
-- Não existe regra para o admin aqui, então ele NÃO consegue ver
-- os lançamentos de ninguém além dos próprios.
drop policy if exists "lanc_ler"     on public.lancamentos;
drop policy if exists "lanc_criar"   on public.lancamentos;
drop policy if exists "lanc_editar"  on public.lancamentos;
drop policy if exists "lanc_apagar"  on public.lancamentos;

create policy "lanc_ler" on public.lancamentos
  for select to authenticated
  using (user_id = auth.uid() and public.eh_aprovado());

create policy "lanc_criar" on public.lancamentos
  for insert to authenticated
  with check (user_id = auth.uid() and public.eh_aprovado());

create policy "lanc_editar" on public.lancamentos
  for update to authenticated
  using (user_id = auth.uid() and public.eh_aprovado())
  with check (user_id = auth.uid() and public.eh_aprovado());

create policy "lanc_apagar" on public.lancamentos
  for delete to authenticated
  using (user_id = auth.uid() and public.eh_aprovado());

-- 6) AÇÕES DO ADMINISTRADOR
create or replace function public.admin_mudar_status(alvo uuid, novo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  if alvo = auth.uid() then raise exception 'Você não pode alterar o próprio acesso.'; end if;
  if novo not in ('pendente','aprovado','bloqueado') then raise exception 'Situação inválida.'; end if;
  update public.perfis set status = novo where id = alvo;
end $$;

-- Exclui a conta e, junto, todos os lançamentos dela (sem que o admin os veja).
create or replace function public.admin_excluir_usuario(alvo uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  if alvo = auth.uid() then raise exception 'Você não pode excluir a própria conta por aqui.'; end if;
  delete from auth.users where id = alvo;
end $$;

-- 7) PERMISSÕES EXPLÍCITAS
--    (necessárias quando "Expor automaticamente novas tabelas" está desmarcado)
--    Visitantes não logados (anon) não acessam nada; usuários logados
--    só têm acesso ao que as regras de RLS acima permitem.
grant usage on schema public to authenticated;
revoke all on public.perfis, public.lancamentos from anon;
grant select on public.perfis to authenticated;
grant select, insert, update, delete on public.lancamentos to authenticated;
revoke all on function public.eh_admin()    from public, anon;
revoke all on function public.eh_aprovado() from public, anon;
grant execute on function public.eh_admin()    to authenticated;
grant execute on function public.eh_aprovado() to authenticated;

revoke all on function public.admin_mudar_status(uuid, text) from public, anon;
revoke all on function public.admin_excluir_usuario(uuid)    from public, anon;
grant execute on function public.admin_mudar_status(uuid, text) to authenticated;
grant execute on function public.admin_excluir_usuario(uuid)    to authenticated;

-- 8) SENHA TEMPORÁRIA (para quem entra com nome de usuário e esqueceu a senha)
create extension if not exists pgcrypto with schema extensions;

create or replace function public.admin_definir_senha(alvo uuid, nova text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  if alvo = auth.uid() then raise exception 'Para a sua própria senha, use "Trocar senha".'; end if;
  if char_length(coalesce(nova,'')) < 6 then raise exception 'A senha precisa ter pelo menos 6 caracteres.'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(nova, extensions.gen_salt('bf')),
         updated_at = now()
   where id = alvo;
end $$;

revoke all on function public.admin_definir_senha(uuid, text) from public, anon;
grant execute on function public.admin_definir_senha(uuid, text) to authenticated;


-- #####################################################################
-- ### supabase-controles.sql
-- #####################################################################
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


-- #####################################################################
-- ### supabase-tempo-real.sql
-- #####################################################################
-- Pra Onde Foi? · ATUALIZAÇÃO EM TEMPO REAL
-- Liga o "Realtime" nas tabelas usadas pelos controles compartilhados.
-- Pode rodar mais de uma vez sem problema.
do $$
declare t text;
begin
  foreach t in array array['lancamentos','membros','convites'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;


-- #####################################################################
-- ### supabase-contas.sql
-- #####################################################################
-- =====================================================================
--  Pra Onde Foi? · CONTAS A PAGAR
--  Rodar depois do supabase-controles.sql. Pode rodar de novo sem problema.
--  Não apaga nem altera nada do que já existe.
-- =====================================================================

-- 1) TABELAS -----------------------------------------------------------

-- A conta em si (Luz, Aluguel, Cartão…). Uma linha por conta, não por mês.
create table if not exists public.contas (
  id          uuid primary key default gen_random_uuid(),
  controle_id uuid not null references public.controles(id) on delete cascade,
  criado_por  uuid references auth.users(id) on delete set null,
  nome        text not null check (char_length(nome) between 1 and 60),
  categoria   text not null check (char_length(categoria) between 1 and 60),
  valor       numeric(12,2) not null check (valor > 0),
  dia         smallint not null check (dia between 1 and 31),
  tipo        text not null check (tipo in ('fixa','parcelada','unica')),
  inicio      date not null check (extract(day from inicio) = 1),   -- 1º mês em que aparece
  parcelas    smallint check (parcelas between 2 and 240),          -- só para parcelada
  fim         date check (fim is null or extract(day from fim) = 1), -- fixa encerrada: último mês
  criado_em   timestamptz not null default now(),
  check ((tipo = 'parcelada') = (parcelas is not null))
);
create index if not exists contas_controle_idx on public.contas (controle_id);

-- Divisão: quanto cabe a cada pessoa (peso proporcional ao valor da conta)
create table if not exists public.conta_partes (
  conta_id uuid not null references public.contas(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  peso     numeric(12,2) not null check (peso > 0),
  primary key (conta_id, user_id)
);

-- Valor diferente só num mês (ex.: a luz deste mês veio R$ 187,30)
create table if not exists public.conta_meses (
  conta_id uuid not null references public.contas(id) on delete cascade,
  mes      date not null check (extract(day from mes) = 1),
  valor    numeric(12,2) not null check (valor > 0),
  primary key (conta_id, mes)
);

-- Pagamentos (podem ser vários por conta/mês: parcial, cada um a sua parte)
create table if not exists public.pagamentos (
  id            uuid primary key default gen_random_uuid(),
  conta_id      uuid not null references public.contas(id) on delete cascade,
  controle_id   uuid not null references public.controles(id) on delete cascade,
  mes           date not null check (extract(day from mes) = 1),
  user_id       uuid references auth.users(id) on delete set null,
  valor         numeric(12,2) not null check (valor > 0),
  data          date not null,
  -- a saída criada em Lançamentos; se alguém apagar a saída, o pagamento some junto
  lancamento_id uuid references public.lancamentos(id) on delete cascade,
  criado_em     timestamptz not null default now()
);
create index if not exists pagamentos_controle_mes_idx on public.pagamentos (controle_id, mes);
create index if not exists pagamentos_conta_mes_idx on public.pagamentos (conta_id, mes);

-- 2) FUNÇÕES DE APOIO ---------------------------------------------------

create or replace function public.conta_ocorre(p_tipo text, p_inicio date, p_parcelas int, p_fim date, m date)
returns boolean language sql immutable as $$
  select case p_tipo
    when 'unica'     then m = p_inicio
    when 'parcelada' then m >= p_inicio and m < (p_inicio + make_interval(months => p_parcelas))::date
    else                  m >= p_inicio and (p_fim is null or m <= p_fim)
  end;
$$;

create or replace function public.eh_membro_conta(conta uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.contas c
                   join public.membros m on m.controle_id = c.controle_id and m.user_id = auth.uid()
                  where c.id = conta);
$$;

-- 3) REGRAS DE ACESSO (só leitura direta; mudanças passam pelas funções) --
alter table public.contas       enable row level security;
alter table public.conta_partes enable row level security;
alter table public.conta_meses  enable row level security;
alter table public.pagamentos   enable row level security;

drop policy if exists "contas_ler" on public.contas;
create policy "contas_ler" on public.contas for select to authenticated
  using (public.eh_aprovado() and public.eh_membro(controle_id));
drop policy if exists "partes_ler" on public.conta_partes;
create policy "partes_ler" on public.conta_partes for select to authenticated
  using (public.eh_aprovado() and public.eh_membro_conta(conta_id));
drop policy if exists "meses_ler" on public.conta_meses;
create policy "meses_ler" on public.conta_meses for select to authenticated
  using (public.eh_aprovado() and public.eh_membro_conta(conta_id));
drop policy if exists "pag_ler" on public.pagamentos;
create policy "pag_ler" on public.pagamentos for select to authenticated
  using (public.eh_aprovado() and public.eh_membro(controle_id));

-- 4) AÇÕES ---------------------------------------------------------------

-- Criar (p_id nulo) ou editar uma conta. p_partes: [{"user_id":"…","peso":1}, …] ou [] para não dividir.
create or replace function public.salvar_conta(
  p_id uuid, cid uuid, p_nome text, p_categoria text, p_valor numeric, p_dia int,
  p_tipo text, p_inicio date, p_parcelas int, p_partes jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  nid uuid; n text := btrim(coalesce(p_nome,'')); cat text := btrim(coalesce(p_categoria,''));
  ini date := date_trunc('month', p_inicio)::date; parc int; p jsonb; eh_pessoal boolean;
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select controle_id into cid from public.contas where id = p_id and criado_por = auth.uid();
    if cid is null then raise exception 'Só quem criou a conta pode editar.'; end if;
  end if;
  if cid is null or not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if char_length(n) not between 1 and 60 then raise exception 'O nome precisa ter de 1 a 60 caracteres.'; end if;
  if char_length(cat) not between 1 and 60 then raise exception 'Escolha uma categoria.'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if p_dia is null or p_dia not between 1 and 31 then raise exception 'O dia do vencimento vai de 1 a 31.'; end if;
  if p_tipo not in ('fixa','parcelada','unica') then raise exception 'Tipo de conta inválido.'; end if;
  if ini is null then raise exception 'Informe o mês.'; end if;
  parc := case when p_tipo = 'parcelada' then p_parcelas end;
  if p_tipo = 'parcelada' and (parc is null or parc not between 2 and 240) then
    raise exception 'O número de parcelas vai de 2 a 240.';
  end if;

  select pessoal into eh_pessoal from public.controles where id = cid;
  p_partes := coalesce(p_partes, '[]'::jsonb);
  if jsonb_typeof(p_partes) <> 'array' then raise exception 'Divisão inválida.'; end if;
  if eh_pessoal and jsonb_array_length(p_partes) > 0 then raise exception 'O "Meu controle" não tem divisão.'; end if;
  for p in select * from jsonb_array_elements(p_partes) loop
    if not exists (select 1 from public.membros where controle_id = cid and user_id = (p->>'user_id')::uuid) then
      raise exception 'Só dá para dividir com quem participa do controle.';
    end if;
    if coalesce((p->>'peso')::numeric, 0) <= 0 then raise exception 'Cada parte precisa ter valor maior que zero.'; end if;
  end loop;

  if p_id is null then
    insert into public.contas (controle_id, criado_por, nome, categoria, valor, dia, tipo, inicio, parcelas)
    values (cid, auth.uid(), n, cat, round(p_valor, 2), p_dia, p_tipo, ini, parc) returning id into nid;
  else
    nid := p_id;
    update public.contas set nome = n, categoria = cat, valor = round(p_valor, 2), dia = p_dia, tipo = p_tipo,
           inicio = ini, parcelas = parc, fim = case when p_tipo = 'fixa' then fim end
     where id = nid;
    delete from public.conta_partes where conta_id = nid;
  end if;
  insert into public.conta_partes (conta_id, user_id, peso)
  select nid, (e->>'user_id')::uuid, round((e->>'peso')::numeric, 2) from jsonb_array_elements(p_partes) e
  on conflict (conta_id, user_id) do update set peso = excluded.peso;
  return nid;
end $$;

-- Valor só de um mês (null volta ao valor normal)
create or replace function public.valor_do_mes(conta uuid, p_mes date, p_valor numeric)
returns void language plpgsql security definer set search_path = public as $$
declare m date := date_trunc('month', p_mes)::date;
begin
  perform public.exigir_aprovado();
  if not exists (select 1 from public.contas where id = conta and criado_por = auth.uid()) then
    raise exception 'Só quem criou a conta pode mudar o valor.';
  end if;
  if p_valor is null then
    delete from public.conta_meses where conta_id = conta and mes = m;
  else
    if p_valor <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
    insert into public.conta_meses (conta_id, mes, valor) values (conta, m, round(p_valor, 2))
    on conflict (conta_id, mes) do update set valor = excluded.valor;
  end if;
end $$;

-- Conta fixa: para de aparecer a partir de p_mes (os meses anteriores ficam)
create or replace function public.encerrar_conta(conta uuid, p_mes date)
returns void language plpgsql security definer set search_path = public as $$
declare c public.contas%rowtype; m date := date_trunc('month', p_mes)::date;
begin
  perform public.exigir_aprovado();
  select * into c from public.contas where id = conta and criado_por = auth.uid();
  if c.id is null then raise exception 'Só quem criou a conta pode encerrar.'; end if;
  if m <= c.inicio then
    delete from public.contas where id = conta;
  else
    update public.contas set tipo = 'fixa', parcelas = null, fim = (m - interval '1 month')::date where id = conta;
  end if;
end $$;

create or replace function public.excluir_conta(conta uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_aprovado();
  if not exists (select 1 from public.contas where id = conta and criado_por = auth.uid()) then
    raise exception 'Só quem criou a conta pode excluir.';
  end if;
  delete from public.contas where id = conta;   -- as saídas já lançadas continuam em Lançamentos
end $$;

-- Pagar (tudo ou parte). Cria a saída em Lançamentos no nome de quem pagou.
create or replace function public.pagar_conta(conta uuid, p_mes date, p_valor numeric, p_data date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.contas%rowtype; m date := date_trunc('month', p_mes)::date;
  total numeric; pago numeric; falta numeric; v numeric := round(coalesce(p_valor,0), 2);
  descr text; lid uuid; pid uuid;
begin
  perform public.exigir_aprovado();
  select * into c from public.contas where id = conta for update;
  if c.id is null or not public.eh_membro(c.controle_id) then raise exception 'Conta não encontrada.'; end if;
  if not public.conta_ocorre(c.tipo, c.inicio, c.parcelas, c.fim, m) then raise exception 'Essa conta não existe neste mês.'; end if;
  if v <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if p_data is null or abs(p_data - current_date) > 400 then raise exception 'Data do pagamento inválida.'; end if;
  select coalesce((select valor from public.conta_meses where conta_id = conta and mes = m), c.valor) into total;
  select coalesce(sum(valor), 0) into pago from public.pagamentos where conta_id = conta and mes = m;
  falta := total - pago;
  if falta <= 0 then raise exception 'Essa conta já está paga.'; end if;
  if v > falta then raise exception 'O valor é maior do que falta pagar (R$ %).', translate(to_char(falta, 'FM999,999,990.00'), ',.', '.,'); end if;

  descr := c.nome || case when c.tipo = 'parcelada'
             then ' ' || ((extract(year from age(m, c.inicio)) * 12 + extract(month from age(m, c.inicio)))::int + 1) || '/' || c.parcelas
             else '' end;
  insert into public.lancamentos (user_id, controle_id, tipo, descricao, categoria, valor, data)
  values (auth.uid(), c.controle_id, 'exp', descr, c.categoria, v, p_data) returning id into lid;
  insert into public.pagamentos (conta_id, controle_id, mes, user_id, valor, data, lancamento_id)
  values (conta, c.controle_id, m, auth.uid(), v, p_data, lid) returning id into pid;
  return pid;
end $$;

-- Desfazer um pagamento seu: apaga o pagamento e a saída que ele criou
create or replace function public.desfazer_pagamento(pag uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  perform public.exigir_aprovado();
  select lancamento_id into lid from public.pagamentos where id = pag and user_id = auth.uid();
  if not found then raise exception 'Só quem pagou pode desfazer.'; end if;
  delete from public.pagamentos where id = pag;
  if lid is not null then delete from public.lancamentos where id = lid; end if;
end $$;

-- 5) PERMISSÕES -----------------------------------------------------------
revoke all on public.contas, public.conta_partes, public.conta_meses, public.pagamentos from anon;
grant select on public.contas, public.conta_partes, public.conta_meses, public.pagamentos to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'conta_ocorre(text, date, int, date, date)', 'eh_membro_conta(uuid)',
    'salvar_conta(uuid, uuid, text, text, numeric, int, text, date, int, jsonb)',
    'valor_do_mes(uuid, date, numeric)', 'encerrar_conta(uuid, date)', 'excluir_conta(uuid)',
    'pagar_conta(uuid, date, numeric, date)', 'desfazer_pagamento(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- 6) TEMPO REAL (a outra pessoa vê na hora) --------------------------------
do $$
declare t text;
begin
  foreach t in array array['lancamentos','membros','convites','contas','conta_partes','conta_meses','pagamentos'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;


-- #####################################################################
-- ### supabase-perfil.sql
-- #####################################################################
-- =====================================================================
--  Pra Onde Foi? · PERFIL (nome, foto, e-mail de aviso) e LOGIN COM GOOGLE
--  Rodar depois dos outros scripts. Pode rodar de novo sem problema.
--  Não apaga nem altera nada do que já existe.
-- =====================================================================

-- 1) NOVOS DADOS NO PERFIL
alter table public.perfis add column if not exists nome        text;
alter table public.perfis add column if not exists foto        text;     -- imagem pequena (data:image/jpeg…) ou link https da foto do Google
alter table public.perfis add column if not exists email_aviso text;     -- e-mail real para os avisos de contas
alter table public.perfis add column if not exists whatsapp    text;     -- opcional, só números
alter table public.perfis add column if not exists avisos      boolean not null default true;

alter table public.perfis drop constraint if exists perfis_nome_chk;
alter table public.perfis add  constraint perfis_nome_chk  check (nome is null or char_length(nome) between 1 and 40);
alter table public.perfis drop constraint if exists perfis_foto_chk;
alter table public.perfis add  constraint perfis_foto_chk  check (foto is null or (char_length(foto) <= 150000 and (foto like 'data:image/%' or foto like 'https://%')));
alter table public.perfis drop constraint if exists perfis_email_aviso_chk;
alter table public.perfis add  constraint perfis_email_aviso_chk check (email_aviso is null or (char_length(email_aviso) <= 120 and email_aviso ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
alter table public.perfis drop constraint if exists perfis_whatsapp_chk;
alter table public.perfis add  constraint perfis_whatsapp_chk check (whatsapp is null or whatsapp ~ '^[0-9]{10,13}$');

-- 2) CONTA NOVA: quem entra com Google já chega com nome, foto e e-mail
create or replace function public.ao_criar_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  primeiro boolean;
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  nm text; ft text; em text;
begin
  select not exists (select 1 from public.perfis where is_admin) into primeiro;
  nm := nullif(left(btrim(coalesce(meta->>'full_name', meta->>'name', '')), 40), '');
  ft := nullif(coalesce(meta->>'avatar_url', meta->>'picture', ''), '');
  if ft is not null and (ft not like 'https://%' or char_length(ft) > 1000) then ft := null; end if;
  em := case when new.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and new.email not like '%@usuarios.local'
               and char_length(new.email) <= 120 then new.email end;
  insert into public.perfis (id, email, status, is_admin, nome, foto, email_aviso)
  values (new.id, new.email,
          case when primeiro then 'aprovado' else 'pendente' end,
          primeiro, nm, ft, em)
  on conflict (id) do nothing;
  return new;
end $$;

-- 3) SALVAR O PRÓPRIO PERFIL
create or replace function public.salvar_perfil(p_nome text, p_email text, p_whatsapp text, p_avisos boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  n  text := nullif(btrim(coalesce(p_nome, '')), '');
  em text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  wa text := nullif(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g'), '');
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  if n is not null and char_length(n) > 40 then raise exception 'O nome pode ter até 40 caracteres.'; end if;
  if em is not null and (char_length(em) > 120 or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Esse e-mail não parece válido.';
  end if;
  if wa is not null and wa !~ '^[0-9]{10,13}$' then raise exception 'WhatsApp inválido. Use DDD + número, ex.: (65) 99999-9999.'; end if;
  update public.perfis set nome = n, email_aviso = em, whatsapp = wa, avisos = coalesce(p_avisos, true)
   where id = auth.uid();
end $$;

create or replace function public.salvar_foto(p_foto text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Entre na sua conta.'; end if;
  if p_foto is not null and (char_length(p_foto) > 150000 or (p_foto not like 'data:image/%' and p_foto not like 'https://%')) then
    raise exception 'Foto inválida ou grande demais.';
  end if;
  update public.perfis set foto = p_foto where id = auth.uid();
end $$;

-- 4) NOME E FOTO APARECEM PARA QUEM DIVIDE O CONTROLE
drop function if exists public.participantes(uuid);
create function public.participantes(cid uuid)
returns table (user_id uuid, login text, eh_dono boolean, entrou_em timestamptz, nome text, foto text)
language sql stable security definer set search_path = public as $$
  select m.user_id, p.email, c.dono = m.user_id, m.entrou_em, p.nome, p.foto
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
  select v.id, c.nome, p.email, p.nome
    from public.convites v
    join public.controles c on c.id = v.controle_id
    left join public.perfis p on p.id = v.convidado_por
   where v.convidado = auth.uid() and public.eh_aprovado()
   order by v.criado_em;
$$;

-- 5) PERMISSÕES
do $$
declare f text;
begin
  foreach f in array array['salvar_perfil(text, text, text, boolean)', 'salvar_foto(text)', 'participantes(uuid)', 'meus_convites()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- #####################################################################
-- ### supabase-seguranca.sql
-- #####################################################################
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


-- #####################################################################
-- ### supabase-advisor.sql
-- #####################################################################
-- Pra Onde Foi? · correções apontadas pelo Security Advisor do Supabase (pode rodar de novo)
alter function public.conta_ocorre(text, date, int, date, date) set search_path = '';
alter function public.login_publico(text) set search_path = '';
revoke all on function public.ao_criar_usuario() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_proc where proname = 'rls_auto_enable' and pronamespace = 'public'::regnamespace) then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;


-- #####################################################################
-- ### supabase-metas.sql
-- #####################################################################
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


-- #####################################################################
-- ### supabase-investimentos.sql
-- #####################################################################
-- =====================================================================
--  Pra Onde Foi? · INVESTIMENTOS + TAXAS DO BANCO CENTRAL (atualização automática)
--  Antes de rodar: Database → Extensions → ative "pg_net" e "pg_cron".
--  Pode rodar de novo sem problema. Só acrescenta; não mexe no que já existe.
-- =====================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 1) INVESTIMENTOS ------------------------------------------------------
create table if not exists public.investimentos (
  id          uuid primary key default gen_random_uuid(),
  controle_id uuid not null references public.controles(id) on delete cascade,
  criado_por  uuid references auth.users(id) on delete set null,
  nome        text not null check (char_length(nome) between 1 and 60),
  tipo        text not null check (tipo in ('poupanca','cdb','lci','lca','tesouro_selic','tesouro_ipca','tesouro_pre','acao','fii','outro')),
  indexador   text not null check (indexador in ('cdi','selic','ipca','pre','poupanca','cotacao','manual')),
  taxa        numeric(8,4),            -- % do CDI (110) · IPCA + (6) · prefixado (12) · Selic + (0,1)
  vencimento  date,
  isento      boolean not null default false,   -- LCI, LCA e poupança não pagam IR
  ticker      text check (ticker is null or ticker ~ '^[A-Z0-9]{4,7}$'),
  cotacao     numeric(14,4) check (cotacao is null or cotacao > 0),   -- ações/FIIs: preço atual (por enquanto informado à mão)
  cotacao_em  date,
  criado_em   timestamptz not null default now()
);
create index if not exists investimentos_controle_idx on public.investimentos (controle_id);

create table if not exists public.inv_movs (
  id              uuid primary key default gen_random_uuid(),
  investimento_id uuid not null references public.investimentos(id) on delete cascade,
  controle_id     uuid not null references public.controles(id) on delete cascade,
  user_id         uuid references auth.users(id) on delete set null,
  tipo            text not null check (tipo in ('aporte','resgate','saldo')),   -- saldo = "hoje vale X" (tipo Outro)
  valor           numeric(14,2) not null check (valor > 0),
  quantidade      numeric(18,6) check (quantidade is null or quantidade > 0),   -- ações/FIIs
  data            date not null,
  lancamento_id   uuid references public.lancamentos(id) on delete set null,
  criado_em       timestamptz not null default now()
);
create index if not exists inv_movs_inv_idx on public.inv_movs (investimento_id);
create index if not exists inv_movs_controle_idx on public.inv_movs (controle_id);

-- 2) TAXAS DO BANCO CENTRAL (CDI, Selic e IPCA) ----------------------------
create table if not exists public.indices (
  serie text not null check (serie in ('cdi','selic','ipca','selic_meta')),
  data  date not null,
  valor numeric(12,8) not null,   -- CDI e Selic: % ao dia · IPCA: % no mês
  primary key (serie, data)
);
alter table public.indices drop constraint if exists indices_serie_check;
alter table public.indices add constraint indices_serie_check check (serie in ('cdi','selic','ipca','selic_meta'));
create table if not exists public.indices_pedidos (
  req    bigint primary key,
  serie  text not null,
  criado timestamptz not null default now()
);

-- 3) REGRAS DE ACESSO ----------------------------------------------------
alter table public.investimentos   enable row level security;
alter table public.inv_movs        enable row level security;
alter table public.indices         enable row level security;
alter table public.indices_pedidos enable row level security;
drop policy if exists "inv_ler" on public.investimentos;
create policy "inv_ler" on public.investimentos for select to authenticated
  using (public.eh_aprovado() and public.eh_membro(controle_id));
drop policy if exists "inv_movs_ler" on public.inv_movs;
create policy "inv_movs_ler" on public.inv_movs for select to authenticated
  using (public.eh_aprovado() and public.eh_membro(controle_id));
drop policy if exists "indices_ler" on public.indices;
create policy "indices_ler" on public.indices for select to authenticated using (true);
-- indices_pedidos: ninguém lê pela internet (sem regra = sem acesso)

revoke all on public.investimentos, public.inv_movs, public.indices, public.indices_pedidos from anon;
revoke all on public.indices_pedidos from authenticated;
grant select on public.investimentos, public.inv_movs, public.indices to authenticated;

-- 4) AÇÕES ----------------------------------------------------------------
create or replace function public.salvar_investimento(
  p_id uuid, cid uuid, p_nome text, p_tipo text, p_indexador text, p_taxa numeric, p_vencimento date, p_ticker text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid; n text := btrim(coalesce(p_nome, '')); tk text := nullif(upper(btrim(coalesce(p_ticker, ''))), '');
        ix text := p_indexador; ok boolean;
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select controle_id into cid from public.investimentos where id = p_id and criado_por = auth.uid();
    if cid is null then raise exception 'Só quem cadastrou pode editar.'; end if;
  end if;
  if cid is null or not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if char_length(n) not between 1 and 60 then raise exception 'Dê um nome ao investimento (até 60 caracteres).'; end if;
  ok := case p_tipo
    when 'poupanca'      then ix = 'poupanca'
    when 'cdb'           then ix in ('cdi','pre','ipca')
    when 'lci'           then ix in ('cdi','pre','ipca')
    when 'lca'           then ix in ('cdi','pre','ipca')
    when 'tesouro_selic' then ix = 'selic'
    when 'tesouro_ipca'  then ix = 'ipca'
    when 'tesouro_pre'   then ix = 'pre'
    when 'acao'          then ix = 'cotacao'
    when 'fii'           then ix = 'cotacao'
    when 'outro'         then ix = 'manual'
    else false end;
  if not coalesce(ok, false) then raise exception 'Combinação de tipo e rentabilidade inválida.'; end if;
  if ix in ('cdi') and (p_taxa is null or p_taxa <= 0 or p_taxa > 300) then raise exception 'Informe quanto rende do CDI (ex.: 110).'; end if;
  if ix in ('pre','ipca') and (p_taxa is null or p_taxa < 0 or p_taxa > 100) then raise exception 'Informe a taxa ao ano (ex.: 12).'; end if;
  if ix = 'selic' and p_taxa is not null and (p_taxa < 0 or p_taxa > 10) then raise exception 'Taxa extra da Selic inválida.'; end if;
  if ix = 'cotacao' and (tk is null or tk !~ '^[A-Z0-9]{4,7}$') then raise exception 'Informe o código do ativo (ex.: PETR4, MXRF11).'; end if;
  if p_id is null then
    insert into public.investimentos (controle_id, criado_por, nome, tipo, indexador, taxa, vencimento, isento, ticker)
    values (cid, auth.uid(), n, p_tipo, ix, case when ix in ('cotacao','manual','poupanca') then null else p_taxa end,
            p_vencimento, p_tipo in ('lci','lca','poupanca'), case when ix = 'cotacao' then tk end)
    returning id into nid;
  else
    nid := p_id;
    update public.investimentos set nome = n, tipo = p_tipo, indexador = ix,
           taxa = case when ix in ('cotacao','manual','poupanca') then null else p_taxa end,
           vencimento = p_vencimento, isento = p_tipo in ('lci','lca','poupanca'), ticker = case when ix = 'cotacao' then tk end
     where id = nid;
  end if;
  return nid;
end $$;

create or replace function public.excluir_investimento(inv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_aprovado();
  if not exists (select 1 from public.investimentos where id = inv and criado_por = auth.uid()) then
    raise exception 'Só quem cadastrou pode excluir.';
  end if;
  delete from public.investimentos where id = inv;
end $$;

-- aporte, resgate ou "saldo de hoje". p_lancar: também lança em Lançamentos (aporte = saída, resgate = entrada)
create or replace function public.mover_investimento(inv uuid, p_tipo text, p_valor numeric, p_quantidade numeric, p_data date, p_lancar boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare i public.investimentos%rowtype; v numeric := round(coalesce(p_valor, 0), 2); lid uuid; mid uuid; qtd numeric;
begin
  perform public.exigir_aprovado();
  select * into i from public.investimentos where id = inv for update;
  if i.id is null or not public.eh_membro(i.controle_id) then raise exception 'Investimento não encontrado.'; end if;
  if p_tipo not in ('aporte','resgate','saldo') then raise exception 'Operação inválida.'; end if;
  if p_tipo = 'saldo' and i.indexador <> 'manual' then raise exception 'Este investimento é calculado automaticamente.'; end if;
  if v <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if p_data is null or p_data > current_date + 1 or p_data < date '1990-01-01' then raise exception 'Data inválida.'; end if;
  if i.indexador = 'cotacao' then
    if p_tipo = 'saldo' then raise exception 'Operação inválida.'; end if;
    if p_quantidade is null or p_quantidade <= 0 then raise exception 'Informe a quantidade.'; end if;
    if p_tipo = 'resgate' then
      select coalesce(sum(case when tipo = 'aporte' then quantidade else -quantidade end), 0) into qtd from public.inv_movs where investimento_id = inv;
      if p_quantidade > qtd then raise exception 'Você tem só % unidades deste ativo.', trim(to_char(qtd, 'FM999999990.######')); end if;
    end if;
  end if;
  if coalesce(p_lancar, false) and p_tipo <> 'saldo' then
    insert into public.lancamentos (user_id, controle_id, tipo, descricao, categoria, valor, data)
    values (auth.uid(), i.controle_id, case when p_tipo = 'aporte' then 'exp' else 'inc' end,
            case when p_tipo = 'aporte' then 'Aplicação: ' else 'Resgate: ' end || i.nome, 'Investimentos', v, p_data)
    returning id into lid;
  end if;
  insert into public.inv_movs (investimento_id, controle_id, user_id, tipo, valor, quantidade, data, lancamento_id)
  values (inv, i.controle_id, auth.uid(), p_tipo, v, case when i.indexador = 'cotacao' then p_quantidade end, p_data, lid)
  returning id into mid;
  return mid;
end $$;

create or replace function public.desfazer_inv_mov(mov uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.inv_movs%rowtype;
begin
  perform public.exigir_aprovado();
  select * into r from public.inv_movs where id = mov and user_id = auth.uid();
  if r.id is null then raise exception 'Só quem fez pode desfazer.'; end if;
  delete from public.inv_movs where id = mov;
  if r.lancamento_id is not null then delete from public.lancamentos where id = r.lancamento_id; end if;
end $$;

-- preço atual de ações e FIIs (por enquanto informado por quem participa do controle)
create or replace function public.atualizar_cotacao(inv uuid, p_preco numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_aprovado();
  if not exists (select 1 from public.investimentos where id = inv and indexador = 'cotacao' and public.eh_membro(controle_id)) then
    raise exception 'Investimento não encontrado.';
  end if;
  if p_preco is null or p_preco <= 0 then raise exception 'Informe um preço maior que zero.'; end if;
  update public.investimentos set cotacao = round(p_preco, 4), cotacao_em = current_date where id = inv;
end $$;

-- 5) ROBÔ DAS TAXAS: pede ao Banco Central e guarda na tabela "indices" --------
create or replace function public.indices_pedir(p_dias int default 40)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  base text := 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.';
  fim  text := to_char(current_date, 'DD/MM/YYYY');
  ini  text := to_char(current_date - greatest(p_dias, 5), 'DD/MM/YYYY');
  ini_ipca text := to_char(current_date - greatest(p_dias, 400), 'DD/MM/YYYY');
  r bigint;
begin
  r := net.http_get(url := base || '12/dados?formato=json&dataInicial=' || ini || '&dataFinal=' || fim, timeout_milliseconds := 30000);
  insert into public.indices_pedidos (req, serie) values (r, 'cdi') on conflict do nothing;
  r := net.http_get(url := base || '11/dados?formato=json&dataInicial=' || ini || '&dataFinal=' || fim, timeout_milliseconds := 30000);
  insert into public.indices_pedidos (req, serie) values (r, 'selic') on conflict do nothing;
  r := net.http_get(url := base || '433/dados?formato=json&dataInicial=' || ini_ipca || '&dataFinal=' || fim, timeout_milliseconds := 30000);
  insert into public.indices_pedidos (req, serie) values (r, 'ipca') on conflict do nothing;
  -- 432 = meta da Selic definida pelo Copom (% ao ano), só para mostrar na tela
  r := net.http_get(url := base || '432/dados?formato=json&dataInicial=' || ini || '&dataFinal=' || fim, timeout_milliseconds := 30000);
  insert into public.indices_pedidos (req, serie) values (r, 'selic_meta') on conflict do nothing;
end $$;

create or replace function public.indices_processar()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare p record; st int; ct text; n int := 0;
begin
  for p in select * from public.indices_pedidos order by criado loop
    select status_code, content into st, ct from net._http_response where id = p.req;
    if not found then
      if p.criado < now() - interval '2 hours' then delete from public.indices_pedidos where req = p.req; end if;
      continue;
    end if;
    if st = 200 and ct is not null and left(btrim(ct), 1) = '[' then
      insert into public.indices (serie, data, valor)
      select p.serie, to_date(e->>'data', 'DD/MM/YYYY'), replace(e->>'valor', ',', '.')::numeric
        from jsonb_array_elements(ct::jsonb) e
       where e->>'valor' ~ '^-?[0-9]+([.,][0-9]+)?$'
      on conflict (serie, data) do update set valor = excluded.valor;
      n := n + 1;
    end if;
    delete from public.indices_pedidos where req = p.req;
  end loop;
  return n;
end $$;

-- 6) PERMISSÕES ------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['salvar_investimento(uuid, uuid, text, text, text, numeric, date, text)', 'excluir_investimento(uuid)',
                           'mover_investimento(uuid, text, numeric, numeric, date, boolean)', 'desfazer_inv_mov(uuid)',
                           'atualizar_cotacao(uuid, numeric)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- o robô só roda pelo agendador do banco, nunca pela internet
  execute 'revoke all on function public.indices_pedir(int) from public, anon, authenticated';
  execute 'revoke all on function public.indices_processar() from public, anon, authenticated';
end $$;

do $$
declare t text;
begin
  foreach t in array array['investimentos','inv_movs'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object or undefined_object then null;
    end;
  end loop;
end $$;

-- 7) AGENDA: busca as taxas 3x por dia (8h, 12h e 18h de Brasília) e guarda 5 min depois
select cron.schedule('pof-indices-pedir',     '0 11,15,21 * * *', 'select public.indices_pedir(40)');
select cron.schedule('pof-indices-processar', '5 11,15,21 * * *', 'select public.indices_processar()');

-- 8) PRIMEIRA CARGA: histórico de ~4 anos (fica pronto alguns segundos depois)
select public.indices_pedir(1500);


-- #####################################################################
-- ### supabase-modulos.sql
-- #####################################################################
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


-- #####################################################################
-- ### supabase-seguranca2.sql
-- #####################################################################
-- =====================================================================
--  Pra Onde Foi? · SEGURANÇA, PARTE 2 (revisão antes de abrir para o público)
--  Rodar por último. Pode rodar de novo sem problema. Não apaga nem altera dados.
--  Se rodar de novo algum script antigo (metas, controles), rode este depois.
-- =====================================================================

-- 1) SALDO DE META SÓ DENTRO DO BANCO
--    meta_saldo() é usada só pelas outras funções do banco. Antes, quem soubesse
--    o código interno de uma meta de outra pessoa conseguia ver o saldo dela.
revoke all on function public.meta_saldo(uuid) from public, anon, authenticated;

-- 2) CÓDIGO DE CONVITE MAIS DIFÍCIL DE ADIVINHAR
--    Passa de 6 para 8 caracteres (ex.: K7P4-QX9M): ~850 bilhões de combinações.
--    Códigos antigos de 6 caracteres continuam valendo até expirar (48 h).
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
    b := extensions.gen_random_bytes(8); cod := '';
    for i in 0..7 loop
      cod := cod || substr(letras, (get_byte(b, i) % length(letras)) + 1, 1);
      if i = 3 then cod := cod || '-'; end if;
    end loop;
    exit when not exists (select 1 from public.controles where codigo = cod);
  end loop;
  update public.controles set codigo = cod, codigo_expira = now() + interval '48 hours' where id = cid;
  return cod;
end $$;

create or replace function public.entrar_com_codigo(p_codigo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; cod text := upper(regexp_replace(coalesce(p_codigo,''), '[^A-Za-z0-9]', '', 'g'));
begin
  perform public.exigir_aprovado();
  if length(cod) = 6 then cod := substr(cod, 1, 3) || '-' || substr(cod, 4, 3);
  elsif length(cod) = 8 then cod := substr(cod, 1, 4) || '-' || substr(cod, 5, 4);
  else raise exception 'Código inválido.'; end if;
  select id into cid from public.controles where codigo = cod and codigo_expira > now() and not pessoal;
  if cid is null then raise exception 'Código inválido ou expirado. Peça um novo para quem te convidou.'; end if;
  insert into public.membros (controle_id, user_id) values (cid, auth.uid()) on conflict do nothing;
  delete from public.convites where controle_id = cid and convidado = auth.uid();
  return cid;
end $$;

-- 3) NINGUÉM GRAVA DIRETO NAS TABELAS (só pelas funções do app)
--    As regras (RLS) já bloqueiam; aqui tiramos também a permissão, como segunda camada.
do $$
declare t text;
begin
  foreach t in array array['perfis','controles','membros','convites','contas','conta_partes','conta_meses','pagamentos',
                           'metas','meta_movs','investimentos','inv_movs','indices','indices_pedidos'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', t);
      execute format('revoke all on public.%I from anon', t);
    end if;
  end loop;
  -- lançamentos: a pessoa cria, edita e apaga os próprios (as regras conferem quem é o dono)
  revoke truncate, references, trigger on public.lancamentos from anon, authenticated;
  revoke all on public.lancamentos from anon;
end $$;

do $$
begin
  revoke all on function public.gerar_codigo(uuid) from public, anon;
  grant execute on function public.gerar_codigo(uuid) to authenticated;
  revoke all on function public.entrar_com_codigo(text) from public, anon;
  grant execute on function public.entrar_com_codigo(text) to authenticated;
end $$;
