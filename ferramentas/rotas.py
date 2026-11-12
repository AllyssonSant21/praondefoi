# Cria as páginas dos links limpos das abas (/cartoes, /contas…): cada pasta recebe uma cópia
# exata do index.html do ambiente (o <base href> faz os arquivos carregarem do lugar certo).
# Rodar sempre depois de mudar o index.html:  python3 ferramentas/rotas.py
import os, sys
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROTAS = ['lancamentos', 'cartoes', 'contas', 'metas', 'investimentos']
AMBIENTES = sys.argv[1:] or ['hmgbase', '.']
for amb in AMBIENTES:
    pagina = open(os.path.join(RAIZ, amb, 'index.html'), encoding='utf-8').read()
    assert '<base href="' in pagina, f'{amb}/index.html sem <base href>'
    for r in ROTAS:
        os.makedirs(os.path.join(RAIZ, amb, r), exist_ok=True)
        open(os.path.join(RAIZ, amb, r, 'index.html'), 'w', encoding='utf-8').write(pagina)
    print(f'{amb}: {len(ROTAS)} páginas de aba atualizadas')
