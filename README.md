# Pra Onde Foi?

Controle financeiro simples, para você e para a sua casa.
Funciona no navegador do computador e do celular, e pode ser instalado como app
(Android: "Instalar app" · iPhone: Compartilhar → "Adicionar à Tela de Início").

## Como funciona
- **Site:** `index.html` (HTML + CSS + JavaScript, sem etapa de compilação).
- **Dados e login:** [Supabase](https://supabase.com). Cada pessoa só vê os próprios lançamentos.
- **Banco:** o script `supabase-setup.sql` cria as tabelas e as regras de segurança.
- **App instalável:** `manifest.webmanifest`, `sw.js` e a pasta `icons/`.
- **Marca:** pasta `logo/` (SVG e PNG).

## Conta master
A primeira conta criada vira a conta master (administração).
Ela só aprova, bloqueia e exclui contas — e não vê dados financeiros de ninguém.
