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
