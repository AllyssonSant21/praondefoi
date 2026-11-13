-- =====================================================================
--  Pra Onde Foi? · BANCO COMPLETO PARA UM PROJETO NOVO (ex.: o de testes, HMG)
--  Junta os 12 scripts, na ordem certa. Cole tudo no SQL Editor e clique em Run.
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


-- #####################################################################
-- ### supabase-metas2.sql
-- #####################################################################
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


-- ===== 13) supabase-seguranca3.sql =====
-- =====================================================================
--  Pra Onde Foi? · SEGURANÇA, PARTE 3 (checklist OWASP / LGPD)
--  Rodar depois do supabase-seguranca2.sql. Pode rodar de novo sem problema.
--  Não apaga nem altera dados de ninguém.
-- =====================================================================

-- 1) REGISTRO DE EVENTOS DE SEGURANÇA ----------------------------------
--    Guarda só QUEM (código interno do usuário), O QUÊ e QUANDO.
--    Nunca guarda senha, e-mail, nome, valores ou lançamentos.
create table if not exists public.eventos_seguranca (
  id       bigint generated always as identity primary key,
  quando   timestamptz not null default now(),
  evento   text not null,
  usuario  uuid,          -- de quem é a conta afetada
  autor    uuid,          -- quem fez (null = o próprio sistema / login)
  detalhe  text           -- só códigos internos (ex.: id do controle, novo status)
);
create index if not exists eventos_seguranca_quando on public.eventos_seguranca (quando desc);
alter table public.eventos_seguranca enable row level security;
revoke all on public.eventos_seguranca from public, anon, authenticated;
drop policy if exists eventos_admin_ler on public.eventos_seguranca;
create policy eventos_admin_ler on public.eventos_seguranca for select to authenticated using (public.eh_admin());
grant select on public.eventos_seguranca to authenticated;

create or replace function public.registrar_evento(p_evento text, p_usuario uuid, p_detalhe text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.eventos_seguranca (evento, usuario, autor, detalhe) values (p_evento, p_usuario, auth.uid(), p_detalhe);
$$;
revoke all on function public.registrar_evento(text, uuid, text) from public, anon, authenticated;

-- contas: criada, login, senha trocada, excluída
create or replace function public.ev_usuarios() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform public.registrar_evento('conta_criada', new.id);
  elsif tg_op = 'DELETE' then perform public.registrar_evento('conta_excluida', old.id);
  else
    if (to_jsonb(new)->>'last_sign_in_at') is distinct from (to_jsonb(old)->>'last_sign_in_at') then
      perform public.registrar_evento('login', new.id);
    end if;
    if new.encrypted_password is distinct from old.encrypted_password then
      perform public.registrar_evento(case when auth.uid() is distinct from new.id and auth.uid() is not null
                                           then 'senha_redefinida_admin' else 'senha_alterada' end, new.id);
    end if;
  end if;
  return null;
exception when others then return null;   -- o registro nunca pode travar login nem cadastro
end $$;
drop trigger if exists ev_usuarios on auth.users;
create trigger ev_usuarios after insert or update or delete on auth.users
  for each row execute function public.ev_usuarios();

-- permissões: status da conta (aprovado/bloqueado) e admin
create or replace function public.ev_perfis() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then perform public.registrar_evento('status_' || new.status, new.id); end if;
  if new.is_admin is distinct from old.is_admin then
    perform public.registrar_evento(case when new.is_admin then 'virou_admin' else 'deixou_admin' end, new.id);
  end if;
  return null;
exception when others then return null;   -- o registro nunca pode travar login nem cadastro
end $$;
drop trigger if exists ev_perfis on public.perfis;
create trigger ev_perfis after update on public.perfis for each row execute function public.ev_perfis();

-- quem entra e sai de controles compartilhados
create or replace function public.ev_membros() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform public.registrar_evento('entrou_controle', new.user_id, new.controle_id::text);
  else perform public.registrar_evento('saiu_controle', old.user_id, old.controle_id::text); end if;
  return null;
exception when others then return null;   -- o registro nunca pode travar login nem cadastro
end $$;
drop trigger if exists ev_membros on public.membros;
create trigger ev_membros after insert or delete on public.membros for each row execute function public.ev_membros();

-- dono do controle mudou
create or replace function public.ev_controles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.dono is distinct from old.dono then perform public.registrar_evento('dono_controle', new.dono, new.id::text); end if;
  return null;
exception when others then return null;   -- o registro nunca pode travar login nem cadastro
end $$;
drop trigger if exists ev_controles on public.controles;
create trigger ev_controles after update on public.controles for each row execute function public.ev_controles();

-- guarda 180 dias e apaga o resto (todo dia às 4h, se o agendador do Supabase estiver ligado)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'limpar-eventos-seguranca';
    perform cron.schedule('limpar-eventos-seguranca', '0 7 * * *',
      $c$delete from public.eventos_seguranca where quando < now() - interval '180 days'$c$);
  end if;
end $$;

-- 2) EXCLUIR MINHA CONTA (LGPD) ----------------------------------------
--    A própria pessoa apaga a conta pelo app. Some: perfil, foto, "Meu controle" com tudo dentro,
--    controles compartilhados em que ela era a única pessoa. Nos compartilhados com outras pessoas,
--    o controle passa para outra pessoa e os lançamentos dela ficam sem autor (sem nome nem e-mail).
create or replace function public.excluir_minha_conta(p_confirma text)
returns void language plpgsql security definer set search_path = public as $$
declare eu uuid := auth.uid(); c record; novo uuid;
begin
  if eu is null then raise exception 'Entre na sua conta.'; end if;
  if upper(btrim(coalesce(p_confirma, ''))) <> 'EXCLUIR' then raise exception 'Digite EXCLUIR para confirmar.'; end if;
  if public.eh_admin() and not exists (select 1 from public.perfis where is_admin and id <> eu) then
    raise exception 'Você é o único administrador. Passe o admin para outra pessoa antes de excluir a conta.';
  end if;
  delete from public.controles where dono = eu and pessoal;
  for c in select id from public.controles where dono = eu loop
    select user_id into novo from public.membros
     where controle_id = c.id and user_id <> eu order by entrou_em limit 1;
    if novo is null then delete from public.controles where id = c.id;
    else update public.controles set dono = novo, codigo = null, codigo_expira = null where id = c.id;
    end if;
  end loop;
  delete from auth.users where id = eu;   -- também encerra as sessões abertas
end $$;
revoke all on function public.excluir_minha_conta(text) from public, anon;
grant execute on function public.excluir_minha_conta(text) to authenticated;

-- 3) SENHA TEMPORÁRIA DO ADMIN: mínimo de 8 (igual ao resto do app), sempre com bcrypt
create or replace function public.admin_definir_senha(alvo uuid, nova text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  if alvo = auth.uid() then raise exception 'Para a sua própria senha, use "Trocar senha".'; end if;
  if char_length(coalesce(nova, '')) < 8 then raise exception 'A senha precisa ter pelo menos 8 caracteres.'; end if;
  if char_length(nova) > 72 then raise exception 'A senha pode ter no máximo 72 caracteres.'; end if;
  update auth.users
     set encrypted_password = extensions.crypt(nova, extensions.gen_salt('bf', 10)),
         updated_at = now()
   where id = alvo;
end $$;
revoke all on function public.admin_definir_senha(uuid, text) from public, anon;
grant execute on function public.admin_definir_senha(uuid, text) to authenticated;


-- ===== 14) supabase-uso.sql =====
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


-- ===== 15) supabase-categorias.sql =====
-- =====================================================================
--  Pra Onde Foi? · CATEGORIAS PERSONALIZADAS
--  Rodar depois do supabase-uso.sql. Pode rodar de novo sem problema.
--  Cada controle pode ter as próprias categorias (ex.: "Pet", "Academia").
--  Quem participa do controle vê e usa; quem criou (ou o dono) renomeia e esconde.
-- =====================================================================

create table if not exists public.categorias (
  id          uuid primary key default gen_random_uuid(),
  controle_id uuid not null references public.controles(id) on delete cascade,
  tipo        text not null check (tipo in ('exp','inc','ambos')),
  nome        text not null check (char_length(btrim(nome)) between 1 and 30),
  icone       text check (icone is null or char_length(icone) <= 8),
  oculta      boolean not null default false,
  criado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em   timestamptz not null default now()
);
create unique index if not exists categorias_nome_unico on public.categorias (controle_id, lower(btrim(nome)));

alter table public.categorias enable row level security;
drop policy if exists categorias_ver on public.categorias;
create policy categorias_ver on public.categorias for select to authenticated using (public.eh_membro(controle_id));
revoke all on public.categorias from anon;
revoke insert, update, delete, truncate, references, trigger on public.categorias from authenticated;
grant select on public.categorias to authenticated;

-- criar ou editar (renomear também atualiza os lançamentos e as contas daquele controle)
create or replace function public.salvar_categoria(p_id uuid, cid uuid, p_nome text, p_icone text, p_tipo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(p_nome, '')); ic text := nullif(btrim(coalesce(p_icone, '')), ''); antigo text; nid uuid; c public.categorias%rowtype;
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select * into c from public.categorias where id = p_id;
    if c.id is null or not public.eh_membro(c.controle_id) then raise exception 'Categoria não encontrada.'; end if;
    if c.criado_por is distinct from auth.uid() and not public.eh_dono(c.controle_id) then
      raise exception 'Só quem criou a categoria (ou o dono do controle) pode mudar.';
    end if;
    cid := c.controle_id; antigo := c.nome;
  end if;
  if cid is null or not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if char_length(n) not between 1 and 30 then raise exception 'Dê um nome para a categoria (até 30 caracteres).'; end if;
  if lower(n) in ('mercado','moradia','contas','transporte','saúde','saude','lazer','educação','educacao','outros','salário','salario','renda extra','metas') then
    raise exception 'Essa categoria já existe no app.';
  end if;
  if p_tipo not in ('exp','inc','ambos') then raise exception 'Escolha se é para saída, entrada ou as duas.'; end if;
  if ic is not null and char_length(ic) > 8 then raise exception 'Ícone inválido.'; end if;
  if exists (select 1 from public.categorias where controle_id = cid and lower(btrim(nome)) = lower(n) and id is distinct from p_id) then
    raise exception 'Já existe uma categoria com esse nome neste controle.';
  end if;
  if p_id is null then
    if (select count(*) from public.categorias where controle_id = cid) >= 40 then
      raise exception 'Este controle já tem 40 categorias. Esconda ou renomeie alguma.';
    end if;
    insert into public.categorias (controle_id, tipo, nome, icone) values (cid, p_tipo, n, ic) returning id into nid;
  else
    nid := p_id;
    update public.categorias set nome = n, icone = ic, tipo = p_tipo where id = nid;
    if antigo is distinct from n then
      update public.lancamentos set categoria = n where controle_id = cid and categoria = antigo;
      update public.contas set categoria = n where controle_id = cid and categoria = antigo;
    end if;
  end if;
  return nid;
