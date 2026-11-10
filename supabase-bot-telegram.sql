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
