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