end $$;

-- esconder / mostrar de novo (os lançamentos antigos continuam com o nome)
create or replace function public.ocultar_categoria(p_id uuid, p_oculta boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c public.categorias%rowtype;
begin
  perform public.exigir_aprovado();
  select * into c from public.categorias where id = p_id;
  if c.id is null or not public.eh_membro(c.controle_id) then raise exception 'Categoria não encontrada.'; end if;
  if c.criado_por is distinct from auth.uid() and not public.eh_dono(c.controle_id) then
    raise exception 'Só quem criou a categoria (ou o dono do controle) pode mudar.';
  end if;
  update public.categorias set oculta = coalesce(p_oculta, true) where id = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['salvar_categoria(uuid, uuid, text, text, text)', 'ocultar_categoria(uuid, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- =====================================================================
--  Pra Onde Foi? · CARTÕES DE CRÉDITO
--  Rodar depois do supabase-categorias.sql. Pode rodar de novo sem problema.
--  Não apaga nem altera nada do que já existe.
--
--  O app NUNCA guarda dados do cartão: nada de número, CVV, validade, senha,
--  agência ou conta. Só um apelido, o banco (para a cor), o dia que a fatura
--  fecha, o dia que vence e, se a pessoa quiser, o limite.
--
--  Compra no cartão não mexe no saldo do mês. Ela vai para a fatura; quando a
--  fatura é paga, aí sim entra uma saída em Lançamentos.
-- =====================================================================

-- 1) TABELAS -----------------------------------------------------------
create table if not exists public.cartoes (
  id          uuid primary key default gen_random_uuid(),
  controle_id uuid not null references public.controles(id) on delete cascade,
  nome        text not null check (char_length(btrim(nome)) between 1 and 30),
  banco       text check (banco is null or char_length(banco) <= 20),   -- chave da lista de bancos (só para a cor)
  icone       text check (icone is null or char_length(icone) <= 8),
  fecha       smallint not null check (fecha between 1 and 31),
  vence       smallint not null check (vence between 1 and 31),
  limite      numeric(12,2) check (limite is null or limite > 0),
  oculto      boolean not null default false,
  criado_por  uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em   timestamptz not null default now()
);
create index if not exists cartoes_controle_idx on public.cartoes (controle_id);

-- compra (à vista ou parcelada). fatura = mês da fatura da 1ª parcela (dia 1)
create table if not exists public.compras_cartao (
  id          uuid primary key default gen_random_uuid(),
  cartao_id   uuid not null references public.cartoes(id) on delete cascade,
  controle_id uuid not null references public.controles(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  descricao   text not null check (char_length(btrim(descricao)) between 1 and 200),
  categoria   text not null check (char_length(categoria) between 1 and 60),
  valor       numeric(12,2) not null check (valor > 0),
  parcelas    smallint not null default 1 check (parcelas between 1 and 24),
  data        date not null,
  fatura      date not null check (extract(day from fatura) = 1),
  criado_em   timestamptz not null default now()
);
create index if not exists compras_cartao_idx on public.compras_cartao (cartao_id, fatura);
create index if not exists compras_controle_idx on public.compras_cartao (controle_id, fatura);

-- pagamento da fatura (pode ser em partes). Cria a saída em Lançamentos.
create table if not exists public.pag_faturas (
  id            uuid primary key default gen_random_uuid(),
  cartao_id     uuid not null references public.cartoes(id) on delete cascade,
  controle_id   uuid not null references public.controles(id) on delete cascade,
  mes           date not null check (extract(day from mes) = 1),
  user_id       uuid references auth.users(id) on delete set null,
  valor         numeric(12,2) not null check (valor > 0),
  data          date not null,
  lancamento_id uuid references public.lancamentos(id) on delete cascade,  -- apagou a saída, o pagamento some junto
  criado_em     timestamptz not null default now()
);
create index if not exists pag_faturas_idx on public.pag_faturas (cartao_id, mes);

-- 2) ÁREA "CARTÕES" NOS CONTROLES COMPARTILHADOS ------------------------
do $$
declare ja boolean;
begin
  select coalesce(bool_or(pg_get_constraintdef(oid) like '%cartoes%'), false) into ja
    from pg_constraint where conname = 'controles_modulos_chk';
  alter table public.controles drop constraint if exists controles_modulos_chk;
  alter table public.controles add constraint controles_modulos_chk
    check (cardinality(modulos) >= 1 and modulos <@ array['lanc','contas','metas','invest','cartoes']);
  -- só na 1ª vez: quem já compartilha os gastos passa a compartilhar os cartões também
  if not ja then
    update public.controles set modulos = modulos || array['cartoes'] where 'lanc' = any(modulos) and not ('cartoes' = any(modulos));
  end if;
end $$;
alter table public.controles alter column modulos set default array['lanc','contas','metas','invest','cartoes'];

create or replace function public.definir_modulos(cid uuid, p_modulos text[])
returns void language plpgsql security definer set search_path = public as $$
declare ms text[];
begin
  perform public.exigir_aprovado();
  if not public.eh_dono(cid) then raise exception 'Só o dono escolhe o que o controle compartilha.'; end if;
  if (select pessoal from public.controles where id = cid) then raise exception 'O "Meu controle" sempre tem tudo.'; end if;
  select array_agg(distinct x order by x) into ms from unnest(coalesce(p_modulos, '{}')) x where x in ('lanc','contas','metas','invest','cartoes');
  if ms is null or cardinality(ms) = 0 then raise exception 'Deixe pelo menos uma área ligada.'; end if;
  update public.controles set modulos = ms where id = cid;
end $$;

create or replace function public.meus_controles()
returns table (id uuid, nome text, pessoal boolean, sou_dono boolean, participantes int, codigo text, codigo_expira timestamptz, modulos text[])
language sql stable security definer set search_path = public as $$
  select c.id, c.nome, c.pessoal, c.dono = auth.uid(),
         (select count(*)::int from public.membros m2 where m2.controle_id = c.id),
         case when c.dono = auth.uid() and c.codigo_expira > now() then c.codigo end,
         case when c.dono = auth.uid() and c.codigo_expira > now() then c.codigo_expira end,
         case when c.pessoal then array['lanc','contas','metas','invest','cartoes'] else c.modulos end
    from public.controles c
    join public.membros m on m.controle_id = c.id and m.user_id = auth.uid()
   where public.eh_aprovado()
   order by c.pessoal desc, c.criado_em;
$$;

-- 3) LEITURA: quem participa do controle vê; mudanças só pelas funções ---
alter table public.cartoes        enable row level security;
alter table public.compras_cartao enable row level security;
alter table public.pag_faturas    enable row level security;
drop policy if exists cartoes_ler on public.cartoes;
create policy cartoes_ler on public.cartoes for select to authenticated using (public.eh_aprovado() and public.eh_membro(controle_id));
drop policy if exists compras_ler on public.compras_cartao;
create policy compras_ler on public.compras_cartao for select to authenticated using (public.eh_aprovado() and public.eh_membro(controle_id));
drop policy if exists pagfat_ler on public.pag_faturas;
create policy pagfat_ler on public.pag_faturas for select to authenticated using (public.eh_aprovado() and public.eh_membro(controle_id));
revoke all on public.cartoes, public.compras_cartao, public.pag_faturas from anon;
revoke insert, update, delete, truncate, references, trigger on public.cartoes, public.compras_cartao, public.pag_faturas from authenticated;
grant select on public.cartoes, public.compras_cartao, public.pag_faturas to authenticated;

-- 4) CONTAS DA FATURA ----------------------------------------------------
-- em qual fatura (mês do vencimento) cai uma compra feita em p_data
create or replace function public.fatura_da_compra(p_fecha int, p_vence int, p_data date)
returns date language sql immutable as $$
  -- comprou no dia do fechamento ou depois: vai para a próxima fatura
  select (date_trunc('month', p_data)
          + make_interval(months => (case when extract(day from p_data) >= least(p_fecha, extract(day from (date_trunc('month', p_data) + interval '1 month - 1 day'))::int) then 1 else 0 end)
                                  + (case when p_vence <= p_fecha then 1 else 0 end)))::date;
$$;

-- total de uma fatura: soma das parcelas que caem nela (centavos que sobram ficam na 1ª parcela)
create or replace function public.total_fatura(p_cartao uuid, p_mes date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(
           case when k = 0 then valor - trunc(valor / parcelas, 2) * (parcelas - 1) else trunc(valor / parcelas, 2) end), 0)
    from (select c.valor, c.parcelas,
                 ((extract(year from age(p_mes, c.fatura)) * 12 + extract(month from age(p_mes, c.fatura)))::int) as k
            from public.compras_cartao c
           where c.cartao_id = p_cartao and c.fatura <= p_mes) x
   where k >= 0 and k < parcelas;
$$;

