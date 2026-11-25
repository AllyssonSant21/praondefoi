-- 40. Limites nos lançamentos (valor e data)
-- O app grava os lançamentos direto na tabela, então quem chamasse a API sem o app conseguia lançar
-- R$ 1 bilhão ou com data no ano 3000. Só afetava os próprios dados, mas num controle compartilhado
-- bagunçava a tela de todo mundo. Agora o banco recusa:
--   · valor acima de R$ 9.999.999,99 (o mesmo limite das compras no cartão e das contas);
--   · data antes de 1990 ou mais de 5 anos à frente.
-- Os lançamentos que já existem não são mexidos. Rodar no HMG e no prod. Pode rodar de novo sem problema.

-- valor: vale para tudo que for gravado ou alterado daqui pra frente
alter table public.lancamentos drop constraint if exists lancamentos_valor_max;
alter table public.lancamentos add constraint lancamentos_valor_max check (valor <= 9999999.99) not valid;

-- data: o "hoje" muda todo dia, então fica num gatilho (uma regra fixa não pode usar a data de hoje)
create or replace function public.lanc_data_ok() returns trigger language plpgsql set search_path = public as $$
begin
  if new.data < date '1990-01-01' or new.data > current_date + interval '5 years' then
    raise exception 'Data fora do permitido (de 1990 até 5 anos à frente).' using errcode = '22008';
  end if;
  return new;
end $$;
revoke all on function public.lanc_data_ok() from public, anon, authenticated;
drop trigger if exists lanc_data_ok on public.lancamentos;
create trigger lanc_data_ok before insert or update of data on public.lancamentos
  for each row execute function public.lanc_data_ok();

notify pgrst, 'reload schema';
