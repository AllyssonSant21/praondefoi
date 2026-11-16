-- =====================================================================
--  Pra Onde Foi? · AVISO DE ACESSO POR UM APARELHO NOVO
--  Rodar depois do supabase-setup.sql. Pode rodar de novo.
--
--  Cada navegador/celular que entra na conta ganha um código guardado só
--  nele. Quando a conta é acessada por um aparelho que ainda não conhecia
--  (e não é o primeiro da pessoa), a função "aviso-login" manda um e-mail:
--  "Novo acesso à sua conta". Nada de IP, cidade ou localização é guardado:
--  só o nome do aparelho (ex.: "Chrome no Windows") e as datas.
-- =====================================================================

create table if not exists public.aparelhos (
  user_id     uuid not null references auth.users(id) on delete cascade,
  aparelho_id text not null check (aparelho_id ~ '^[A-Za-z0-9-]{16,64}$'),
  nome        text not null default 'Aparelho' check (char_length(nome) <= 60),
  criado_em   timestamptz not null default now(),
  ultimo_em   timestamptz not null default now(),
  avisar      boolean not null default false,   -- novo e ainda não avisado por e-mail
  avisado_em  timestamptz,
  primary key (user_id, aparelho_id)
);
alter table public.aparelhos enable row level security;
drop policy if exists aparelhos_ler on public.aparelhos;
create policy aparelhos_ler on public.aparelhos for select to authenticated using (user_id = auth.uid());
revoke all on public.aparelhos from anon;
revoke insert, update, delete on public.aparelhos from authenticated;
grant select on public.aparelhos to authenticated;

-- o app chama ao abrir: registra o aparelho e diz se precisa avisar por e-mail
create or replace function public.registrar_aparelho(p_id text, p_nome text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ja boolean; outros int; nome_ok text;
begin
  if uid is null then raise exception 'Entre na sua conta.'; end if;
  if p_id is null or p_id !~ '^[A-Za-z0-9-]{16,64}$' then raise exception 'Aparelho inválido.'; end if;
  nome_ok := left(coalesce(nullif(btrim(regexp_replace(p_nome, '[^[:alnum:] .()/-]', '', 'g')), ''), 'Aparelho'), 60);
  select true into ja from public.aparelhos where user_id = uid and aparelho_id = p_id;
  if ja then
    update public.aparelhos set ultimo_em = now(), nome = nome_ok where user_id = uid and aparelho_id = p_id;
    return jsonb_build_object('novo', false, 'avisar', false);
  end if;
  select count(*) into outros from public.aparelhos where user_id = uid;
  -- muitos aparelhos: guarda só os 20 mais recentes
  delete from public.aparelhos where user_id = uid and aparelho_id in (
    select aparelho_id from public.aparelhos where user_id = uid order by ultimo_em desc offset 19);
  -- o primeiro aparelho (logo depois de criar a conta) não gera aviso
  insert into public.aparelhos (user_id, aparelho_id, nome, avisar) values (uid, p_id, nome_ok, outros > 0);
  return jsonb_build_object('novo', true, 'avisar', outros > 0);
end $$;

-- só a função aviso-login (chave de serviço) usa: pega os dados do aviso e marca como enviado
create or replace function public.aparelho_aviso(p_uid uuid, p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.aparelhos%rowtype; em text; nm text;
begin
  update public.aparelhos set avisar = false, avisado_em = now()
   where user_id = p_uid and aparelho_id = p_id and avisar and criado_em > now() - interval '30 minutes'
  returning * into a;
  if a.user_id is null then return null; end if;
  select coalesce(nullif(p.email_aviso, ''), u.email), p.nome into em, nm
    from auth.users u left join public.perfis p on p.id = u.id where u.id = p_uid;
  if em is null or em !~ '@' or em like '%@usuarios.local' then return null; end if;
  return jsonb_build_object('email', em, 'nome', nm, 'aparelho', a.nome,
    'quando', to_char(a.criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI'));
end $$;

do $$ begin
  revoke all on function public.registrar_aparelho(text, text) from public, anon;
  grant execute on function public.registrar_aparelho(text, text) to authenticated;
  revoke all on function public.aparelho_aviso(uuid, text) from public, anon, authenticated;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.aparelho_aviso(uuid, text) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