-- 5) AÇÕES ---------------------------------------------------------------
create or replace function public.pode_mexer_cartao(p_criado_por uuid, p_controle uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_criado_por is not distinct from auth.uid() or public.eh_dono(p_controle);
$$;

-- criar ou editar um cartão (só apelido, banco, fechamento, vencimento e limite)
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
  -- não deixa digitar número de cartão no apelido (12+ dígitos seguidos)
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
    -- mudou o fechamento/vencimento: as compras ainda não pagas são recalculadas
    if c.fecha <> p_fecha or c.vence <> p_vence then
      update public.compras_cartao x set fatura = public.fatura_da_compra(p_fecha, p_vence, x.data)
       where x.cartao_id = nid
         and not exists (select 1 from public.pag_faturas p where p.cartao_id = nid and p.mes >= x.fatura);
    end if;
  end if;
  return nid;
end $$;

-- esconder (mantém as compras) ou excluir de vez (some com as compras; as saídas já pagas continuam)
create or replace function public.ocultar_cartao(p_id uuid, p_oculto boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c public.cartoes%rowtype;
begin
  perform public.exigir_aprovado();
  select * into c from public.cartoes where id = p_id;
  if c.id is null or not public.eh_membro(c.controle_id) then raise exception 'Cartão não encontrado.'; end if;
  if not public.pode_mexer_cartao(c.criado_por, c.controle_id) then raise exception 'Só quem cadastrou o cartão (ou o dono do controle) pode mudar.'; end if;
  update public.cartoes set oculto = coalesce(p_oculto, true) where id = p_id;
end $$;

create or replace function public.excluir_cartao(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.cartoes%rowtype;
begin
  perform public.exigir_aprovado();
  select * into c from public.cartoes where id = p_id;
  if c.id is null or not public.eh_membro(c.controle_id) then raise exception 'Cartão não encontrado.'; end if;
  if not public.pode_mexer_cartao(c.criado_por, c.controle_id) then raise exception 'Só quem cadastrou o cartão (ou o dono do controle) pode excluir.'; end if;
  update public.pag_faturas set lancamento_id = null where cartao_id = p_id;   -- as faturas pagas continuam em Lançamentos
  delete from public.cartoes where id = p_id;
end $$;

-- lançar ou editar uma compra no cartão
create or replace function public.salvar_compra(p_id uuid, p_cartao uuid, p_desc text, p_cat text, p_valor numeric, p_parcelas int, p_data date)
returns date language plpgsql security definer set search_path = public as $$
declare k public.cartoes%rowtype; x public.compras_cartao%rowtype; d text := btrim(coalesce(p_desc, ''));
        cat text := btrim(coalesce(p_cat, '')); v numeric := round(coalesce(p_valor, 0), 2); f date;
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select * into x from public.compras_cartao where id = p_id;
    if x.id is null or not public.eh_membro(x.controle_id) then raise exception 'Compra não encontrada.'; end if;
    if x.user_id is distinct from auth.uid() and not public.eh_dono(x.controle_id) then raise exception 'Só quem lançou a compra pode mudar.'; end if;
  end if;
  select * into k from public.cartoes where id = p_cartao;
  if k.id is null or not public.eh_membro(k.controle_id) then raise exception 'Cartão não encontrado.'; end if;
  if x.id is not null and x.controle_id <> k.controle_id then raise exception 'Cartão não encontrado.'; end if;
  if not public.modulo_ativo(k.controle_id, 'cartoes') then raise exception 'Este controle não compartilha Cartões.'; end if;
  if char_length(d) not between 1 and 200 then raise exception 'Escreva uma descrição.'; end if;
  if char_length(cat) not between 1 and 60 then raise exception 'Escolha uma categoria.'; end if;
  if v <= 0 or v > 9999999 then raise exception 'Informe um valor maior que zero.'; end if;
  if p_parcelas is null or p_parcelas not between 1 and 24 then raise exception 'As parcelas vão de 1 a 24.'; end if;
  if p_data is null or abs(p_data - current_date) > 800 then raise exception 'Data da compra inválida.'; end if;
  f := public.fatura_da_compra(k.fecha, k.vence, p_data);
  if p_id is null then
    insert into public.compras_cartao (cartao_id, controle_id, user_id, descricao, categoria, valor, parcelas, data, fatura)
    values (k.id, k.controle_id, auth.uid(), d, cat, v, p_parcelas, p_data, f);
  else
    update public.compras_cartao set cartao_id = k.id, descricao = d, categoria = cat, valor = v, parcelas = p_parcelas, data = p_data, fatura = f
     where id = p_id;
  end if;
  return f;
end $$;

create or replace function public.excluir_compra(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare x public.compras_cartao%rowtype;
begin
  perform public.exigir_aprovado();
  select * into x from public.compras_cartao where id = p_id;
  if x.id is null or not public.eh_membro(x.controle_id) then raise exception 'Compra não encontrada.'; end if;
  if x.user_id is distinct from auth.uid() and not public.eh_dono(x.controle_id) then raise exception 'Só quem lançou a compra pode excluir.'; end if;
  delete from public.compras_cartao where id = p_id;
end $$;

-- pagar a fatura (tudo ou parte): cria a saída em Lançamentos, categoria "Cartão de crédito"
create or replace function public.pagar_fatura(p_cartao uuid, p_mes date, p_valor numeric, p_data date)
returns uuid language plpgsql security definer set search_path = public as $$
declare k public.cartoes%rowtype; m date := date_trunc('month', p_mes)::date; v numeric := round(coalesce(p_valor, 0), 2);
        total numeric; pago numeric; falta numeric; lid uuid; pid uuid;
        meses text[] := array['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
begin
  perform public.exigir_aprovado();
  select * into k from public.cartoes where id = p_cartao for update;
  if k.id is null or not public.eh_membro(k.controle_id) then raise exception 'Cartão não encontrado.'; end if;
  if m is null then raise exception 'Informe o mês da fatura.'; end if;
  if v <= 0 then raise exception 'Informe um valor maior que zero.'; end if;
  if p_data is null or abs(p_data - current_date) > 400 then raise exception 'Data do pagamento inválida.'; end if;
  total := public.total_fatura(k.id, m);
  select coalesce(sum(valor), 0) into pago from public.pag_faturas where cartao_id = k.id and mes = m;
  falta := total - pago;
  if falta <= 0 then raise exception 'Essa fatura já está paga.'; end if;
  if v > falta then raise exception 'O valor é maior do que falta pagar (R$ %).', translate(to_char(falta, 'FM999,999,990.00'), ',.', '.,'); end if;
  insert into public.lancamentos (user_id, controle_id, tipo, descricao, categoria, valor, data)
  values (auth.uid(), k.controle_id, 'exp', 'Fatura ' || k.nome || ' · ' || meses[extract(month from m)::int] || '/' || to_char(m, 'YY'),
          'Cartão de crédito', v, p_data) returning id into lid;
  insert into public.pag_faturas (cartao_id, controle_id, mes, user_id, valor, data, lancamento_id)
  values (k.id, k.controle_id, m, auth.uid(), v, p_data, lid) returning id into pid;
  return pid;
end $$;

create or replace function public.desfazer_pag_fatura(pag uuid)
returns void language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  perform public.exigir_aprovado();
  select lancamento_id into lid from public.pag_faturas where id = pag and user_id = auth.uid();
  if not found then raise exception 'Só quem pagou pode desfazer.'; end if;
  delete from public.pag_faturas where id = pag;
  if lid is not null then delete from public.lancamentos where id = lid; end if;
end $$;

-- "Cartão de crédito" passa a ser categoria do app (não dá para criar outra com esse nome)
create or replace function public.salvar_categoria(p_id uuid, cid uuid, p_nome text, p_icone text, p_tipo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(p_nome, '')); ic text := nullif(btrim(coalesce(p_icone, '')), ''); antigo text; nid uuid; c public.categorias%rowtype;
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select * into c from public.categorias where id = p_id;
    if c.id is null or not public.eh_membro(c.controle_id) then raise exception 'Categoria não encontrada.'; end if;
    if c.criado_por is distinct from auth.uid() and not public.eh_dono(c.controle_id) then
      raise exception 'Só quem criou a categoria (ou o dono do controle) pode mudar.';
    end if;
    cid := c.controle_id; antigo := c.nome;
  end if;
  if cid is null or not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if char_length(n) not between 1 and 30 then raise exception 'Dê um nome para a categoria (até 30 caracteres).'; end if;
  if lower(n) in ('mercado','moradia','contas','transporte','saúde','saude','lazer','educação','educacao','outros','salário','salario','renda extra','metas',
                  'cartão de crédito','cartao de credito') then
    raise exception 'Essa categoria já existe no app.';
  end if;
  if p_tipo not in ('exp','inc','ambos') then raise exception 'Escolha se é para saída, entrada ou as duas.'; end if;
  if ic is not null and char_length(ic) > 8 then raise exception 'Ícone inválido.'; end if;
  if exists (select 1 from public.categorias where controle_id = cid and lower(btrim(nome)) = lower(n) and id is distinct from p_id) then
    raise exception 'Já existe uma categoria com esse nome neste controle.';
  end if;
  if p_id is null then
    if (select count(*) from public.categorias where controle_id = cid) >= 40 then
      raise exception 'Este controle já tem 40 categorias. Esconda ou renomeie alguma.';
    end if;
    insert into public.categorias (controle_id, tipo, nome, icone) values (cid, p_tipo, n, ic) returning id into nid;
  else
    nid := p_id;
    update public.categorias set nome = n, icone = ic, tipo = p_tipo where id = nid;
    if antigo is distinct from n then
      update public.lancamentos set categoria = n where controle_id = cid and categoria = antigo;
      update public.contas set categoria = n where controle_id = cid and categoria = antigo;
      update public.compras_cartao set categoria = n where controle_id = cid and categoria = antigo;
    end if;
  end if;
  return nid;
end $$;

-- 6) PERMISSÕES -----------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'definir_modulos(uuid, text[])', 'meus_controles()',
    'salvar_cartao(uuid, uuid, text, text, text, int, int, numeric)', 'ocultar_cartao(uuid, boolean)', 'excluir_cartao(uuid)',
    'salvar_compra(uuid, uuid, text, text, numeric, int, date)', 'excluir_compra(uuid)',
    'pagar_fatura(uuid, date, numeric, date)', 'desfazer_pag_fatura(uuid)', 'salvar_categoria(uuid, uuid, text, text, text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- funções internas: só o próprio banco usa
  foreach f in array array['total_fatura(uuid, date)', 'pode_mexer_cartao(uuid, uuid)', 'fatura_da_compra(int, int, date)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- 7) TEMPO REAL (a outra pessoa do controle vê na hora) --------------------
do $$
declare t text;
begin
  foreach t in array array['cartoes','compras_cartao','pag_faturas'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object or undefined_object then null;
    end;
  end loop;
end $$;


-- =====================================================================
--  Pra Onde Foi? · CARTÕES, PARTE 2
--  Rodar depois do supabase-cartoes.sql. Pode rodar de novo sem problema.
--  Não apaga nem altera nada do que já existe.
--
--  1) Parcelado que já estava rolando antes do app ("estou na parcela 5 de 10")
--  2) Saldo anterior: um valor que já estava na fatura (sem lançar compra por compra)
-- =====================================================================

alter table public.compras_cartao add column if not exists parcela_ini smallint not null default 1;
alter table public.compras_cartao add column if not exists ajuste boolean not null default false;
alter table public.compras_cartao drop constraint if exists compras_parcela_ini_chk;
alter table public.compras_cartao add constraint compras_parcela_ini_chk check (parcela_ini between 1 and parcelas);

-- total de uma fatura: soma das parcelas que caem nela.
-- A compra começa a cair na fatura "fatura" pela parcela "parcela_ini" (centavos que sobram ficam na parcela 1)
create or replace function public.total_fatura(p_cartao uuid, p_mes date)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(
           case when j = 0 then valor - trunc(valor / parcelas, 2) * (parcelas - 1) else trunc(valor / parcelas, 2) end), 0)
    from (select c.valor, c.parcelas,
                 c.parcela_ini - 1 + ((extract(year from age(p_mes, c.fatura)) * 12 + extract(month from age(p_mes, c.fatura)))::int) as j
            from public.compras_cartao c
           where c.cartao_id = p_cartao and c.fatura <= p_mes) x
   where j >= 0 and j < parcelas;
$$;

-- lançar ou editar uma compra (agora com a parcela em que já está)
create or replace function public.salvar_compra(p_id uuid, p_cartao uuid, p_desc text, p_cat text, p_valor numeric, p_parcelas int, p_data date, p_parcela_ini int)
returns date language plpgsql security definer set search_path = public as $$
declare k public.cartoes%rowtype; x public.compras_cartao%rowtype; d text := btrim(coalesce(p_desc, ''));
        cat text := btrim(coalesce(p_cat, '')); v numeric := round(coalesce(p_valor, 0), 2); f date; ini int := coalesce(p_parcela_ini, 1);
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
  if ini not between 1 and p_parcelas then raise exception 'A parcela atual tem que estar entre 1 e %.', p_parcelas; end if;
  if p_data is null or abs(p_data - current_date) > 800 then raise exception 'Data inválida.'; end if;
  f := public.fatura_da_compra(k.fecha, k.vence, p_data);
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

-- a versão antiga (sem a parcela atual) continua funcionando: começa na parcela 1
create or replace function public.salvar_compra(p_id uuid, p_cartao uuid, p_desc text, p_cat text, p_valor numeric, p_parcelas int, p_data date)
returns date language sql security definer set search_path = public as $$
  select public.salvar_compra(p_id, p_cartao, p_desc, p_cat, p_valor, p_parcelas, p_data, 1);
$$;

-- saldo anterior: um valor que já estava numa fatura (fica como uma linha "Saldo anterior" nela)
create or replace function public.salvar_ajuste_fatura(p_id uuid, p_cartao uuid, p_mes date, p_valor numeric, p_desc text)
returns uuid language plpgsql security definer set search_path = public as $$
declare k public.cartoes%rowtype; x public.compras_cartao%rowtype; m date := date_trunc('month', p_mes)::date;
        v numeric := round(coalesce(p_valor, 0), 2); d text := coalesce(nullif(btrim(coalesce(p_desc, '')), ''), 'Saldo anterior da fatura');
        dia date; nid uuid;
begin
  perform public.exigir_aprovado();
  if p_id is not null then
    select * into x from public.compras_cartao where id = p_id;
    if x.id is null or not public.eh_membro(x.controle_id) or not x.ajuste then raise exception 'Saldo não encontrado.'; end if;
    if x.user_id is distinct from auth.uid() and not public.eh_dono(x.controle_id) then raise exception 'Só quem lançou pode mudar.'; end if;
  end if;
  select * into k from public.cartoes where id = coalesce(p_cartao, x.cartao_id);
  if k.id is null or not public.eh_membro(k.controle_id) then raise exception 'Cartão não encontrado.'; end if;
  if not public.modulo_ativo(k.controle_id, 'cartoes') then raise exception 'Este controle não compartilha Cartões.'; end if;
  if m is null or abs(m - date_trunc('month', current_date)::date) > 800 then raise exception 'Escolha o mês da fatura.'; end if;
  if v <= 0 or v > 9999999 then raise exception 'Informe um valor maior que zero.'; end if;
  if char_length(d) > 200 then raise exception 'Descrição muito longa.'; end if;
  -- a data fica no meio do período da fatura (14 dias depois do fechamento anterior),
  -- para o saldo aparecer junto com as compras daquela fatura
  dia := (case when k.vence <= k.fecha then m - interval '2 month' else m - interval '1 month' end)::date;
  dia := dia + (least(k.fecha, extract(day from (dia + interval '1 month - 1 day'))::int) - 1) + 14;
  if p_id is null then
    insert into public.compras_cartao (cartao_id, controle_id, user_id, descricao, categoria, valor, parcelas, parcela_ini, data, fatura, ajuste)
    values (k.id, k.controle_id, auth.uid(), d, 'Outros', v, 1, 1, dia, m, true) returning id into nid;
  else
    nid := p_id;
    update public.compras_cartao set cartao_id = k.id, descricao = d, valor = v, data = dia, fatura = m where id = nid;
  end if;
  return nid;
end $$;

-- mudou o fechamento/vencimento do cartão: o saldo anterior fica na fatura que a pessoa escolheu
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
      update public.compras_cartao x set fatura = public.fatura_da_compra(p_fecha, p_vence, x.data)
       where x.cartao_id = nid and not x.ajuste
         and not exists (select 1 from public.pag_faturas p where p.cartao_id = nid and p.mes >= x.fatura);
    end if;
  end if;
  return nid;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'salvar_compra(uuid, uuid, text, text, numeric, int, date, int)', 'salvar_compra(uuid, uuid, text, text, numeric, int, date)',
    'salvar_ajuste_fatura(uuid, uuid, date, numeric, text)', 'salvar_cartao(uuid, uuid, text, text, text, int, int, numeric)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.total_fatura(uuid, date) from public, anon, authenticated';
  -- funções internas de registro: ninguém chama direto (fecha o que sobrou aberto)
  foreach f in array array['ev_usuarios()', 'ev_perfis()', 'ev_membros()', 'ev_controles()'] loop
    if to_regprocedure('public.' || f) is not null then   -- só se existir (vem do supabase-seguranca3.sql)
      execute format('revoke all on function public.%s from public, anon, authenticated', f);
    end if;
  end loop;
end $$;


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


-- =====================================================================
--  Pra Onde Foi? · BOT DO WHATSAPP (teste no HMG)
--  Rodar depois do supabase-cartoes3.sql. Pode rodar de novo sem problema.
--  Não apaga nem altera nada do que já existe.
--
--  Como o número é ligado à conta (sem risco de alguém usar o número de outro):
--  1) no app, a pessoa pede um código de 6 dígitos (vale 15 minutos);
--  2) ela manda o código para o bot pelo próprio WhatsApp;
--  3) o número que mandou (confirmado pela Meta) fica ligado à conta dela.
--  O bot (função do Supabase) usa as funções bot_* abaixo, que só ele pode chamar.
-- =====================================================================

