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
