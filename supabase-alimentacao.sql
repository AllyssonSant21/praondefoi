-- =====================================================================
--  Pra Onde Foi? · CATEGORIA PADRÃO "ALIMENTAÇÃO"
--  Pode rodar no HMG e no prod, e pode rodar de novo.
--
--  O app agora tem a categoria padrão "Alimentação" (🍽️).
--  Quem já tinha criado uma categoria própria com esse nome
--  ("alimentação", "Alimentacao"...) ficaria com duas iguais na lista.
--  Este script passa tudo dessas categorias para a padrão e apaga as repetidas.
-- =====================================================================

begin;

-- nomes que contam como a mesma coisa (sem diferença de maiúscula, acento ou espaço)
create or replace function pg_temp.eh_alimentacao(t text) returns boolean language sql immutable as $$
  -- normalize: o mesmo "ç" pode vir gravado de dois jeitos diferentes (um caractere só, ou c + cedilha)
  select translate(lower(normalize(btrim(coalesce(t, '')), NFD)), U&'\0327\0303', '') in ('alimentacao')
$$;

update public.lancamentos     set categoria = 'Alimentação' where pg_temp.eh_alimentacao(categoria) and categoria <> 'Alimentação';
update public.compras_cartao  set categoria = 'Alimentação' where pg_temp.eh_alimentacao(categoria) and categoria <> 'Alimentação';
update public.contas          set categoria = 'Alimentação' where pg_temp.eh_alimentacao(categoria) and categoria <> 'Alimentação';
-- o dicionário do bot só existe onde o Detetive já foi instalado
do $$ begin
  if to_regclass('public.bot_dicionario') is not null then
    update public.bot_dicionario set categoria = 'Alimentação' where pg_temp.eh_alimentacao(categoria) and categoria <> 'Alimentação';
  end if;
end $$;

-- a categoria própria some: a padrão já aparece para todo mundo
delete from public.categorias where pg_temp.eh_alimentacao(nome) and tipo <> 'inc';

commit;

-- conferência: as duas linhas devem dar 0
select count(*) as categorias_repetidas from public.categorias where translate(lower(normalize(btrim(nome), NFD)), U&'\0327\0303', '') = 'alimentacao' and tipo <> 'inc';
select count(*) as lancamentos_com_nome_antigo from public.lancamentos where translate(lower(normalize(btrim(categoria), NFD)), U&'\0327\0303', '') = 'alimentacao' and categoria <> 'Alimentação';