-- número ligado → conta e controle onde o bot lança
create table if not exists public.whatsapp_vinculos (
  wa_id        text primary key check (wa_id ~ '^[0-9]{8,15}$'),
  user_id      uuid not null unique references auth.users(id) on delete cascade,
  controle_id  uuid references public.controles(id) on delete set null,
  ultimo_lanc  uuid,
  criado_em    timestamptz not null default now()
);

-- códigos de ligação (1 por pessoa, vale 15 minutos)
create table if not exists public.whatsapp_codigos (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  codigo       text not null unique check (codigo ~ '^[0-9]{6}$'),
  controle_id  uuid not null references public.controles(id) on delete cascade,
  expira       timestamptz not null
);

-- mensagens recebidas (evita lançar 2x se a Meta reenviar; limite de mensagens por minuto)
create table if not exists public.whatsapp_msgs (
  id         text primary key,
  wa_id      text not null,
  ok         boolean not null default true,     -- false = código errado (conta pras tentativas)
  criado_em  timestamptz not null default now()
);
create index if not exists whatsapp_msgs_wa_idx on public.whatsapp_msgs (wa_id, criado_em);

alter table public.whatsapp_vinculos enable row level security;
alter table public.whatsapp_codigos  enable row level security;
alter table public.whatsapp_msgs     enable row level security;
drop policy if exists wa_vinc_ver on public.whatsapp_vinculos;
create policy wa_vinc_ver on public.whatsapp_vinculos for select to authenticated using (user_id = auth.uid());
revoke all on public.whatsapp_vinculos, public.whatsapp_codigos, public.whatsapp_msgs from anon, authenticated;
grant select on public.whatsapp_vinculos to authenticated;

-- ---------- funções do app (pessoa logada) ----------

-- gera o código para ligar o WhatsApp; o bot vai lançar no controle escolhido
create or replace function public.whatsapp_gerar_codigo(cid uuid)
returns text language plpgsql security definer set search_path = public as $$
declare cod text; tent int := 0;
begin
  perform public.exigir_aprovado();
  if cid is null or not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if not public.modulo_ativo(cid, 'lanc') then raise exception 'Este controle não compartilha Lançamentos.'; end if;
  loop
    cod := lpad((('x' || substr(md5(gen_random_uuid()::text), 1, 7))::bit(28)::int % 1000000)::text, 6, '0');
    exit when not exists (select 1 from public.whatsapp_codigos where codigo = cod and user_id <> auth.uid());
    tent := tent + 1; if tent > 20 then raise exception 'Tente de novo.'; end if;
  end loop;
  insert into public.whatsapp_codigos (user_id, codigo, controle_id, expira)
  values (auth.uid(), cod, cid, now() + interval '15 minutes')
  on conflict (user_id) do update set codigo = excluded.codigo, controle_id = excluded.controle_id, expira = excluded.expira;
  return cod;
end $$;

-- como está a ligação (número com final escondido + controle)
create or replace function public.whatsapp_meu()
returns table (final text, controle_id uuid, controle_nome text) language sql stable security definer set search_path = public as $$
  select right(v.wa_id, 4), v.controle_id, c.nome
    from public.whatsapp_vinculos v left join public.controles c on c.id = v.controle_id
   where v.user_id = auth.uid();
$$;

