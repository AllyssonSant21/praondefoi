-- 38. Ponte entre a conta pessoal do dono e a conta master (painel do administrador)
-- A conta master guarda qual é a conta pessoal do dono. Com isso, o botão "Painel do administrador"
-- aparece na conta pessoal em qualquer aparelho, sem precisar sair de uma conta e entrar na outra.
-- O painel continua protegido: abrir o painel ainda usa a sessão (e a senha) da conta master.
-- Pode rodar de novo sem problema.

alter table public.perfis add column if not exists conta_pessoal uuid references auth.users(id) on delete set null;

-- só a conta master chama: liga (ou desliga, com null) a conta pessoal do dono
create or replace function public.admin_ligar_conta_pessoal(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.perfis where id = auth.uid() and is_admin) then
    raise exception 'Só a conta do administrador pode fazer isso.';
  end if;
  if p_user is not null and not exists (select 1 from public.perfis where id = p_user and not is_admin) then
    raise exception 'Conta pessoal não encontrada.';
  end if;
  update public.perfis set conta_pessoal = p_user where id = auth.uid() and conta_pessoal is distinct from p_user;
end;
$$;

-- qualquer conta pergunta: "eu sou a conta pessoal de algum administrador?" (só responde sim ou não)
create or replace function public.tenho_painel()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.perfis where is_admin and conta_pessoal = auth.uid());
$$;

revoke all on function public.admin_ligar_conta_pessoal(uuid) from public, anon;
revoke all on function public.tenho_painel() from public, anon;
grant execute on function public.admin_ligar_conta_pessoal(uuid) to authenticated;
grant execute on function public.tenho_painel() to authenticated;
