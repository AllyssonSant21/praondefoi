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