-- muda o controle onde o bot lança
create or replace function public.whatsapp_definir_controle(cid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_aprovado();
  if cid is null or not public.eh_membro(cid) then raise exception 'Você não participa deste controle.'; end if;
  if not public.modulo_ativo(cid, 'lanc') then raise exception 'Este controle não compartilha Lançamentos.'; end if;
  update public.whatsapp_vinculos set controle_id = cid where user_id = auth.uid();
end $$;

-- desliga o WhatsApp da conta
create or replace function public.whatsapp_desligar()
returns void language sql security definer set search_path = public as $$
  delete from public.whatsapp_vinculos where user_id = auth.uid();
  delete from public.whatsapp_codigos  where user_id = auth.uid();
$$;

-- ---------- funções do bot (só a função do Supabase, com a chave de serviço) ----------

-- registra a mensagem: 'ok', 'repetida' (a Meta reenviou) ou 'limite' (mensagens demais)
create or replace function public.bot_registrar_msg(p_id text, p_wa text)
returns text language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.whatsapp_msgs (id, wa_id) values (p_id, p_wa) on conflict (id) do nothing;
  if not found then return 'repetida'; end if;
  select count(*) into n from public.whatsapp_msgs where wa_id = p_wa and criado_em > now() - interval '1 minute';
  if n > 20 then return 'limite'; end if;
  select count(*) into n from public.whatsapp_msgs where wa_id = p_wa and criado_em > now() - interval '1 day';
  if n > 300 then return 'limite'; end if;
  delete from public.whatsapp_msgs where criado_em < now() - interval '3 days';
  return 'ok';
end $$;

-- quem é esse número: conta, nome, controle e categorias próprias do controle
create or replace function public.bot_contexto(p_wa text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.whatsapp_vinculos%rowtype; p public.perfis%rowtype; cid uuid; cnome text;
begin
  select * into v from public.whatsapp_vinculos where wa_id = p_wa;
  if v.wa_id is null then return null; end if;
  select * into p from public.perfis where id = v.user_id;
  cid := v.controle_id;
  -- saiu do controle ou o controle sumiu: volta para o "Meu controle"
  if cid is null or not exists (select 1 from public.membros where controle_id = cid and user_id = v.user_id)
     or not public.modulo_ativo(cid, 'lanc') then
    select id into cid from public.controles where dono = v.user_id and pessoal;
  end if;
  select nome into cnome from public.controles where id = cid;
  return jsonb_build_object(
    'user_id', v.user_id, 'nome', p.nome, 'aprovado', coalesce(p.status = 'aprovado', false),
    'controle_id', cid, 'controle_nome', cnome,
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'tipo', tipo))
                              from public.categorias where controle_id = cid and not oculta), '[]'::jsonb));
end $$;

-- liga o número à conta pelo código. Erros: 'invalido', 'bloqueado' (5 erros na última hora)
create or replace function public.bot_vincular(p_wa text, p_msg text, p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.whatsapp_codigos%rowtype; n int; cnome text;
begin
  select count(*) into n from public.whatsapp_msgs where wa_id = p_wa and not ok and criado_em > now() - interval '1 hour';
  if n >= 5 then return jsonb_build_object('erro', 'bloqueado'); end if;
  select * into c from public.whatsapp_codigos where codigo = p_codigo and expira > now();
  if c.user_id is null then
    update public.whatsapp_msgs set ok = false where id = p_msg;
    return jsonb_build_object('erro', 'invalido');
  end if;
  delete from public.whatsapp_vinculos where wa_id = p_wa or user_id = c.user_id;
  insert into public.whatsapp_vinculos (wa_id, user_id, controle_id) values (p_wa, c.user_id, c.controle_id);
  delete from public.whatsapp_codigos where user_id = c.user_id;
  select nome into cnome from public.controles where id = c.controle_id;
  return jsonb_build_object('ok', true, 'nome', (select nome from public.perfis where id = c.user_id), 'controle_nome', cnome);
end $$;

-- lança uma entrada ou saída
create or replace function public.bot_lancar(p_wa text, p_tipo text, p_desc text, p_cat text, p_valor numeric, p_data date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); nid uuid; uid uuid; cid uuid;
begin
  if ctx is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  if not (ctx->>'aprovado')::boolean then return jsonb_build_object('erro', 'nao_aprovado'); end if;
  uid := (ctx->>'user_id')::uuid; cid := (ctx->>'controle_id')::uuid;
  if cid is null then return jsonb_build_object('erro', 'sem_controle'); end if;
  if p_tipo not in ('exp', 'inc') or p_valor is null or p_valor <= 0 or p_valor > 9999999
     or p_data is null or abs(p_data - current_date) > 400 then
    return jsonb_build_object('erro', 'dados');
  end if;
  insert into public.lancamentos (user_id, tipo, descricao, categoria, valor, data, controle_id)
  values (uid, p_tipo, left(coalesce(nullif(btrim(p_desc), ''), p_cat), 200), left(p_cat, 60), round(p_valor, 2), p_data, cid)
  returning id into nid;
  update public.whatsapp_vinculos set ultimo_lanc = nid where wa_id = p_wa;
  return jsonb_build_object('id', nid, 'controle_nome', ctx->>'controle_nome');
end $$;

-- apaga o último lançamento feito pelo bot
create or replace function public.bot_desfazer(p_wa text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_vinculos%rowtype; l public.lancamentos%rowtype;
begin
  select * into v from public.whatsapp_vinculos where wa_id = p_wa;
  if v.wa_id is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  select * into l from public.lancamentos where id = v.ultimo_lanc and user_id = v.user_id;
  if l.id is null then return jsonb_build_object('erro', 'nada'); end if;
  delete from public.lancamentos where id = l.id;
  update public.whatsapp_vinculos set ultimo_lanc = null where wa_id = p_wa;
  return jsonb_build_object('descricao', l.descricao, 'valor', l.valor, 'tipo', l.tipo);
end $$;

-- resumo de um período: entradas, saídas e as categorias com mais gasto
create or replace function public.bot_resumo(p_wa text, p_de date, p_ate date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); cid uuid;
begin
  if ctx is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  if not (ctx->>'aprovado')::boolean then return jsonb_build_object('erro', 'nao_aprovado'); end if;
  cid := (ctx->>'controle_id')::uuid;
  return jsonb_build_object(
    'controle_nome', ctx->>'controle_nome',
    'saidas',   coalesce((select sum(valor) from public.lancamentos where controle_id = cid and tipo = 'exp' and data between p_de and p_ate), 0),
    'entradas', coalesce((select sum(valor) from public.lancamentos where controle_id = cid and tipo = 'inc' and data between p_de and p_ate), 0),
    'qtd',      (select count(*) from public.lancamentos where controle_id = cid and data between p_de and p_ate),
    'top', coalesce((select jsonb_agg(t) from (
              select categoria, sum(valor) as total from public.lancamentos
               where controle_id = cid and tipo = 'exp' and data between p_de and p_ate
               group by categoria order by 2 desc limit 3) t), '[]'::jsonb));
end $$;

do $$
declare f text;
begin
  foreach f in array array['whatsapp_gerar_codigo(uuid)', 'whatsapp_meu()', 'whatsapp_definir_controle(uuid)', 'whatsapp_desligar()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['bot_registrar_msg(text, text)', 'bot_contexto(text)', 'bot_vincular(text, text, text)',
                           'bot_lancar(text, text, text, text, numeric, date)', 'bot_desfazer(text)', 'bot_resumo(text, date, date)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;


-- =====================================================================
--  Pra Onde Foi? · BOT TAMBÉM NO TELEGRAM (teste no HMG)
--  Rodar depois do supabase-whatsapp.sql. Pode rodar de novo sem problema.
--  O mesmo vínculo serve para os dois: número do WhatsApp ou 'tg' + id do Telegram.
--  Cada conta fica ligada a UM canal por vez (ligar outro troca).
-- =====================================================================

alter table public.whatsapp_vinculos drop constraint if exists whatsapp_vinculos_wa_id_check;
alter table public.whatsapp_vinculos add constraint whatsapp_vinculos_wa_id_check check (wa_id ~ '^(tg)?[0-9]{5,20}$');

-- como está a ligação: canal, final do número (WhatsApp) e controle
drop function if exists public.whatsapp_meu();
create function public.whatsapp_meu()
returns table (canal text, final text, controle_id uuid, controle_nome text) language sql stable security definer set search_path = public as $$
  select case when v.wa_id like 'tg%' then 'telegram' else 'whatsapp' end,
         case when v.wa_id like 'tg%' then null else right(v.wa_id, 4) end,
         v.controle_id, c.nome
    from public.whatsapp_vinculos v left join public.controles c on c.id = v.controle_id
   where v.user_id = auth.uid();
$$;
revoke all on function public.whatsapp_meu() from public, anon;
grant execute on function public.whatsapp_meu() to authenticated;


-- =====================================================================
--  Pra Onde Foi? · BOT, PARTE 2 (teste no HMG)
--  Rodar depois do supabase-bot-telegram.sql. Pode rodar de novo sem problema.
--
--  1) O bot pergunta o que faltou ("Quanto foi a luz?") e lembra a resposta por 10 minutos
--  2) Cria conta a pagar ("conta de luz 180 vence dia 20")
--  3) Paga conta a pagar ("paguei a luz")
--  4) "desfazer" desfaz o último que o bot fez: lançamento, conta criada ou pagamento
-- =====================================================================

alter table public.whatsapp_vinculos add column if not exists pendente    jsonb;
alter table public.whatsapp_vinculos add column if not exists pendente_em timestamptz;
alter table public.whatsapp_vinculos add column if not exists ultimo_tipo text;
alter table public.whatsapp_vinculos add column if not exists ultimo_id   uuid;

-- quem é esse número (agora com o que ficou pendente e se o controle tem Contas a pagar)
create or replace function public.bot_contexto(p_wa text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.whatsapp_vinculos%rowtype; p public.perfis%rowtype; cid uuid; cnome text;
begin
  select * into v from public.whatsapp_vinculos where wa_id = p_wa;
  if v.wa_id is null then return null; end if;
  select * into p from public.perfis where id = v.user_id;
  cid := v.controle_id;
  if cid is null or not exists (select 1 from public.membros where controle_id = cid and user_id = v.user_id)
     or not public.modulo_ativo(cid, 'lanc') then
    select id into cid from public.controles where dono = v.user_id and pessoal;
  end if;
  select nome into cnome from public.controles where id = cid;
  return jsonb_build_object(
    'user_id', v.user_id, 'nome', p.nome, 'aprovado', coalesce(p.status = 'aprovado', false),
    'controle_id', cid, 'controle_nome', cnome, 'tem_contas', public.modulo_ativo(cid, 'contas'),
    'pendente', case when v.pendente_em > now() - interval '10 minutes' then v.pendente end,
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'tipo', tipo))
                              from public.categorias where controle_id = cid and not oculta), '[]'::jsonb));
end $$;

-- guarda (ou limpa, com null) a pergunta em aberto: {"texto": "...", "falta": "valor" | "dia"}
create or replace function public.bot_pendente(p_wa text, p_pendente jsonb)
returns void language sql security definer set search_path = public as $$
  update public.whatsapp_vinculos
     set pendente = p_pendente, pendente_em = case when p_pendente is null then null else now() end
   where wa_id = p_wa;
