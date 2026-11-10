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
