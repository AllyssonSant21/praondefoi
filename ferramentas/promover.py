# Gera index.html/app.js/privacidade/termos do prod a partir do HMG, apontando pro banco OFICIAL
import re, shutil
import os
R=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))+'/'
HMG_REF,PROD_REF='ocasqtkfzddskvguuwkr','syffvgczgukoickcprni'
PROD_TG_BOT='Praondefoi_bot'   # @ do bot do Telegram do PROD (sem @); vazio = aparece 'Em breve'
HMG_KEY,PROD_KEY='sb_publishable_2w23PbGgEhhWTQYUAf-erw_af2TTyku','sb_publishable_r8xTsMwtJbJ64IVZP5-RBw_S53BVlkr'
s=open(R+'hmgbase/index.html').read()
def rep(a,b,cnt=None):
    global s
    n=s.count(a); assert n>=1 and (cnt is None or n==cnt),(a,n); s=s.replace(a,b)
rep('<link rel="icon" type="image/png" href="../icons/favicon.png">','<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" type="image/png" href="icons/favicon.png">',1)
rep('href="../icons/apple-touch-icon.png"','href="icons/apple-touch-icon.png"',1)
s=s.replace('<title>[HMG] ','<title>',1)
rep('<meta name="robots" content="noindex, nofollow">\n','',1)   # o HMG não aparece no Google; o prod sim
s,n=re.subn(r'  /\* ===== HMG ===== \*/\n  \.hmg-tag\{[^\n]*\}\n','',s); assert n==1
rep('<div class="hmg-tag">Versão de teste (HMG)</div>\n','',1)
rep('../logo/','logo/'); rep('../vendor/','vendor/')
rep('<base href="/hmgbase/">','<base href="/">',1)
rep(HMG_REF,PROD_REF,2)
assert '../' not in s and 'HMG' not in s and HMG_REF not in s
LEGAL = '[SEU NOME COMPLETO]' not in open(R+'hmgbase/privacidade.html').read()
if not LEGAL:   # política/termos novos ainda sem nome e e-mail: prod fica com a política antiga e sem link de termos
    for a,b in [(' · <a href="termos.html">Termos de uso</a>',''),
                (' · <a href="termos.html" style="color:inherit;">Termos</a>',''),
                ('concorda com os <a href="termos.html" style="color:inherit;">Termos de uso</a> e a <a href="privacidade.html"','concorda com a <a href="privacidade.html"')]:
        rep(a,b,1)
    assert 'termos.html' not in s
s,nb=re.subn(r'<!--BOT-->.*?<!--/BOT-->','',s,flags=re.S); assert nb==3   # bolha do bot, card do Detetive e faixa 'Mandou, tá lançado' só quando o bot ligar
open(R+'index.html','w').write(s)
j=open(R+'hmgbase/app.js').read()
for a,b in [("if (false && 'serviceWorker' in navigator && location.protocol === 'https:'){   // HMG: sem app instalável","if ('serviceWorker' in navigator && location.protocol === 'https:'){"),
            ("// HMG usa um banco só de testes (projeto Supabase separado do oficial)\n",""),(HMG_REF,PROD_REF),(HMG_KEY,PROD_KEY),
            ("const TG_BOT = 'praondefoi_teste_bot';", f"const TG_BOT = '{PROD_TG_BOT}';")]:   # o Detetive no prod é liberado conta por conta pelo admin
    assert j.count(a)==1,(a,j.count(a)); j=j.replace(a,b)
assert HMG_REF not in j and HMG_KEY not in j
open(R+'app.js','w').write(j)
for f in (('privacidade.html','termos.html') if LEGAL else ()):
    t=open(R+'hmgbase/'+f).read().replace('../icons/','icons/').replace('../logo/','logo/').replace('<meta name="robots" content="noindex, nofollow">\n','')
    assert '../' not in t; open(R+f,'w').write(t)
shutil.copy(R+'hmgbase/tema.js', R+'tema.js')
shutil.copy(R+'hmgbase/entender.js', R+'entender.js')
for f in ('404.html','robots.txt','sitemap.xml'):   # só funcionam na raiz do site
    shutil.copy(R+'hmgbase/'+f, R+f)
import subprocess; subprocess.run(['python3', R+'ferramentas/rotas.py', '.'], check=True)
print('prod gerado a partir do HMG, apontando pro banco oficial | páginas legais novas:', LEGAL)