$$;

-- lança uma entrada ou saída (agora guardando o "último" para o desfazer)
create or replace function public.bot_lancar(p_wa text, p_tipo text, p_desc text, p_cat text, p_valor numeric, p_data date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); nid uuid; uid uuid; cid uuid;
begin
  if ctx is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  if not (ctx->>'aprovado')::boolean then return jsonb_build_object('erro', 'nao_aprovado'); end if;
  uid := (ctx->>'user_id')::uuid; cid := (ctx->>'controle_id')::uuid;
  if cid is null then return jsonb_build_object('erro', 'sem_controle'); end if;
  if p_tipo not in ('exp', 'inc') or p_valor is null or p_valor <= 0 or p_valor > 9999999
     or p_data is null or abs(p_data - current_date) > 400 then
    return jsonb_build_object('erro', 'dados');
  end if;
  insert into public.lancamentos (user_id, tipo, descricao, categoria, valor, data, controle_id)
  values (uid, p_tipo, left(coalesce(nullif(btrim(p_desc), ''), p_cat), 200), left(p_cat, 60), round(p_valor, 2), p_data, cid)
  returning id into nid;
  update public.whatsapp_vinculos set ultimo_lanc = nid, ultimo_tipo = 'lanc', ultimo_id = nid where wa_id = p_wa;
  return jsonb_build_object('id', nid, 'controle_nome', ctx->>'controle_nome');
end $$;

-- cria conta a pagar. Começa no mês do próximo vencimento (se o dia já passou, no mês que vem)
create or replace function public.bot_criar_conta(p_wa text, p_nome text, p_cat text, p_valor numeric, p_dia int, p_tipo text, p_parcelas int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); uid uuid; cid uuid; nid uuid; ini date;
        n text := left(btrim(coalesce(p_nome, '')), 60); cat text := left(btrim(coalesce(p_cat, '')), 60);
begin
  if ctx is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  if not (ctx->>'aprovado')::boolean then return jsonb_build_object('erro', 'nao_aprovado'); end if;
  uid := (ctx->>'user_id')::uuid; cid := (ctx->>'controle_id')::uuid;
  if not public.modulo_ativo(cid, 'contas') then return jsonb_build_object('erro', 'sem_contas'); end if;
  if char_length(n) < 1 or char_length(cat) < 1 or p_valor is null or p_valor <= 0 or p_valor > 9999999
     or p_dia is null or p_dia not between 1 and 31 or p_tipo not in ('fixa', 'unica', 'parcelada')
     or (p_tipo = 'parcelada' and (p_parcelas is null or p_parcelas not between 2 and 240)) then
    return jsonb_build_object('erro', 'dados');
  end if;
  ini := date_trunc('month', current_date)::date;
  if p_dia < extract(day from current_date) then ini := (ini + interval '1 month')::date; end if;
  insert into public.contas (controle_id, criado_por, nome, categoria, valor, dia, tipo, inicio, parcelas)
  values (cid, uid, n, cat, round(p_valor, 2), p_dia, p_tipo, ini, case when p_tipo = 'parcelada' then p_parcelas end)
  returning id into nid;
  update public.whatsapp_vinculos set ultimo_tipo = 'conta', ultimo_id = nid where wa_id = p_wa;
  return jsonb_build_object('id', nid, 'inicio', ini, 'controle_nome', ctx->>'controle_nome');
end $$;

-- contas a pagar em aberto (mês passado, este e o próximo), para o "paguei a luz"
create or replace function public.bot_contas_abertas(p_wa text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); cid uuid;
begin
  if ctx is null or not (ctx->>'aprovado')::boolean then return '[]'::jsonb; end if;
  cid := (ctx->>'controle_id')::uuid;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome, 'mes', x.mes, 'dia', x.dia, 'falta', x.falta) order by x.mes desc, x.nome)
      from (select c.id, c.nome, c.dia, m.mes,
                   coalesce((select valor from public.conta_meses where conta_id = c.id and mes = m.mes), c.valor)
                   - coalesce((select sum(valor) from public.pagamentos where conta_id = c.id and mes = m.mes), 0) as falta
              from public.contas c
             cross join (values (date_trunc('month', current_date)::date),
                                ((date_trunc('month', current_date) - interval '1 month')::date),
                                ((date_trunc('month', current_date) + interval '1 month')::date)) m(mes)
             where c.controle_id = cid and public.conta_ocorre(c.tipo, c.inicio, c.parcelas, c.fim, m.mes)) x
     where x.falta > 0), '[]'::jsonb);
end $$;

-- paga uma conta (mesma regra do app: cria a saída em Lançamentos e o pagamento)
create or replace function public.bot_pagar_conta(p_wa text, p_conta uuid, p_mes date, p_valor numeric, p_data date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); uid uuid; cid uuid; c public.contas%rowtype;
        m date := date_trunc('month', p_mes)::date; total numeric; pago numeric; falta numeric;
        v numeric := round(coalesce(p_valor, 0), 2); descr text; lid uuid; pid uuid;
begin
  if ctx is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  if not (ctx->>'aprovado')::boolean then return jsonb_build_object('erro', 'nao_aprovado'); end if;
  uid := (ctx->>'user_id')::uuid; cid := (ctx->>'controle_id')::uuid;
  select * into c from public.contas where id = p_conta and controle_id = cid for update;
  if c.id is null or not public.conta_ocorre(c.tipo, c.inicio, c.parcelas, c.fim, m) then return jsonb_build_object('erro', 'conta'); end if;
  if p_data is null or abs(p_data - current_date) > 400 then return jsonb_build_object('erro', 'dados'); end if;
  select coalesce((select valor from public.conta_meses where conta_id = c.id and mes = m), c.valor) into total;
  select coalesce(sum(valor), 0) into pago from public.pagamentos where conta_id = c.id and mes = m;
  falta := total - pago;
  if falta <= 0 then return jsonb_build_object('erro', 'ja_paga'); end if;
  if v <= 0 then v := falta; end if;
  if v > falta then return jsonb_build_object('erro', 'maior', 'falta', falta); end if;
  descr := c.nome || case when c.tipo = 'parcelada'
             then ' ' || ((extract(year from age(m, c.inicio)) * 12 + extract(month from age(m, c.inicio)))::int + 1) || '/' || c.parcelas
             else '' end;
  insert into public.lancamentos (user_id, controle_id, tipo, descricao, categoria, valor, data)
  values (uid, c.controle_id, 'exp', descr, c.categoria, v, p_data) returning id into lid;
  insert into public.pagamentos (conta_id, controle_id, mes, user_id, valor, data, lancamento_id)
  values (c.id, c.controle_id, m, uid, v, p_data, lid) returning id into pid;
  update public.whatsapp_vinculos set ultimo_lanc = null, ultimo_tipo = 'pag', ultimo_id = pid where wa_id = p_wa;
  return jsonb_build_object('nome', descr, 'valor', v, 'mes', m, 'falta', falta - v);
end $$;

-- desfaz o último que o bot fez
create or replace function public.bot_desfazer(p_wa text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_vinculos%rowtype; l public.lancamentos%rowtype; k public.contas%rowtype; pg public.pagamentos%rowtype;
        tipo text; idd uuid;
begin
  select * into v from public.whatsapp_vinculos where wa_id = p_wa;
  if v.wa_id is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  tipo := coalesce(v.ultimo_tipo, case when v.ultimo_lanc is not null then 'lanc' end);
  idd := coalesce(v.ultimo_id, v.ultimo_lanc);
  if tipo = 'lanc' then
    select * into l from public.lancamentos where id = idd and user_id = v.user_id;
    if l.id is null then return jsonb_build_object('erro', 'nada'); end if;
    delete from public.lancamentos where id = l.id;
    update public.whatsapp_vinculos set ultimo_lanc = null, ultimo_tipo = null, ultimo_id = null where wa_id = p_wa;
    return jsonb_build_object('tipo', 'lanc', 'descricao', l.descricao, 'valor', l.valor);
  elsif tipo = 'conta' then
    select * into k from public.contas where id = idd and criado_por = v.user_id;
    if k.id is null then return jsonb_build_object('erro', 'nada'); end if;
    if exists (select 1 from public.pagamentos where conta_id = k.id) then return jsonb_build_object('erro', 'conta_com_pagamento'); end if;
    delete from public.contas where id = k.id;
    update public.whatsapp_vinculos set ultimo_tipo = null, ultimo_id = null where wa_id = p_wa;
    return jsonb_build_object('tipo', 'conta', 'descricao', k.nome, 'valor', k.valor);
  elsif tipo = 'pag' then
    select * into pg from public.pagamentos where id = idd and user_id = v.user_id;
    if pg.id is null then return jsonb_build_object('erro', 'nada'); end if;
    select * into k from public.contas where id = pg.conta_id;
    if pg.lancamento_id is not null then delete from public.lancamentos where id = pg.lancamento_id;   -- leva o pagamento junto
    else delete from public.pagamentos where id = pg.id; end if;
    update public.whatsapp_vinculos set ultimo_tipo = null, ultimo_id = null where wa_id = p_wa;
    return jsonb_build_object('tipo', 'pag', 'descricao', k.nome, 'valor', pg.valor);
  end if;
  return jsonb_build_object('erro', 'nada');
end $$;

do $$
declare f text;
begin
  foreach f in array array['bot_contexto(text)', 'bot_pendente(text, jsonb)', 'bot_lancar(text, text, text, text, numeric, date)',
                           'bot_criar_conta(text, text, text, numeric, int, text, int)', 'bot_contas_abertas(text)',
                           'bot_pagar_conta(text, uuid, date, numeric, date)', 'bot_desfazer(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;


-- =====================================================================
--  Pra Onde Foi? · BOT, PARTE 3 (teste no HMG)
--  Rodar depois do supabase-bot2.sql. Pode rodar de novo sem problema.
--
--  1) Editar pelo chat: "o último era 45", "era farmácia", "mudar valor da luz para 210",
--     "renomear a conta X para água", "mudar vencimento da luz para dia 15"
--  2) Aprender: quando a pessoa corrige a categoria, o bot lembra (só para ela)
--  3) Frases que o bot não entendeu ou que a pessoa desfez/corrigiu ficam guardadas 30 dias
--     (só quando a função estiver com BOT_APRENDER=1; usar só no HMG)
-- =====================================================================

