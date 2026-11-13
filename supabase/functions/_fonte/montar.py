#!/usr/bin/env python3
"""Gera as funções prontas para colar no Supabase (um arquivo só cada):
   whatsapp-bot/index.ts e telegram-bot/index.ts = canal + núcleo.
   Rodar sempre que mudar algo em _fonte/:  python3 supabase/functions/_fonte/montar.py"""
import os
aqui = os.path.dirname(os.path.abspath(__file__))
raiz = os.path.dirname(aqui)
nucleo = open(os.path.join(aqui, 'nucleo.ts'), encoding='utf-8').read()
nucleo = nucleo[nucleo.index('// ------------------------------------------------------------------ texto'):]
for canal, pasta in (('whatsapp', 'whatsapp-bot'), ('telegram', 'telegram-bot')):
    modelo = open(os.path.join(aqui, canal + '.ts'), encoding='utf-8').read()
    assert modelo.count('%%NUCLEO%%') == 1
    os.makedirs(os.path.join(raiz, pasta), exist_ok=True)
    open(os.path.join(raiz, pasta, 'index.ts'), 'w', encoding='utf-8').write(modelo.replace('%%NUCLEO%%', nucleo))
    print('ok', pasta)

# entendedor para o app (navegador): hmgbase/entender.js (precisa do esbuild, que o npx baixa sozinho)
import subprocess
saida = os.path.join(os.path.dirname(os.path.dirname(raiz)), 'hmgbase', 'entender.js')
r = subprocess.run(['npx', '--yes', 'esbuild@0.24.2', os.path.join(aqui, 'app-entender.ts'), '--bundle', '--format=iife', '--minify',
                    '--target=es2020', '--legal-comments=none', '--outfile=' + saida], capture_output=True, text=True)
if r.returncode: print('esbuild falhou:', r.stderr[-500:])
else:
    js = open(saida, encoding='utf-8').read()
    open(saida, 'w', encoding='utf-8').write('/* Pra Onde Foi? · entendedor de frases do Detetive Grana para o app. GERADO por supabase/functions/_fonte/montar.py: não editar à mão. */\n' + js)
    print('ok hmgbase/entender.js', len(js), 'bytes')

