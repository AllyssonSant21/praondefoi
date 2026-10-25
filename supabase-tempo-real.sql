-- Pra Onde Foi? · ATUALIZAÇÃO EM TEMPO REAL
-- Liga o "Realtime" nas tabelas usadas pelos controles compartilhados.
-- Pode rodar mais de uma vez sem problema.
do $$
declare t text;
begin
  foreach t in array array['lancamentos','membros','convites'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