alter table public.whatsapp_vinculos add column if not exists ultimo_texto text;

-- dicionário de cada pessoa: palavra → categoria
create table if not exists public.bot_dicionario (
  user_id   uuid not null references auth.users(id) on delete cascade,
  termo     text not null check (char_length(termo) between 2 and 60),
  tipo      text not null check (tipo in ('exp', 'inc')),
  categoria text not null check (char_length(categoria) between 1 and 60),
  criado_em timestamptz not null default now(),
  primary key (user_id, termo, tipo)
);
alter table public.bot_dicionario enable row level security;
drop policy if exists bot_dic_ver on public.bot_dicionario;
create policy bot_dic_ver on public.bot_dicionario for select to authenticated using (user_id = auth.uid());
drop policy if exists bot_dic_apagar on public.bot_dicionario;
create policy bot_dic_apagar on public.bot_dicionario for delete to authenticated using (user_id = auth.uid());
revoke all on public.bot_dicionario from anon, authenticated;
grant select, delete on public.bot_dicionario to authenticated;

-- frases para melhorar o bot (apagadas depois de 30 dias)
create table if not exists public.bot_frases (
  id        bigint generated always as identity primary key,
  user_id   uuid references auth.users(id) on delete cascade,
  texto     text not null,
  motivo    text not null check (motivo in ('nao_entendi', 'desfeito', 'corrigido', 'recusado')),
  criado_em timestamptz not null default now()
);
alter table public.bot_frases enable row level security;   -- ninguém lê pelo app; você olha pelo SQL
revoke all on public.bot_frases from anon, authenticated;

-- quem é esse número (agora com o dicionário da pessoa)
create or replace function public.bot_contexto(p_wa text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.whatsapp_vinculos%rowtype; p public.perfis%rowtype; cid uuid; cnome text;
begin
  select * into v from public.whatsapp_vinculos where wa_id = p_wa;
  if v.wa_id is null then return null; end if;
  select * into p from public.perfis where id = v.user_id;
  cid := v.controle_id;
  if cid is null or not exists (select 1 from public.membros where controle_id = cid and user_id = v.user_id)
     or not public.modulo_ativo(cid, 'lanc') then
    select id into cid from public.controles where dono = v.user_id and pessoal;
  end if;
  select nome into cnome from public.controles where id = cid;
  return jsonb_build_object(
    'user_id', v.user_id, 'nome', p.nome, 'aprovado', coalesce(p.status = 'aprovado', false),
    'controle_id', cid, 'controle_nome', cnome, 'tem_contas', public.modulo_ativo(cid, 'contas'),
    'pendente', case when v.pendente_em > now() - interval '10 minutes' then v.pendente end,
    'ultimo_tipo', v.ultimo_tipo, 'ultimo_texto', v.ultimo_texto,
    'categorias', coalesce((select jsonb_agg(jsonb_build_object('nome', nome, 'tipo', tipo))
                              from public.categorias where controle_id = cid and not oculta), '[]'::jsonb),
    'dicionario', coalesce((select jsonb_agg(jsonb_build_object('termo', termo, 'tipo', tipo, 'categoria', categoria))
                              from (select * from public.bot_dicionario where user_id = v.user_id order by criado_em desc limit 300) d), '[]'::jsonb));
end $$;

-- guarda o texto da última coisa que o bot fez (para registrar se a pessoa desfizer/corrigir)
create or replace function public.bot_guardar_texto(p_wa text, p_texto text)
returns void language sql security definer set search_path = public as $$
  update public.whatsapp_vinculos set ultimo_texto = left(p_texto, 500) where wa_id = p_wa;
$$;

-- registra uma frase para melhorar o bot
create or replace function public.bot_anotar(p_wa text, p_texto text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_texto is null or btrim(p_texto) = '' then return; end if;
  insert into public.bot_frases (user_id, texto, motivo)
  values ((select user_id from public.whatsapp_vinculos where wa_id = p_wa), left(p_texto, 500), p_motivo);
  delete from public.bot_frases where criado_em < now() - interval '30 days';
end $$;

-- aprende: "drogaria ze" → Saúde (só para esta pessoa)
create or replace function public.bot_aprender(p_wa text, p_termo text, p_tipo text, p_cat text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := (select user_id from public.whatsapp_vinculos where wa_id = p_wa);
        t text := left(btrim(lower(coalesce(p_termo, ''))), 60);
begin
  if uid is null or char_length(t) < 2 or p_tipo not in ('exp', 'inc') or coalesce(btrim(p_cat), '') = '' then return; end if;
  insert into public.bot_dicionario (user_id, termo, tipo, categoria) values (uid, t, p_tipo, left(btrim(p_cat), 60))
  on conflict (user_id, termo, tipo) do update set categoria = excluded.categoria, criado_em = now();
end $$;

-- corrige o último lançamento feito pelo bot (o que vier null fica como está)
create or replace function public.bot_editar_ultimo(p_wa text, p_valor numeric, p_desc text, p_cat text, p_data date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_vinculos%rowtype; l public.lancamentos%rowtype; antes text;
begin
  select * into v from public.whatsapp_vinculos where wa_id = p_wa;
  if v.wa_id is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  if coalesce(v.ultimo_tipo, 'lanc') <> 'lanc' then return jsonb_build_object('erro', 'nao_e_lanc', 'ultimo', v.ultimo_tipo); end if;
  select * into l from public.lancamentos where id = coalesce(v.ultimo_id, v.ultimo_lanc) and user_id = v.user_id;
  if l.id is null then return jsonb_build_object('erro', 'nada'); end if;
  if p_valor is not null and (p_valor <= 0 or p_valor > 9999999) then return jsonb_build_object('erro', 'dados'); end if;
  if p_data is not null and abs(p_data - current_date) > 400 then return jsonb_build_object('erro', 'dados'); end if;
  antes := l.descricao;
  update public.lancamentos
     set valor = coalesce(round(p_valor, 2), valor),
         descricao = coalesce(left(nullif(btrim(p_desc), ''), 200), descricao),
         categoria = coalesce(left(nullif(btrim(p_cat), ''), 60), categoria),
         data = coalesce(p_data, data)
   where id = l.id returning * into l;
  return jsonb_build_object('tipo', l.tipo, 'descricao', l.descricao, 'categoria', l.categoria, 'valor', l.valor, 'data', l.data,
                            'antes_desc', antes);
end $$;

-- contas a pagar ativas do controle (para renomear / mudar valor / vencimento)
create or replace function public.bot_contas_ativas(p_wa text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); cid uuid;
begin
  if ctx is null or not (ctx->>'aprovado')::boolean then return '[]'::jsonb; end if;
  cid := (ctx->>'controle_id')::uuid;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'valor', valor, 'dia', dia, 'mes', inicio, 'falta', valor) order by nome)
                     from public.contas
                    where controle_id = cid
                      and (fim is null or fim >= date_trunc('month', current_date))
                      and (tipo <> 'unica' or inicio >= (date_trunc('month', current_date) - interval '1 month'))
                      and (tipo <> 'parcelada' or (inicio + make_interval(months => parcelas)) > date_trunc('month', current_date))), '[]'::jsonb);
end $$;

