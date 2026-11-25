-- 39. Banco no horário de Brasília
-- O Supabase vem no horário de Londres (UTC). Das 21h à meia-noite de Brasília o banco já achava que era
-- "amanhã": conta criada pelo bot no próprio dia do vencimento começava só no mês seguinte, dívida quitada
-- às 22h do dia 30 ficava com data do dia 1º, compra antiga lançada à noite no dia do vencimento do cartão
-- contava uma parcela paga a mais, e o histórico da dívida ficava com a data do dia seguinte.
-- Com isto, "hoje" (current_date) no banco passa a ser o hoje de Brasília. Os horários gravados não mudam
-- (continuam o mesmo instante); só a forma de mostrar e o "que dia é hoje".
-- Os agendamentos (pg_cron) não mudam: eles têm o fuso próprio.
-- Rodar no HMG e no prod. Pode rodar de novo sem problema.

alter database postgres set timezone to 'America/Sao_Paulo';

-- vale para as conexões novas: a API do app troca as conexões sozinha em até ~30 minutos
notify pgrst, 'reload config';

-- conferir (numa aba nova do SQL Editor): deve mostrar America/Sao_Paulo
-- show timezone;
