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
