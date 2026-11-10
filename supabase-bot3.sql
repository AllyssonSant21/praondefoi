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