-- edita uma conta a pagar (só quem criou, igual no app)
create or replace function public.bot_editar_conta(p_wa text, p_conta uuid, p_nome text, p_valor numeric, p_dia int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ctx jsonb := public.bot_contexto(p_wa); uid uuid; cid uuid; k public.contas%rowtype;
begin
  if ctx is null then return jsonb_build_object('erro', 'sem_vinculo'); end if;
  if not (ctx->>'aprovado')::boolean then return jsonb_build_object('erro', 'nao_aprovado'); end if;
  uid := (ctx->>'user_id')::uuid; cid := (ctx->>'controle_id')::uuid;
  select * into k from public.contas where id = p_conta and controle_id = cid;
  if k.id is null then return jsonb_build_object('erro', 'conta'); end if;
  if k.criado_por is distinct from uid then return jsonb_build_object('erro', 'nao_e_sua'); end if;
  if p_nome is not null and char_length(btrim(p_nome)) not between 1 and 60 then return jsonb_build_object('erro', 'dados'); end if;
  if p_valor is not null and (p_valor <= 0 or p_valor > 9999999) then return jsonb_build_object('erro', 'dados'); end if;
  if p_dia is not null and p_dia not between 1 and 31 then return jsonb_build_object('erro', 'dados'); end if;
  update public.contas set nome = coalesce(btrim(p_nome), nome), valor = coalesce(round(p_valor, 2), valor), dia = coalesce(p_dia, dia)
   where id = k.id returning * into k;
  return jsonb_build_object('nome', k.nome, 'valor', k.valor, 'dia', k.dia);
end $$;

do $$
declare f text;
begin
  foreach f in array array['bot_contexto(text)', 'bot_guardar_texto(text, text)', 'bot_anotar(text, text, text)',
                           'bot_aprender(text, text, text, text)', 'bot_editar_ultimo(text, numeric, text, text, date)',
                           'bot_contas_ativas(text)', 'bot_editar_conta(text, uuid, text, numeric, int)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;

-- PARA VER AS FRASES (rode quando quiser e me mande o resultado):
--   select criado_em, motivo, texto from public.bot_frases order by criado_em desc limit 100;


-- =====================================================================
--  Pra Onde Foi? · BOT, PARTE 4 · DETETIVE GRANA (teste no HMG)
--  Rodar depois do supabase-bot3.sql. Pode rodar de novo sem problema.
--
--  Ligar o WhatsApp com um toque: a pessoa digita o celular no app (opcional),
--  toca em "Abrir conversa" e só envia a mensagem pronta. O bot confere se quem
--  mandou é o MESMO número digitado + o código escondido na mensagem.
--  Nada é pago: é a pessoa que começa a conversa.
-- =====================================================================

alter table public.whatsapp_codigos add column if not exists telefone text;

-- guarda o celular esperado no código que está valendo (só dígitos, com 55)
create or replace function public.whatsapp_definir_telefone(p_tel text)
returns text language plpgsql security definer set search_path = public as $$
declare t text := regexp_replace(coalesce(p_tel, ''), '\D', '', 'g');
begin
  perform public.exigir_aprovado();
  if char_length(t) in (10, 11) then t := '55' || t; end if;
  if t !~ '^55[1-9][0-9][0-9]{8,9}$' then raise exception 'Celular inválido. Use DDD + número, tipo (65) 99999-9999.'; end if;
  update public.whatsapp_codigos set telefone = t where user_id = auth.uid() and expira > now();
  if not found then raise exception 'O código venceu. Feche e abra de novo.'; end if;
  return t;
end $$;
revoke all on function public.whatsapp_definir_telefone(text) from public, anon;
grant execute on function public.whatsapp_definir_telefone(text) to authenticated;

-- mesmo celular? (o WhatsApp às vezes manda sem o 9 da frente: compara DDD + 8 últimos)
create or replace function public.mesmo_celular(a text, b text)
returns boolean language sql immutable as $$
  select substr(a, 3, 2) = substr(b, 3, 2) and right(a, 8) = right(b, 8);
$$;

-- liga o número à conta pelo código. Erros: 'invalido', 'bloqueado', 'outro_numero'
create or replace function public.bot_vincular(p_wa text, p_msg text, p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.whatsapp_codigos%rowtype; n int; cnome text;
begin
  select count(*) into n from public.whatsapp_msgs where wa_id = p_wa and not ok and criado_em > now() - interval '1 hour';
  if n >= 5 then return jsonb_build_object('erro', 'bloqueado'); end if;
  select * into c from public.whatsapp_codigos where codigo = p_codigo and expira > now();
  if c.user_id is null then
    update public.whatsapp_msgs set ok = false where id = p_msg;
    return jsonb_build_object('erro', 'invalido');
  end if;
  -- código pedido para um celular: só esse celular pode usar
  if c.telefone is not null and p_wa not like 'tg%' and not public.mesmo_celular(c.telefone, p_wa) then
    update public.whatsapp_msgs set ok = false where id = p_msg;
    return jsonb_build_object('erro', 'outro_numero');
  end if;
  delete from public.whatsapp_vinculos where wa_id = p_wa or user_id = c.user_id;
  insert into public.whatsapp_vinculos (wa_id, user_id, controle_id) values (p_wa, c.user_id, c.controle_id);
  delete from public.whatsapp_codigos where user_id = c.user_id;
  select nome into cnome from public.controles where id = c.controle_id;
  return jsonb_build_object('ok', true, 'nome', (select nome from public.perfis where id = c.user_id), 'controle_nome', cnome);
end $$;
revoke all on function public.bot_vincular(text, text, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.bot_vincular(text, text, text) to service_role;
  end if;
end $$;


-- =====================================================================
--  Pra Onde Foi? · CONTAS FUNDADORAS
--  Pode rodar de novo sem problema. Não apaga nem altera nada do que já existe.
--
--  "Fundador" = quem ajudou desde o teste. Fica marcado para, quando houver
--  mensalidade, essas contas não pagarem. Só o administrador marca ou desmarca.
-- =====================================================================

alter table public.perfis add column if not exists fundador    boolean not null default false;
alter table public.perfis add column if not exists fundador_em timestamptz;

-- lista de contas do painel (agora com "fundador")
drop function if exists public.admin_listar();
create function public.admin_listar()
returns table (id uuid, email text, status text, is_admin boolean, criado_em timestamptz, nome text, fundador boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  return query select p.id, p.email, p.status, p.is_admin, p.criado_em, p.nome, p.fundador
                 from public.perfis p order by p.criado_em desc;
end $$;

-- marca ou desmarca uma conta como fundadora
create or replace function public.admin_definir_fundador(alvo uuid, sim boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  update public.perfis set fundador = coalesce(sim, false), fundador_em = case when sim then now() end where id = alvo;
  if not found then raise exception 'Conta não encontrada.'; end if;
end $$;

-- marca de uma vez todas as contas aprovadas de hoje como fundadoras (devolve quantas)
create or replace function public.admin_marcar_fundadores()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.eh_admin() then raise exception 'Apenas administradores.'; end if;
  update public.perfis set fundador = true, fundador_em = now()
   where status = 'aprovado' and not is_admin and not fundador;
  get diagnostics n = row_count;
  return n;
end $$;

-- a própria pessoa pode saber se é fundadora (para mostrar no app)
create or replace function public.sou_fundador()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select fundador from public.perfis where id = auth.uid()), false);
$$;

revoke all on function public.admin_listar() from public, anon;
revoke all on function public.admin_definir_fundador(uuid, boolean) from public, anon;
revoke all on function public.admin_marcar_fundadores() from public, anon;
revoke all on function public.sou_fundador() from public, anon;
grant execute on function public.admin_listar() to authenticated;
grant execute on function public.admin_definir_fundador(uuid, boolean) to authenticated;
grant execute on function public.admin_marcar_fundadores() to authenticated;
grant execute on function public.sou_fundador() to authenticated;

-- ===== 25 · supabase-despertador.sql =====
-- =====================================================================
--  Pra Onde Foi? · DESPERTADOR
--  Rodar no HMG e no PROD (uma vez em cada). Pode rodar de novo sem problema.
--
--  O Supabase grátis pausa o projeto depois de 7 dias sem uso. Um robô do
--  GitHub chama esta função uma vez por dia para contar como uso.
--  Ela não lê nem grava nenhum dado: só responde "ok".
-- =====================================================================

create or replace function public.despertar()
returns text language sql stable set search_path = public as $$
  select 'ok'::text;
$$;
revoke all on function public.despertar() from public;
grant execute on function public.despertar() to anon, authenticated;

-- ===== 26 · supabase-tema.sql =====
-- =====================================================================
--  Pra Onde Foi? · TEMA SALVO NO PERFIL
--  Rodar no HMG (e no prod quando for pra lá). Pode rodar de novo sem problema.
--
--  O tema claro/escuro fica guardado na conta: escolheu escuro no computador,
--  o celular também abre escuro.
-- =====================================================================

alter table public.perfis add column if not exists tema text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'perfis_tema_ok') then
    alter table public.perfis add constraint perfis_tema_ok check (tema is null or tema in ('claro', 'escuro'));
  end if;
end $$;

-- a pessoa guarda o próprio tema
create or replace function public.definir_tema(p_tema text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if p_tema not in ('claro', 'escuro') then raise exception 'Tema inválido.'; end if;
  update public.perfis set tema = p_tema where id = auth.uid();
end $$;

-- a pessoa lê o próprio tema
create or replace function public.meu_tema()
returns text language sql stable security definer set search_path = public as $$
  select tema from public.perfis where id = auth.uid();
$$;

revoke all on function public.definir_tema(text) from public, anon;
revoke all on function public.meu_tema() from public, anon;
grant execute on function public.definir_tema(text) to authenticated;
grant execute on function public.meu_tema() to authenticated;

-- ===== 27 · supabase-bot5.sql =====
-- =====================================================================
--  Pra Onde Foi? · BOT, PARTE 5 · SALDO MENSAL DO WHATSAPP
--  Rodar depois do supabase-bot4.sql. Pode rodar de novo sem problema.
--
--  Cada resposta do bot no WhatsApp custa (Meta). Cada pessoa tem um saldo de
--  300 respostas por mês: acumula dentro do mês e zera na virada.
--  Aos 80% o bot avisa; quando acaba, avisa uma vez e fica em silêncio até o
--  mês virar. O Telegram e o app não têm limite.
-- =====================================================================

create table if not exists public.bot_uso (
  user_id    uuid not null references auth.users(id) on delete cascade,
  mes        date not null,
  respostas  int  not null default 0,
  avisou_80  boolean not null default false,
  avisou_fim boolean not null default false,
  primary key (user_id, mes)
);
alter table public.bot_uso enable row level security;   -- só pelas funções abaixo
revoke all on public.bot_uso from anon, authenticated;

-- tamanho do saldo (mude aqui se quiser outro número)
create or replace function public.bot_limite_mes()
returns int language sql immutable as $$ select 300 $$;

-- mês atual no horário de Brasília
create or replace function public.bot_mes_atual()
returns date language sql stable as $$ select date_trunc('month', now() at time zone 'America/Sao_Paulo')::date $$;

-- como está o saldo de quem mandou (null = número ainda não ligado a uma conta)
create or replace function public.bot_saldo(p_wa text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid; u public.bot_uso%rowtype;
begin
  select user_id into uid from public.whatsapp_vinculos where wa_id = p_wa;
  if uid is null then return null; end if;
  select * into u from public.bot_uso where user_id = uid and mes = public.bot_mes_atual();
  return jsonb_build_object('usadas', coalesce(u.respostas, 0), 'limite', public.bot_limite_mes(),
                            'esgotado', coalesce(u.respostas, 0) >= public.bot_limite_mes(),
                            'avisou_fim', coalesce(u.avisou_fim, false));
end $$;

-- conta 1 resposta enviada; diz se é hora do aviso de 80%
create or replace function public.bot_contar_resposta(p_wa text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid; u public.bot_uso%rowtype; lim int := public.bot_limite_mes(); aviso boolean := false;
begin
  select user_id into uid from public.whatsapp_vinculos where wa_id = p_wa;
  if uid is null then return null; end if;
  insert into public.bot_uso (user_id, mes, respostas) values (uid, public.bot_mes_atual(), 1)
  on conflict (user_id, mes) do update set respostas = public.bot_uso.respostas + 1
  returning * into u;
  if not u.avisou_80 and u.respostas >= ceil(lim * 0.8) then
    update public.bot_uso set avisou_80 = true where user_id = uid and mes = u.mes;
    aviso := true;
  end if;
  return jsonb_build_object('usadas', u.respostas, 'limite', lim, 'restam', greatest(lim - u.respostas, 0), 'aviso80', aviso);
end $$;

-- marca que o aviso de "saldo acabou" já foi mandado este mês
create or replace function public.bot_marcar_fim(p_wa text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  select user_id into uid from public.whatsapp_vinculos where wa_id = p_wa;
  if uid is null then return; end if;
  insert into public.bot_uso (user_id, mes, respostas, avisou_fim) values (uid, public.bot_mes_atual(), 0, true)
  on conflict (user_id, mes) do update set avisou_fim = true;
end $$;

-- para o app: quanto a pessoa já usou este mês
create or replace function public.bot_meu_saldo()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('usadas', coalesce((select respostas from public.bot_uso where user_id = auth.uid() and mes = public.bot_mes_atual()), 0),
                            'limite', public.bot_limite_mes());
$$;

revoke all on function public.bot_meu_saldo() from public, anon;
grant execute on function public.bot_meu_saldo() to authenticated;
do $$
declare f text;
begin
  foreach f in array array['bot_saldo(text)', 'bot_contar_resposta(text)', 'bot_marcar_fim(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function public.%s to service_role', f);
    end if;
  end loop;
end $$;
