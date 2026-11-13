// o app não pode ser aberto dentro de outro site (proteção contra clique disfarçado)
if (window.top !== window.self){ document.documentElement.style.display = 'none'; try { window.top.location = window.self.location.href; } catch(e){} }
// Pra Onde Foi? — código do app
/* =====================================================================
   CONFIGURAÇÃO — cole aqui os dados do seu projeto Supabase
   (Project Settings → API). A chave "anon public" pode ficar no código.
   NUNCA coloque aqui a chave "service_role".
   ===================================================================== */
// HMG usa um banco só de testes (projeto Supabase separado do oficial)
const SUPABASE_URL = 'https://ocasqtkfzddskvguuwkr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_2w23PbGgEhhWTQYUAf-erw_af2TTyku';

const KEY = 'cf-lancamentos-v1';        // dados antigos, salvos só neste aparelho
const IMPORTED_KEY = 'cf-importado-v1';
const BKEY = 'cf-orcamento-v1';
const CATS = {
  exp: ['Mercado','Alimentação','Moradia','Contas','Transporte','Saúde','Lazer','Educação','Outros'],
  inc: ['Salário','Renda extra','Outros']
};
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const brl = v => v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pad = n => String(n).padStart(2,'0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plural = (n,w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const $ = id => document.getElementById(id);
// links limpos das abas: praondefoiapp.com.br/cartoes, /contas… (cada uma tem a mesma página numa pasta)
const ROTAS = { lanc: 'lancamentos', cartoes: 'cartoes', contas: 'contas', metas: 'metas', invest: 'investimentos' };
const ROTA_ABA = Object.fromEntries(Object.entries(ROTAS).map(([a, r]) => [r, a]));
const APP_BASE = (() => {
  let p = location.pathname.replace(/index\.html$/, '');
  const m = p.match(/^(.*\/)([a-z]+)\/?$/);
  if (m && ROTA_ABA[m[2]]) p = m[1];
  return p.endsWith('/') ? p : p + '/';
})();
const ABA_DO_LINK = ROTA_ABA[location.pathname.slice(APP_BASE.length).replace(/\/$/, '')] || null;
const REDIRECT = location.origin + APP_BASE;   // e-mails e login sempre voltam para o início do app

// Login por nome de usuário: o Supabase exige e-mail, então "maria"
// vira "maria@usuarios.local" por baixo dos panos (nenhum e-mail é enviado).
const USER_DOMAIN = 'usuarios.local';
function toLoginEmail(input){
  const v = String(input || '').trim().toLowerCase();
  if (v.includes('@')) return /^\S+@\S+\.\S+$/.test(v) ? v : null;
  return /^[a-z0-9._-]{3,30}$/.test(v) ? `${v}@${USER_DOMAIN}` : null;
}
const isUsernameLogin = email => String(email || '').endsWith('@' + USER_DOMAIN);
const displayName = email => isUsernameLogin(email) ? email.slice(0, -(USER_DOMAIN.length + 1)) : (email || '');

/* ---------- campo de valor estilo app de banco ----------
   Só se digita números: 1 → 0,01 · 10 → 0,10 · 100 → 1,00 · 10000 → 100,00 (sem precisar de vírgula).
   Vale para todo campo com data-dinheiro, em qualquer aba ou janela. */
const fmtDinheiro = c => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function mascaraDinheiro(el){
  const dig = el.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 11);
  el.value = dig ? fmtDinheiro(Number(dig)) : '';
  try { el.setSelectionRange(el.value.length, el.value.length); } catch(e){}
}
document.addEventListener('input', e => { if (e.target.matches && e.target.matches('input[data-dinheiro]')) mascaraDinheiro(e.target); }, true);
// valor que já vem preenchido (editar): mostra com ponto de milhar e cursor no fim ao tocar
document.addEventListener('focusin', e => {
  const el = e.target;
  if (!el.matches || !el.matches('input[data-dinheiro]') || !el.value) return;
  const v = parseAmount(el.value); if (isFinite(v)) el.value = fmtDinheiro(Math.round(v * 100));
  setTimeout(() => { try { el.setSelectionRange(el.value.length, el.value.length); } catch(err){} }, 0);
});
function parseAmount(s){
  s = String(s || '').replace(/[^\d.,]/g,'');
  if (s.includes(',')) s = s.replace(/\./g,'').replace(',','.');
  const n = parseFloat(s);
  return isFinite(n) ? Math.round(n*100)/100 : NaN;
}
const fromRow = r => ({id:r.id, type:r.tipo, desc:r.descricao, cat:r.categoria, amount:Number(r.valor), date:r.data, uid:r.user_id, orig:r.origem || null});
const toRow = e => ({tipo:e.type, descricao:e.desc, categoria:e.cat, valor:e.amount, data:e.date});
const COLS = 'id,tipo,descricao,categoria,valor,data,user_id';
// de onde veio o lançamento (Detetive no Telegram/WhatsApp, leitura por IA). Só existe depois do supabase-bot8.sql
let temOrigem = null;
const colsLanc = () => temOrigem ? COLS + ',origem' : COLS;
async function checarOrigem(){
  if (temOrigem !== null) return;
  const { error } = await sb.from('lancamentos').select('origem').limit(1);
  if (!error) temOrigem = true; else if (!ehRede(error)) temOrigem = false;
}
const ORIGEM_TXT = {
  telegram: 'Lançado pelo Detetive no Telegram',
  whatsapp: 'Lançado pelo Detetive no WhatsApp',
  telegram_ia: 'Lido por IA: foto, PDF ou áudio enviado ao Detetive no Telegram',
  whatsapp_ia: 'Lido por IA: foto, PDF ou áudio enviado ao Detetive no WhatsApp',
};
const ROBO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4"/><circle cx="12" cy="3.5" r="1.2" fill="currentColor"/><circle cx="9" cy="14" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.3" fill="currentColor" stroke="none"/><path d="M2 13v3M22 13v3"/></svg>';
const origemSelo = (e, onde) => {
  const t = e.orig && ORIGEM_TXT[e.orig];
  return t ? `<button type="button" class="lorig lorig-${onde}" aria-label="${esc(t)}">${ROBO}<span class="bal" role="tooltip">🤖 ${esc(t)}</span></button>` : '';
};

// ---------- telas ----------
const VIEWS = ['viewSetup','viewLoading','viewAuth','viewWait','viewApp','viewAdmin'];
function show(v){ VIEWS.forEach(id => { $(id).hidden = id !== v; }); window.scrollTo(0,0); }
let toastTimer;
function toast(msg, ok){
  if (!ok && !navigator.onLine && /carregar|conexão|internet/i.test(msg)) return;   // sem internet: a faixa do topo já explica
  $('toast').textContent = msg; $('toast').hidden = false;
  $('toast').classList.toggle('ok', !!ok);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

const configured = !SUPABASE_URL.startsWith('COLE') && !SUPABASE_ANON_KEY.startsWith('COLE');
// veio do link "Esqueci a senha"? Guardado antes do Supabase ler e apagar o endereço
const VEIO_DO_RESET = /(^|[#&?])type=recovery(&|$)/.test(location.hash) || /[?&]type=recovery(&|$)/.test(location.search);
// ponte para o painel: no mesmo aparelho ficam duas sessões guardadas, a da sua conta e a da conta master.
// Trocar entre elas só recarrega a página com a outra (sem digitar senha de novo)
const lsLer = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsGravar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const CHAVE_ADMIN = 'pof-admin-auth';
const CHAVE_PADRAO = configured ? `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token` : '';
const MODO_ADMIN = lsLer('pof-modo') === 'admin';
const sb = configured && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, MODO_ADMIN ? { auth: { storageKey: CHAVE_ADMIN } } : undefined) : null;
function irPara(modo){ lsGravar('pof-modo', modo === 'admin' ? 'admin' : null); location.reload(); }

const now = new Date();
const state = {
  entries: [],
  controles: [], cid: null, members: [], invites: [],
  y: now.getFullYear(), m: now.getMonth(),
  type: 'exp',
  budget: Number(localStorage.getItem(BKEY) || 0) || 0
};
let currentUser = null, profile = null;

/* ======================= LOGIN ======================= */
let authMode = 'entrar', recovering = VEIO_DO_RESET;
function authMsg(text, kind){ $('authMsg').textContent = text || ''; $('authMsg').className = 'msg ' + (kind || ''); }
function setAuthMode(m){
  authMode = m;
  document.querySelectorAll('#authSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  const special = m === 'esqueci' || m === 'nova';
  $('authSeg').hidden = special;
  $('authHeading').hidden = !special;
  $('authHeading').textContent = m === 'nova' ? 'Crie uma nova senha' : 'Recuperar senha';
  $('authEmailWrap').hidden = m === 'nova';
  $('authPassWrap').hidden = m === 'esqueci';
  $('authPassLabel').textContent = m === 'nova' ? 'Nova senha' : 'Senha';
  $('authPass').autocomplete = (m === 'criar' || m === 'nova') ? 'new-password' : 'current-password';
  $('authPass').placeholder = (m === 'criar' || m === 'nova') ? 'Mínimo de 8 caracteres' : 'Sua senha';
  $('authSubmit').textContent = {entrar:'Entrar', criar:'Criar conta', esqueci:'Enviar link de recuperação', nova:'Salvar nova senha'}[m];
  $('forgot').hidden = m !== 'entrar';
  $('authAceite').hidden = m !== 'criar';
  $('backLogin').hidden = m !== 'esqueci';
  $('googleWrap').hidden = !googleOn || special;
  authMsg('');
}
document.querySelectorAll('#authSeg button').forEach(b => b.addEventListener('click', () => setAuthMode(b.dataset.mode)));
$('forgot').onclick = () => setAuthMode('esqueci');
$('backLogin').onclick = async () => {
  // desistiu de trocar a senha pelo link: sai da sessão aberta pelo link e volta para o login
  if (recovering){ recovering = false; try { await sb.auth.signOut({ scope: 'local' }); } catch(e){} }
  setAuthMode('entrar');
};

function translateError(err){
  const msg = (err && (err.message || err.error_description)) || String(err);
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/captcha/i.test(msg)) return 'Não conseguimos confirmar que você não é um robô. Espere o quadrinho de verificação e tente de novo.';
  if (/not confirmed/i.test(msg)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (/already registered|already been registered|already exists/i.test(msg)) return 'Esse usuário já existe. Use "Entrar" ou escolha outro nome.';
  if (/email address .* invalid|invalid email/i.test(msg)) return 'Esse e-mail não foi aceito. Confira se digitou certinho.';
  if (/email rate limit/i.test(msg)) return 'Não conseguimos enviar o e-mail agora. Tente de novo em alguns minutos.';
  if (/rate limit|security purposes|too many/i.test(msg)) return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.';
  if (/should contain|weak|pwned|leaked|compromised/i.test(msg)) return 'Essa senha é fraca ou já apareceu em vazamentos. Escolha outra, misturando letras, números e símbolos.';
  if (/at least \d+ characters|password should be at least/i.test(msg)) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (/same password|different from the old/i.test(msg)) return 'A nova senha precisa ser diferente da anterior.';
  if (/already linked|identity_already_exists|already exists for another user/i.test(msg)) return 'Essa conta Google já está ligada a outro usuário do app.';
  if (/manual linking/i.test(msg)) return 'Ligar a conta Google ainda não está disponível. Tente mais tarde.';
  if (/provider is not enabled|unsupported provider/i.test(msg)) return 'O login com Google ainda não está disponível.';
  if (/access_denied|cancel/i.test(msg)) return 'O login com Google foi cancelado.';
  if (/failed to fetch|network/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet.';
  if (/expired|invalid.*link|otp|link is invalid/i.test(msg)) return 'Esse link de troca de senha expirou ou já foi usado. Peça um novo em "Esqueci a senha".';
  return 'Algo deu errado. Tente de novo.';
}

/* ---------- captcha (Cloudflare Turnstile) ----------
   Só liga quando a chave pública estiver preenchida. Depois disso, ligar o captcha também no Supabase
   (Authentication → Attack Protection), senão ele não é exigido no servidor. */
const TURNSTILE_KEY = '0x4AAAAAAF08CgIz2L5QlGbl';
let captchaId = null, captchaToken = null;
window.pofCaptchaPronto = () => {
  if (!window.turnstile || captchaId !== null) return;
  captchaId = window.turnstile.render('#captchaBox', {
    sitekey: TURNSTILE_KEY, language: 'pt-br', theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    callback: t => { captchaToken = t; },
    'expired-callback': () => { captchaToken = null; },
    'error-callback': () => { captchaToken = null; }
  });
};
function carregarCaptcha(){
  if (!TURNSTILE_KEY || document.getElementById('tsScript')) return;
  const sc = document.createElement('script');
  sc.id = 'tsScript'; sc.async = true;
  sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=pofCaptchaPronto';
  document.head.appendChild(sc);
}
const captchaLigado = () => !!TURNSTILE_KEY && authMode !== 'nova';
function mostrarCaptcha(){ $('captchaBox').hidden = !captchaLigado(); if (captchaLigado()) carregarCaptcha(); }
function captchaUsado(){ captchaToken = null; try { if (window.turnstile && captchaId !== null) window.turnstile.reset(captchaId); } catch(e){} }
mostrarCaptcha();
document.querySelectorAll('#authSeg button').forEach(b => b.addEventListener('click', mostrarCaptcha));

/* ---------- trava de senha errada ----------
   A partir da 2ª senha errada no mesmo login: espera 10 s, depois 20 s, 30 s... (máximo 5 min).
   Fica guardado no navegador (recarregar não zera) e é separado por login. Acertou: zera. */
const TRAVA_KEY = 'pof-trava';
const hashLogin = t => { let h = 2166136261; for (const c of String(t).toLowerCase()) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
function travas(){ try { return JSON.parse(localStorage.getItem(TRAVA_KEY) || '{}') || {}; } catch(e){ return {}; } }
function salvarTravas(t){
  const agora = Date.now();
  for (const k of Object.keys(t)) if (t[k].ate < agora - 86400000) delete t[k];   // esquece o que tem mais de 1 dia
  try { localStorage.setItem(TRAVA_KEY, JSON.stringify(t)); } catch(e){}
}
function travaDe(email){ return email ? travas()[hashLogin(email)] : null; }
function senhaErrada(email){
  const t = travas(), k = hashLogin(email), r = t[k] || { n: 0, ate: 0 };
  r.n++;
  const seg = r.n >= 2 ? Math.min(300, (r.n - 1) * 10) : 0;
  r.ate = Date.now() + seg * 1000;
  t[k] = r; salvarTravas(t);
  return seg;
}
function senhaCerta(email){ const t = travas(); delete t[hashLogin(email)]; salvarTravas(t); }
let travaTimer = null;
function aplicarTrava(){
  clearInterval(travaTimer); travaTimer = null;
  const btn = $('authSubmit');
  const r = authMode === 'entrar' ? travaDe(toLoginEmail($('authEmail').value.trim())) : null;
  const falta = r ? Math.ceil((r.ate - Date.now()) / 1000) : 0;
  if (falta <= 0){
    if (btn.dataset.travado){ delete btn.dataset.travado; btn.disabled = false; btn.textContent = {entrar:'Entrar', criar:'Criar conta', esqueci:'Enviar link de recuperação', nova:'Salvar nova senha'}[authMode]; }
    return;
  }
  const tick = () => {
    const atual = travaDe(toLoginEmail($('authEmail').value.trim()));
    const s = atual ? Math.ceil((atual.ate - Date.now()) / 1000) : 0;
    if (s <= 0) return aplicarTrava();
    btn.dataset.travado = '1'; btn.disabled = true;
    btn.textContent = `Tente de novo em ${s >= 60 ? Math.floor(s / 60) + 'min ' + String(s % 60).padStart(2, '0') + 's' : s + 's'}`;
  };
  tick(); travaTimer = setInterval(tick, 1000);
}
$('authEmail').addEventListener('input', aplicarTrava);
document.querySelectorAll('#authSeg button').forEach(b => b.addEventListener('click', aplicarTrava));

$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const typed = $('authEmail').value.trim(), pass = $('authPass').value;
  const email = toLoginEmail(typed);
  // acesso só com e-mail. (Quem já tinha conta com nome de usuário ainda consegue entrar.)
  if (authMode !== 'nova' && (!email || (authMode !== 'entrar' && isUsernameLogin(email))))
    return authMsg('Digite um e-mail válido.', 'err');
  if (authMode === 'esqueci' && isUsernameLogin(email))
    return authMsg('Contas com nome de usuário não recebem e-mail. Peça ao administrador uma senha temporária e depois troque em "Trocar senha".', 'err');
  // senha nova: mínimo 8. Para entrar, aceita as senhas antigas de 6 ou 7.
  if ((authMode === 'criar' || authMode === 'nova') && pass.length < 8) return authMsg('A senha precisa ter pelo menos 8 caracteres.', 'err');
  if (authMode === 'entrar' && !pass) return authMsg('Digite a sua senha.', 'err');
  if (authMode === 'entrar'){
    const r = travaDe(email);
    if (r && r.ate > Date.now()){ aplicarTrava(); return authMsg('Muitas tentativas com senha errada. Espere a contagem terminar ou use "Esqueci minha senha".', 'err'); }
  }
  if (captchaLigado() && !captchaToken) return authMsg('Espere a verificação de segurança terminar (o quadrinho acima do botão).', 'err');
  const cap = captchaLigado() ? { captchaToken } : {};
  const btn = $('authSubmit'); btn.disabled = true; authMsg('');
  try {
    if (authMode === 'entrar'){
      const { error } = await sb.auth.signInWithPassword({ email, password: pass, options: cap });
      if (error){
        // só senha errada conta para a trava (internet fora, servidor fora etc. não)
        if (/invalid login credentials/i.test(error.message || '')){
          const seg = senhaErrada(email);
          authMsg(seg ? `E-mail ou senha incorretos. Espere ${seg >= 60 ? Math.round(seg / 60) + ' min' : seg + ' s'} para tentar de novo. Esqueceu? Use "Esqueci minha senha".` : 'E-mail ou senha incorretos.', 'err');
          btn.disabled = false; aplicarTrava();
          return;
        }
        throw error;
      }
      senhaCerta(email);
    } else if (authMode === 'criar'){
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: REDIRECT, ...cap } });
      if (error && /database error saving new user|convidad/i.test(error.message || '')){
        authMsg('Este ambiente é só para testes de pessoas convidadas.', 'err');
        return;
      }
      if (error) throw error;
      if (!data.session){
        setAuthMode('entrar');
        authMsg(`Conta criada! Enviamos um link de confirmação para ${typed}. Confirme e depois entre aqui.`, 'ok');
      }
    } else if (authMode === 'esqueci'){
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT, ...cap });
      if (error) throw error;
      authMsg('Se esse e-mail tiver conta, enviamos um link para criar uma nova senha.', 'ok');
    } else if (authMode === 'nova'){
      const { error } = await sb.auth.updateUser({ password: pass });
      if (error) throw error;
      recovering = false;
      $('authPass').value = '';
      const { data: { session } } = await sb.auth.getSession();
      await handleSession(session, true);
      toast('Senha alterada.');
    }
  } catch (err) {
    authMsg(translateError(err), 'err');
  } finally {
    if (cap.captchaToken) captchaUsado();   // cada verificação vale uma tentativa só
    if (!btn.dataset.travado) btn.disabled = false;
  }
});

document.querySelectorAll('[data-changepass]').forEach(b => b.addEventListener('click', async () => {
  const nova = await pedirTexto('Trocar senha', '', { rotulo: 'Nova senha (mínimo de 8 caracteres)', tipo: 'password', okTxt: 'Continuar' });
  if (nova === null) return;
  if (nova.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres.');
  const confirma = await pedirTexto('Trocar senha', '', { rotulo: 'Digite a nova senha de novo', tipo: 'password', okTxt: 'Trocar senha' });
  if (confirma === null) return;
  if (confirma !== nova) return toast('As senhas não conferem. Tente de novo.');
  const { error } = await sb.auth.updateUser({ password: nova });
  if (error) return toast(translateError(error));
  try { await sb.auth.signOut({ scope: 'others' }); } catch(e){}
  toast('Senha alterada. Os outros aparelhos conectados foram desconectados.', true);
}));

document.querySelectorAll('[data-logout]').forEach(b => b.addEventListener('click', async () => {
  await sb.auth.signOut({ scope: 'local' });   // só este aparelho; a outra sessão guardada (sua conta / master) continua
  if (MODO_ADMIN) irPara('');
}));

/* ======================= SESSÃO ======================= */
function waitScreen(title, text){
  $('waitTitle').innerHTML = title;
  $('waitText').textContent = text;
  $('waitEmail').textContent = currentUser ? `Conta: ${displayName(currentUser.email)}` : '';
  show('viewWait');
}
$('waitRetry').onclick = async () => {
  const { data: { session } } = await sb.auth.getSession();
  handleSession(session, true);
};

/* ---------- Google ---------- */
let googleOn = false;
async function checarProvedores(){
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } });
    const j = await r.json();
    googleOn = !!(j && j.external && j.external.google);
  } catch(e){ googleOn = false; }
  $('googleWrap').hidden = !googleOn || authMode === 'esqueci' || authMode === 'nova';
}
$('googleBtn').onclick = async () => {
  $('googleBtn').disabled = true;
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: REDIRECT } });
  if (error){ $('googleBtn').disabled = false; authMsg(translateError(error), 'err'); }
};
// erro devolvido pelo Google/Supabase na volta (ex.: cancelou, conta já ligada)
let authErroVolta = null;
(function(){
  const q = new URLSearchParams(location.search.slice(1) + '&' + location.hash.slice(1));
  const d = q.get('error_description') || q.get('error');
  if (d){ authErroVolta = translateError({ message: d.replace(/\+/g, ' ') }); history.replaceState(null, '', REDIRECT); }
})();

// painel de uso do admin: registra quando a conta abriu o app (o banco guarda no máximo a cada 15 min)
function marcarAcesso(){ if (sb && currentUser) sb.rpc('registrar_acesso').then(() => {}, () => {}); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && profile && profile.status === 'aprovado') marcarAcesso(); });

async function handleSession(session, force){
  // link de troca de senha: abre a tela de senha nova, nunca o app direto
  if (session && recovering){ show('viewAuth'); setAuthMode('nova'); return; }
  if (!session){
    stopRealtime();
    currentUser = null; profile = null; state.entries = []; state.controles = []; state.cid = null; state.members = []; state.invites = [];
    $('dlg').hidden = true;
    $('authPass').value = '';
    show('viewAuth');
    if (authMode === 'nova') setAuthMode('entrar');
    if (authErroVolta){ authMsg(authErroVolta, 'err'); authErroVolta = null; }
    return;
  }
  if (authErroVolta){ toast(authErroVolta); authErroVolta = null; }
  if (!force && currentUser && currentUser.id === session.user.id && profile) return;
  currentUser = session.user;
  if ($('viewApp').hidden && $('viewAdmin').hidden) show('viewLoading');

  if (!navigator.onLine && await abrirSemInternet()) return;   // modo avião: abre na hora com o que já tinha
  let { data, error } = await sb.from('perfis').select('id,email,status,is_admin,nome,foto,email_aviso,whatsapp,avisos').eq('id', currentUser.id).maybeSingle();
  perfilNovo = !error;
  if (error && (error.code === '42703' || /column/i.test(error.message || ''))){
    ({ data, error } = await sb.from('perfis').select('id,email,status,is_admin').eq('id', currentUser.id).maybeSingle());
  }
  if (error && ehRede(error) && await abrirSemInternet()) return;
  if (error || !data){
    profile = null;
    return waitScreen('Algo não<br>carregou', error
      ? 'Não foi possível carregar sua conta. Verifique a internet e tente de novo.'
      : 'Não foi possível carregar a sua conta agora. Tente de novo em alguns minutos.');
  }
  profile = data;
  if (profile.status === 'pendente')
    return waitScreen('Cadastro<br>em análise', 'Sua conta foi criada e está aguardando a liberação do administrador. Assim que for aprovada, é só tocar em "Verificar de novo".');
  if (profile.status === 'bloqueado')
    return waitScreen('Acesso<br>bloqueado', 'Seu acesso foi suspenso pelo administrador.');

  renderMe();
  marcarAcesso();
  $('adminEmail').textContent = displayName(profile.email);
  // entrou com a conta comum no modo do painel: devolve a sessão para o lugar normal
  if (MODO_ADMIN && !profile.is_admin && CHAVE_PADRAO){ lsGravar(CHAVE_PADRAO, lsLer(CHAVE_ADMIN)); lsGravar(CHAVE_ADMIN, null); return irPara(''); }
  if (profile.is_admin){
    // conta master: só administração, sem controle financeiro.
    // Guarda a sessão dela à parte, para poder ir e voltar da sua conta sem digitar senha
    if (!MODO_ADMIN && CHAVE_PADRAO && lsLer(CHAVE_PADRAO)){ lsGravar(CHAVE_ADMIN, lsLer(CHAVE_PADRAO)); lsGravar(CHAVE_PADRAO, null); return irPara('admin'); }
    show('viewAdmin');
    renderAdmin();
    loadUsers().then(loadUso);
    return;
  }
  if (!(await loadControles())) return;
  await Promise.all([loadMembers(), loadEntries(), loadInvites(), loadContas(), loadMetas(), loadInvest(), loadCategorias(), loadCartoes()]);
  fillCats();
  show('viewApp');
  render();
  startRealtime();
  checarBot(); checarIA();
  $('drPainel').hidden = !lsLer(CHAVE_ADMIN);   // este aparelho já entrou na conta master: atalho para o painel
  modoSemInternet = false;
  gravarFoto();
  enviarFila();
  temaDaConta();
}

/* ======================= CONTROLES ======================= */
const ctrlKey = () => `pof-controle-${currentUser ? currentUser.id : ''}`;
const current = () => state.controles.find(c => c.id === state.cid) || null;
const isShared = () => { const c = current(); return !!c && !c.pessoal; };
const nameOf = uid => {
  if (currentUser && uid === currentUser.id) return 'você';
  const m = state.members.find(x => x.user_id === uid);
  return m ? (m.nome || displayName(m.login)) : 'ex-participante';
};
// mensagens que o próprio app escreveu no banco (raise exception) aparecem; erro técnico vira texto simples
function rpcMsg(error){
  const msg = (error && error.message) || '', code = (error && error.code) || '';
  if (/failed to fetch|network|load failed/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet.';
  if (code === 'P0001' && msg && msg.length <= 200) return msg;
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'Você não tem permissão para fazer isso.';
  if (code === '23505') return 'Isso já existe.';
  if (code === '23514' || code === '22001' || code === '22P02' || code === '22003') return 'Algum valor não foi aceito. Confira os campos.';
  if (/JWT|token/i.test(msg)) return 'Sua sessão expirou. Entre de novo.';
  if (code === 'PGRST202' || /function|schema cache/i.test(msg)) return 'Esta área está temporariamente indisponível. Tente de novo mais tarde.';
  if (msg && !code && /^[A-ZÀ-Ú]/.test(msg) && /[áéíóúãõçê]/i.test(msg)) return msg;
  return 'Algo deu errado. Tente de novo.';
}

async function loadControles(){
  const g = await sb.rpc('garantir_controle_pessoal');
  if (g.error){
    if (g.error.code === 'PGRST202' || /could not find the function|does not exist/i.test(g.error.message || '')){
      waitScreen('Falta<br>atualizar', 'O app está passando por uma atualização. Tente de novo em alguns minutos tocando em "Verificar de novo".');
    } else toast(rpcMsg(g.error));
    return false;
  }
  const { data, error } = await sb.rpc('meus_controles');
  if (error){ toast(rpcMsg(error)); return false; }
  state.controles = data || [];
  let wanted = state.cid;
  try { wanted = wanted || localStorage.getItem(ctrlKey()); } catch(e){}
  const pessoal = state.controles.find(c => c.pessoal);
  state.cid = state.controles.some(c => c.id === wanted) ? wanted : (pessoal ? pessoal.id : (state.controles[0] || {}).id);
  return true;
}
function selectControle(id){
  state.cid = id;
  try { localStorage.setItem(ctrlKey(), id); } catch(e){}
  gravarFoto();
}
async function loadMembers(){
  if (!state.cid){ state.members = []; return; }
  const { data, error } = await sb.rpc('participantes', { cid: state.cid });
  state.members = error ? [] : (data || []);
}
async function loadInvites(){
  const { data, error } = await sb.rpc('meus_convites');
  state.invites = error ? [] : (data || []);
  renderInvites();
}

/* ======================= DADOS ======================= */
let loadSeq = 0;
async function loadEntries(){
  const seq = ++loadSeq;
  if (!state.cid){ state.entries = []; return true; }
  mesNaTela = '';
  const { y, m } = state;
  const start = `${y}-${pad(m+1)}-01`;
  const nd = new Date(y, m + 1, 1);
  const end = `${nd.getFullYear()}-${pad(nd.getMonth()+1)}-01`;
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE){
    if (temOrigem === null) await checarOrigem();
    const { data, error } = await sb.from('lancamentos').select(colsLanc())
      .eq('controle_id', state.cid).gte('data', start).lt('data', end)
      .order('data', { ascending: false }).order('criado_em', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error){
      if (seq !== loadSeq) return false;
      if (ehRede(error)){ state.entries = (lerCache(state.cid, y, m) || []).map(fromRow); mesNaTela = `${state.cid}|${y}-${m}`; juntarFila(); return true; }   // sem internet: o que já tinha aberto antes
      toast('Não foi possível carregar os lançamentos.'); return false;
    }
    all.push(...data);
    if (data.length < PAGE) break;
  }
  if (seq !== loadSeq) return false;           // o usuário já trocou de mês/controle
  gravarCache(state.cid, y, m, all);
  state.entries = all.map(fromRow);
  mesNaTela = `${state.cid}|${y}-${m}`;
  juntarFila();
  return true;
}
async function fetchAllEntries(){
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE){
    const { data, error } = await sb.from('lancamentos').select(COLS).eq('controle_id', state.cid)
      .order('data', { ascending: true }).range(from, from + PAGE - 1);
    if (error) return null;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all.map(fromRow);
}
async function refresh(){ const [ok] = await Promise.all([loadEntries(), loadContas(), loadMetas(), loadInvest(), loadCategorias(), loadCartoes()]); if (ok){ fillCats(); render(); } }

// dados antigos guardados só neste navegador (versão offline)
function localPending(){
  try {
    if (localStorage.getItem(IMPORTED_KEY)) return [];
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!s || s.isSample || !Array.isArray(s.entries)) return [];
    return s.entries.filter(e => e && e.desc && e.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(e.date));
  } catch(e){ return []; }
}
$('importLocal').onclick = async () => {
  const list = localPending();
  const pessoal = state.controles.find(c => c.pessoal);
  if (!list.length || !pessoal) return;
  if (!await confirmar(`Enviar ${plural(list.length,'lançamento')} salvos neste aparelho para o seu "Meu controle"?`)) return;
  $('importLocal').disabled = true;
  const { error } = await sb.from('lancamentos').insert(list.map(e => ({ ...toRow(e), controle_id: pessoal.id })));
  $('importLocal').disabled = false;
  if (error) return toast('Não foi possível enviar. Tente de novo.');
  try { localStorage.setItem(IMPORTED_KEY, '1'); } catch(e){}
  selectControle(pessoal.id);
  await loadMembers(); await refresh();
  toast(`${plural(list.length,'lançamento')} enviados.`);
};


/* ======================= CONFIRMAÇÃO (janela do app) ======================= */
// Mesmo formato do confirm() do navegador: 1ª parte vira o título, o resto o texto.
const PERIGO = ['Excluir','Remover','Sair','Desfazer','Encerrar','Retirar','Resgatar','Vender','Apagar'];
// pede um texto numa janela do app (no lugar da caixinha do navegador). Devolve o texto ou null.
function pedirTexto(titulo, texto, { rotulo = '', valor = '', placeholder = '', okTxt = 'Confirmar', tipo = 'text', modo = '', vazioOk = false, perigo = false } = {}){
  return new Promise(res => {
    $('confTitle').textContent = titulo;
    $('confText').textContent = texto || ''; $('confText').hidden = !texto;
    $('confCampo').hidden = false; $('confLabel').textContent = rotulo; $('confLabel').hidden = !rotulo;
    const inp = $('confInput'); inp.type = tipo; inp.value = valor; inp.placeholder = placeholder;
    if (modo) inp.setAttribute('inputmode', modo); else inp.removeAttribute('inputmode');
    inp.autocomplete = tipo === 'password' ? 'new-password' : 'off';
    $('confYes').textContent = okTxt; $('confYes').className = perigo ? 'btn btn-danger' : 'btn btn-primary';
    $('dlgConf').hidden = false;
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
    const tecla = e => {
      if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); fim(null); }
      if (e.key === 'Enter' && document.activeElement === inp){ e.preventDefault(); ok(); }
    };
    const ok = () => { const v = inp.value; if (!vazioOk && !v.trim()){ inp.focus(); return; } fim(v); };
    const fim = v => {
      $('dlgConf').hidden = true; $('confCampo').hidden = true; inp.value = '';
      $('confYes').onclick = $('confNo').onclick = null;
      document.removeEventListener('keydown', tecla, true);
      res(v);
    };
    $('confYes').onclick = ok;
    $('confNo').onclick = () => fim(null);
    document.addEventListener('keydown', tecla, true);
  });
}

function confirmar(msg, okTxt){
  $('confCampo').hidden = true;
  const [titulo, ...resto] = String(msg).split('\n\n');
  const primeira = (titulo.match(/^[A-Za-zÀ-ú]+/) || [''])[0];
  const verbo = okTxt || (/(ar|er|ir)$/i.test(primeira) ? primeira : 'Confirmar');
  return new Promise(res => {
    $('confTitle').textContent = /[.!?]$/.test(titulo) ? titulo : titulo + '?';
    $('confText').textContent = resto.join('\n\n');
    $('confText').hidden = !resto.length;
    $('confYes').textContent = verbo.charAt(0).toUpperCase() + verbo.slice(1);
    $('confYes').className = 'btn ' + (PERIGO.includes(verbo) ? 'btn-danger' : 'btn-primary');
    $('dlgConf').hidden = false;
    setTimeout(() => $('confNo').focus(), 0);
    const tecla = e => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); fim(false); } };
    const fim = v => {
      $('dlgConf').hidden = true;
      $('confYes').onclick = $('confNo').onclick = $('dlgConf').onclick = null;
      document.removeEventListener('keydown', tecla, true);
      res(v);
    };
    $('confYes').onclick = () => fim(true);
    $('confNo').onclick = () => fim(false);
    document.addEventListener('keydown', tecla, true);
  });
}

/* ---------- janela: nova categoria / editar categoria ---------- */
const EMOJIS_CAT = ['🐶','🏋️','💄','🎮','🍔','☕','👶','🎁','✈️','🚗','💊','📚','🧾','🏠','💼','🎵'];
function janelaCategoria(cat, tipoPadrao){
  return new Promise(res => {
    const t = cat ? cat.tipo : (tipoPadrao || 'exp');
    openDlg2('Categorias', cat ? 'Editar categoria' : 'Nova categoria', `
      <div class="field"><label for="ctNome">Nome</label><input class="input" id="ctNome" maxlength="30" placeholder="Academia" value="${cat ? esc(cat.nome) : ''}" autocomplete="off"></div>
      <div class="field"><label>Ícone (opcional)</label>
        <div class="ct-emojis" role="group" aria-label="Ícone">${['', ...EMOJIS_CAT].map(e => `<button type="button" class="ct-emoji" data-ct-emoji="${e}" aria-pressed="${(cat ? (cat.icone || '') : '') === e}">${e || 'Sem'}</button>`).join('')}</div>
      </div>
      <div class="field"><label>Aparece em qual lista?</label>
        <div class="seg" id="ctTipo">${[['exp','Saídas'],['inc','Entradas'],['ambos','Nas duas']].map(([v, l]) => `<button type="button" data-ct-tipo="${v}" aria-pressed="${t === v}">${l}</button>`).join('')}</div>
        <span class="hint" style="margin:0;">Use "Nas duas" para categorias como Presente.</span>
      </div>
      ${cat ? '<p class="hint" style="margin:0;">Ao renomear, os lançamentos e as contas com essa categoria passam a usar o nome novo.</p>' : ''}
      <span class="hint" id="ctErro" style="color:var(--alerta);" hidden></span>
      <button class="btn btn-primary" type="button" data-ct-salvar style="min-height:44px;">${cat ? 'Salvar' : 'Criar categoria'}</button>`,
      { tipo: 'categoria', cat, res });
    setTimeout(() => $('ctNome').focus(), 0);
  });
}
async function novaCategoria(tipo){ return janelaCategoria(null, tipo); }
$('dlg2Body').addEventListener('click', async e => {
  if (dlg2.tipo !== 'categoria') return;
  const em = e.target.closest('[data-ct-emoji]');
  if (em){ document.querySelectorAll('[data-ct-emoji]').forEach(b => b.setAttribute('aria-pressed', String(b === em))); return; }
  const tp = e.target.closest('[data-ct-tipo]');
  if (tp){ document.querySelectorAll('[data-ct-tipo]').forEach(b => b.setAttribute('aria-pressed', String(b === tp))); return; }
  if (!e.target.closest('[data-ct-salvar]')) return;
  const nome = $('ctNome').value.trim();
  const icone = (document.querySelector('[data-ct-emoji][aria-pressed="true"]') || {}).dataset?.ctEmoji || '';
  const tipo = (document.querySelector('[data-ct-tipo][aria-pressed="true"]') || {}).dataset?.ctTipo || 'exp';
  const erro = m => { $('ctErro').textContent = m; $('ctErro').hidden = false; };
  if (!nome) return erro('Dê um nome para a categoria.');
  const b = e.target.closest('[data-ct-salvar]'); b.disabled = true;
  const { cat, res } = dlg2;
  const { error } = await sb.rpc('salvar_categoria', { p_id: cat ? cat.id : null, cid: state.cid, p_nome: nome, p_icone: icone, p_tipo: tipo });
  b.disabled = false;
  if (error) return erro(rpcMsg(error));
  await loadCategorias();
  if (cat && cat.nome !== nome) await loadEntries();
  closeDlg2(); fillCats(); render();
  toast(cat ? 'Categoria atualizada.' : `Categoria "${nome}" criada.`, true);
  if (res) res(nome);
});
$('dlg2Body').addEventListener('keydown', e => { if (dlg2.tipo === 'categoria' && e.key === 'Enter' && e.target.id === 'ctNome'){ e.preventDefault(); document.querySelector('[data-ct-salvar]').click(); } });

/* ---------- Menu → Minhas categorias ---------- */
function openCategorias(){
  const minhas = categorias.slice().sort((a, b) => (a.oculta - b.oculta) || a.nome.localeCompare(b.nome));
  const TIPO = { exp: 'Saídas', inc: 'Entradas', ambos: 'Saídas e entradas' };
  const pode = c => (currentUser && c.criado_por === currentUser.id) || !!(current() || {}).sou_dono;
  openDlg2('Categorias', 'Minhas categorias', `
    <p class="hint" style="margin:0;">As categorias do app (Mercado, Moradia…) estão sempre disponíveis. Aqui ficam as que você criou${isShared() ? ' neste controle, que todos dele usam' : ''}.</p>
    <div class="ct-lista">${minhas.length ? minhas.map(c => `
      <div class="ct-item${c.oculta ? ' oculta' : ''}">
        <span class="ct-ic">${c.icone ? esc(c.icone) : '🏷️'}</span>
        <span class="ct-nm"><b>${esc(c.nome)}</b><small>${TIPO[c.tipo]}${c.oculta ? ' · escondida' : ''}</small></span>
        ${pode(c) ? `<button class="btn btn-ghost btn-sm" type="button" data-ct-editar="${esc(c.id)}">Editar</button>
        <button class="btn btn-ghost btn-sm" type="button" data-ct-ocultar="${esc(c.id)}">${c.oculta ? 'Mostrar' : 'Esconder'}</button>` : ''}
      </div>`).join('') : '<p class="hint" style="margin:6px 0;">Você ainda não criou nenhuma categoria.</p>'}</div>
    <button class="btn btn-primary" type="button" data-ct-nova style="min-height:44px;">+ Nova categoria</button>`, { tipo: 'categorias' });
}
$('dlg2Body').addEventListener('click', async e => {
  if (dlg2.tipo !== 'categorias') return;
  if (e.target.closest('[data-ct-nova]')){ await novaCategoria(state.type); openCategorias(); return; }
  const ed = e.target.closest('[data-ct-editar]');
  if (ed){ const c = categorias.find(x => x.id === ed.dataset.ctEditar); if (c){ await janelaCategoria(c); openCategorias(); } return; }
  const oc = e.target.closest('[data-ct-ocultar]');
  if (oc){
    const c = categorias.find(x => x.id === oc.dataset.ctOcultar); if (!c) return;
    oc.disabled = true;
    const { error } = await sb.rpc('ocultar_categoria', { p_id: c.id, p_oculta: !c.oculta });
    if (error){ oc.disabled = false; return toast(rpcMsg(error)); }
    await loadCategorias(); fillCats(); openCategorias();
    toast(c.oculta ? `"${c.nome}" voltou para a lista.` : `"${c.nome}" saiu da lista. Os lançamentos antigos continuam com ela.`, true);
  }
});

/* ======================= FORMULÁRIO ======================= */
/* ---------- categorias personalizadas (por controle) ---------- */
let categorias = [];
async function loadCategorias(){
  if (!state.cid){ categorias = []; return true; }
  const { data, error } = await sb.from('categorias').select('id,tipo,nome,icone,oculta,criado_por').eq('controle_id', state.cid).order('nome');
  categorias = error ? [] : data;      // sem o SQL rodado: só as categorias do app
  return true;
}
// emoji de cada categoria do app (as personalizadas usam o emoji que a pessoa escolheu)
const ICONE_APP = { 'Mercado':'🛒', 'Alimentação':'🍽️', 'Moradia':'🏠', 'Contas':'🧾', 'Transporte':'🚗', 'Saúde':'💊', 'Lazer':'🎉', 'Educação':'📚',
  'Outros':'📦', 'Salário':'💰', 'Renda extra':'💸', 'Metas':'🎯', 'Cartão de crédito':'💳' };
const iconeCat = nome => { const c = categorias.find(x => x.nome === nome); return (c && c.icone) || ICONE_APP[nome] || ''; };
// rótulo com o emoji, valor só com o nome (é o que fica gravado no lançamento)
const rotuloCat = nome => { const i = iconeCat(nome); return i ? `${i} ${nome}` : nome; };
function listaCats(tipo, atual){
  const base = CATS[tipo].filter(c => c !== 'Outros');
  const minhas = categorias.filter(c => !c.oculta && (c.tipo === tipo || c.tipo === 'ambos')).map(c => c.nome);
  const l = [...base, ...minhas, 'Outros'];
  if (atual && !l.includes(atual)) l.unshift(atual);
  return l;
}
const opcoesCat = (tipo, atual, comNova = true) => listaCats(tipo, atual)
  .map(c => `<option value="${esc(c)}"${c === atual ? ' selected' : ''}>${esc(rotuloCat(c))}</option>`).join('')
  + (comNova ? '<option value="__nova">+ Nova categoria…</option>' : '');

function fillCats(){
  // exemplo do campo Descrição combina com o tipo (saída ou entrada)
  if (!$('desc').readOnly) $('desc').placeholder = state.type === 'inc' ? 'Salário' : 'Mercado';
  if ($('cat').disabled) return;     // travada pelo "Usar para"
  const antes = $('cat').value;
  $('cat').innerHTML = opcoesCat(state.type, null);
  if (antes && antes !== '__nova' && [...$('cat').options].some(o => o.value === antes)) $('cat').value = antes;
  $('cat').dataset.ultima = $('cat').value;
  document.querySelectorAll('#typeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === state.type)));
}
document.querySelectorAll('#typeSeg button').forEach(b => b.addEventListener('click', () => { state.type = b.dataset.type; fillCats(); vincOpcoes(); pagComOpcoes(); }));
$('cat').addEventListener('change', async () => {
  const sel = $('cat');
  if (sel.value !== '__nova'){ sel.dataset.ultima = sel.value; return; }
  sel.value = sel.dataset.ultima || CATS[state.type][0];
  const nova = await novaCategoria(state.type);
  if (nova){ fillCats(); sel.value = nova; sel.dataset.ultima = nova; }
});

/* ---------- "Usar para": lançar já guardando numa meta ou pagando uma conta ---------- */
function contasAbertasDoMes(){
  if (!state.contasOk || !modOn('contas')) return [];
  const mk = mkey(state.y, state.m);
  return state.contas.filter(c => ocorre(c, mk)).map(c => instancia(c, mk))
    .filter(i => !i.paid && !(i.antes && i.c.tipo === 'parcelada' && i.pago === 0))
    .sort((a, b) => (a.due - b.due) || a.c.nome.localeCompare(b.c.nome));
}
function vincOpcoes(){
  const sel = $('vinc'), atual = sel.value;
  const metas = (state.metasOk && modOn('metas')) ? state.metas.map(m => ({ m, i: infoMeta(m) })) : [];
  let html = '<option value="">Só lançamento</option>', n = 0;
  if (state.type === 'exp'){
    const ms = metas.filter(x => !x.i.done);
    if (ms.length){ n += ms.length; html += `<optgroup label="Guardar na meta">${ms.map(x => `<option value="m:${esc(x.m.id)}">${esc(x.m.icone)} ${esc(x.m.nome)}</option>`).join('')}</optgroup>`; }
    const cs = contasAbertasDoMes();
    if (cs.length){ n += cs.length; html += `<optgroup label="Pagar conta de ${esc(MONTHS[state.m])}">${cs.map(i => `<option value="c:${esc(i.c.id)}">${esc(i.c.nome)}${i.n ? ` ${i.n}/${i.c.parcelas}` : ''} · falta ${brl(i.falta)}</option>`).join('')}</optgroup>`; }
  }   // entrada não usa "Usar para": retirar dinheiro de meta é feito na aba Metas
  sel.innerHTML = html;
  // sempre visível (não muda o lugar de nada); sem opções, fica travado em "Só lançamento"
  sel.disabled = n === 0;
  sel.title = n === 0 ? (state.type === 'exp' ? 'Crie uma meta ou conta a pagar para usar aqui.' : 'Em entradas o "Usar para" não se aplica.') : '';
  sel.value = [...sel.options].some(o => o.value === atual) ? atual : '';
  aplicarVinc(false);
  if ($('pagCom').options.length) aplicarPagCom();
  // travado: explica do lado por que e como liberar
  $('vincHint').classList.toggle('trava', n === 0);
  if (n === 0 && state.type === 'exp'){ $('vincHint').textContent = sel.title + ' Por enquanto, os lançamentos entram normalmente.'; $('vincHint').hidden = false; }
}
function vincAlvo(){
  const v = $('vinc').value; if (!v) return null;
  const k = v.slice(0, 1), id = v.slice(2);
  if (k === 'c'){ const c = findConta(id); return c ? { k, c, i: instancia(c, mkey(state.y, state.m)) } : null; }
  const m = state.metas.find(x => x.id === id); return m ? { k, m, i: infoMeta(m) } : null;
}
function aplicarVinc(mudou){
  const a = vincAlvo(), d = $('desc'), cat = $('cat'), hint = $('vincHint');
  if (!a){
    if (d.readOnly){ d.readOnly = false; if (d.value === d.dataset.auto) d.value = ''; }
    if (cat.disabled){ cat.disabled = false; fillCats(); }
    hint.hidden = true;
    return;
  }
  let nome, categoria, txt;
  if (a.k === 'c'){
    nome = a.c.nome + (a.i.n ? ` ${a.i.n}/${a.c.parcelas}` : ''); categoria = a.c.categoria;
    const minha = a.i.parts.find(p => p.uid === myId());
    const sugere = minha && minha.falta > 0 ? Math.min(minha.falta, a.i.falta) : a.i.falta;
    if (mudou && !$('amount').value.trim()) $('amount').value = num(sugere);
    txt = `Registra o pagamento da conta ${nome} (${MONTHS[state.m]}) e lança a saída. Falta pagar ${brl(a.i.falta)}.`;
  } else {
    const g = a.k === 'm';
    nome = (g ? 'Guardado: ' : 'Retirado: ') + a.m.nome; categoria = 'Metas';
    txt = g ? `Guarda o valor na meta ${a.m.nome} e lança a saída. Já tem ${brl(a.i.saldo)} de ${brl(Number(a.m.alvo))}.`
            : `Tira o valor da meta ${a.m.nome} e lança a entrada. Dá pra retirar até ${brl(a.i.saldo)}.`;
  }
  d.value = nome; d.dataset.auto = nome; d.readOnly = true;
  cat.innerHTML = `<option>${esc(categoria)}</option>`; cat.disabled = true;
  hint.textContent = txt; hint.hidden = false;
}
$('vinc').addEventListener('change', () => { $('error').hidden = true; aplicarVinc(true); });
$('date').value = todayISO();
['desc','amount'].forEach(id => $(id).addEventListener('input', () => { $('error').hidden = true; }));
function showError(msg){ $('error').textContent = msg; $('error').hidden = false; }

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const desc = $('desc').value.trim(), amount = parseAmount($('amount').value);
  if (!desc) return showError('Escreva uma descrição.');
  if (!(amount > 0)) return showError('Informe um valor maior que zero.');
  if (!state.cid) return showError('Escolha um controle primeiro.');
  if (!$('pagComWrap').hidden && findCartao($('pagCom').value)){ await salvarCompraForm(desc, amount); return; }
  const alvo = vincAlvo();
  if (alvo){
    const data = $('date').value || todayISO();
    $('addBtn').disabled = true;
    const res = alvo.k === 'c'
      ? await sb.rpc('pagar_conta', { conta: alvo.c.id, p_mes: mkey(state.y, state.m), p_valor: amount, p_data: data })
      : await sb.rpc('mover_meta', { meta: alvo.m.id, p_tipo: alvo.k === 'm' ? 'guardar' : 'retirar', p_valor: amount, p_data: data, p_lancar: true });
    $('addBtn').disabled = false;
    if (res.error) return showError(rpcMsg(res.error));
    $('amount').value = ''; $('vinc').value = ''; aplicarVinc(false);
    toast(alvo.k === 'c' ? `Pagamento de ${brl(amount)} registrado na conta ${alvo.c.nome}.`
      : alvo.k === 'm' ? `${brl(amount)} guardados na meta ${alvo.m.nome}.` : `${brl(amount)} retirados da meta ${alvo.m.nome}.`, true);
    await refresh();
    if (alvo.k === 'm' && !alvo.i.done){ const m2 = findMeta(alvo.m.id); if (m2 && infoMeta(m2).done) comemorar(m2.id); }
    return;
  }
  const entry = { type: state.type, desc, cat: $('cat').value, amount, date: $('date').value || todayISO() };
  const id = novoId();   // o app cria o id: se o envio repetir, o banco recusa o 2º e nunca duplica
  if (!navigator.onLine) return guardarSemInternet(id, entry);
  $('addBtn').disabled = true;
  const { data, error } = await sb.from('lancamentos').insert({ ...toRow(entry), id, controle_id: state.cid }).select(COLS).single();
  $('addBtn').disabled = false;
  if (error && ehRede(error)) return guardarSemInternet(id, entry);
  if (error) return showError('Não foi possível salvar. Tente de novo.');
  const [y,m] = entry.date.split('-').map(Number);
  $('desc').value = ''; $('amount').value = '';
  if (y === state.y && m - 1 === state.m){ state.entries.push(fromRow(data)); render(); }
  else { state.y = y; state.m = m - 1; await refresh(); }
  $('desc').focus();
});


/* ======================= SEM INTERNET =======================
   Lançamento feito sem internet fica guardado neste celular (fila) e aparece na lista com ⏳.
   Quando a conexão volta, o app envia sozinho. O id é criado aqui: se o envio repetir,
   o banco recusa o repetido (23505) e nada duplica. O app também guarda uma "foto" da
   conta e dos meses já abertos para conseguir abrir sem internet. */
let modoSemInternet = false, enviandoFila = false, mesNaTela = '';
const filaKey = () => `pof-fila-${currentUser ? currentUser.id : ''}`;
const fotoKey = () => `pof-foto-${currentUser ? currentUser.id : ''}`;
const cacheKey = () => `pof-cache-${currentUser ? currentUser.id : ''}`;
function ehRede(err){
  if (!navigator.onLine) return true;
  const t = String((err && (err.message || err.details || err.name)) || err || '');
  return /failed to fetch|network|load failed|fetch failed|timed? ?out|aborted/i.test(t);
}
function novoId(){
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function lerLS(k, padrao){ try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? padrao : v; } catch { return padrao; } }
function gravarLS(k, v){ try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
const lerFila = () => { const f = lerLS(filaKey(), []); return Array.isArray(f) ? f : []; };
const gravarFila = f => gravarLS(filaKey(), f.length ? f : null);
// meses já abertos (os 6 mais recentes), para mostrar a lista sem internet
function gravarCache(cid, y, m, rows){
  if (!currentUser) return;
  const c = lerLS(cacheKey(), {}), k = `${cid}|${y}-${m}`;
  delete c[k]; c[k] = rows;
  const ks = Object.keys(c); while (ks.length > 6) delete c[ks.shift()];
  gravarLS(cacheKey(), c);
}
// guarda o mês que está na tela (sem os da fila), para abrir igual sem internet
function cacheDaTela(){
  if (!currentUser || !state.cid || mesNaTela !== `${state.cid}|${state.y}-${state.m}`) return;   // só o mês que já carregou
  gravarCache(state.cid, state.y, state.m, state.entries.filter(e => !e.pend)
    .map(e => ({ id: e.id, tipo: e.type, descricao: e.desc, categoria: e.cat, valor: e.amount, data: e.date, user_id: e.uid })));
}
const lerCache = (cid, y, m) => (lerLS(cacheKey(), {}) || {})[`${cid}|${y}-${m}`] || null;
function gravarFoto(){
  if (!currentUser || !profile || modoSemInternet) return;
  gravarLS(fotoKey(), { profile, controles: state.controles, cid: state.cid, categorias, em: Date.now() });
}
// abre o app com a última foto (só se a conta já tinha aberto neste celular)
async function abrirSemInternet(){
  const f = lerLS(fotoKey(), null);
  if (!f || !f.profile || f.profile.status !== 'aprovado' || f.profile.is_admin || !Array.isArray(f.controles) || !f.controles.length) return false;
  modoSemInternet = true;
  profile = f.profile; state.controles = f.controles; categorias = f.categorias || [];
  state.cid = f.controles.some(c => c.id === f.cid) ? f.cid : f.controles[0].id;
  renderMe();
  await loadEntries();
  fillCats(); show('viewApp'); render(); atualizarFaixa();
  return true;
}
// mostra na lista do mês os lançamentos que ainda estão na fila
function juntarFila(){
  if (!currentUser) return;
  const ids = new Set(state.entries.map(e => e.id));
  for (const i of lerFila()){
    if (i.controle_id !== state.cid || ids.has(i.id)) continue;
    const [y, m] = i.row.data.split('-').map(Number);
    if (y !== state.y || m - 1 !== state.m) continue;
    state.entries.push({ ...fromRow({ ...i.row, id: i.id, user_id: currentUser.id }), pend: true });
  }
}
function guardarSemInternet(id, entry){
  const f = lerFila();
  f.push({ id, controle_id: state.cid, row: toRow(entry), em: Date.now() });
  gravarFila(f);
  $('addBtn').disabled = false;
  $('desc').value = ''; $('amount').value = '';
  const [y, m] = entry.date.split('-').map(Number);
  if (y === state.y && m - 1 === state.m){ state.entries.push({ ...entry, id, uid: currentUser.id, pend: true }); render(); }
  atualizarFaixa();
  toast('Sem internet: guardado no celular. Envio quando a conexão voltar ⏳', true);
  $('desc').focus();
}
async function enviarFila(){
  if (enviandoFila || !navigator.onLine || !currentUser || !profile) return atualizarFaixa();
  if (modoSemInternet){ modoSemInternet = false; return handleSession((await sb.auth.getSession()).data.session, true); }   // abriu sem internet: carrega tudo de verdade
  const fila = lerFila();
  if (!fila.length) return atualizarFaixa();
  enviandoFila = true; atualizarFaixa();
  let enviados = 0, caiu = false;
  for (const i of fila){
    const { error } = await sb.from('lancamentos').insert({ ...i.row, id: i.id, controle_id: i.controle_id });
    if (error && error.code !== '23505' && ehRede(error)){ caiu = true; break; }   // a internet caiu de novo: tenta depois
    if (error && error.code !== '23505') toast(`Não deu para enviar "${i.row.descricao}": ${rpcMsg(error)}`);
    else enviados++;
    gravarFila(lerFila().filter(x => x.id !== i.id));
  }
  enviandoFila = false;
  if (enviados){ toast(`${plural(enviados, 'lançamento')} guardado${enviados > 1 ? 's' : ''} sem internet ${enviados > 1 ? 'foram enviados' : 'foi enviado'} ✅`, true); await refresh(); }
  atualizarFaixa();
  if (caiu) setTimeout(enviarFila, 15000);
}
function atualizarFaixa(){
  const bar = $('offBar'); if (!bar) return;
  const n = currentUser ? lerFila().length : 0;
  const off = !navigator.onLine || modoSemInternet;
  bar.hidden = !(off || n);
  bar.classList.toggle('enviando', !off);
  bar.textContent = off
    ? `Sem internet. Pode lançar normalmente: ${n ? `${plural(n, 'lançamento')} aguardando, ` : ''}envio quando a conexão voltar.`
    : `Enviando ${plural(n, 'lançamento')} guardado${n > 1 ? 's' : ''} sem internet…`;
}
addEventListener('online', () => enviarFila());
addEventListener('offline', () => atualizarFaixa());
setInterval(() => { if (navigator.onLine && (modoSemInternet || lerFila().length)) enviarFila(); }, 30000);

/* ======================= LANÇAR RÁPIDO (voz, texto colado, extrato do banco) =======================
   Usa o mesmo "entendedor" do Detetive Grana (entender.js, gerado de supabase/functions/_fonte).
   Nada é salvo sem a pessoa conferir a lista. Grátis: nada sai do aparelho além do lançamento. */
const PE = () => window.PofEntender;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rp = { aba: 'texto', itens: [], aviso: '', ouvindo: null, arquivo: '', ia: null, lendo: false, gravador: null };
let dicDetetive = null;
async function carregarDic(){
  if (dicDetetive) return dicDetetive;
  try { const { data, error } = await sb.from('bot_dicionario').select('termo,tipo,categoria').limit(300); dicDetetive = error ? [] : (data || []); }
  catch { dicDetetive = []; }
  return dicDetetive;
}
const catsCtl = () => categorias.filter(c => !c.oculta).map(c => ({ nome: c.nome, tipo: c.tipo }));
const catValida = (tipo, nome) => listaCats(tipo).includes(nome) ? nome : 'Outros';
function rpItem(o){ return { nota: o.nota || '', sel: !o.dup && !o.nota, type: o.type, desc: String(o.desc || '').slice(0, 200), amount: Math.round(o.amount * 100) / 100, date: o.date, cat: catValida(o.type, o.cat), dup: !!o.dup }; }

function openRapido(aba){
  if (!PE()) return toast('Não deu para abrir agora. Atualize a página.');
  if (!state.cid) return toast('Escolha um controle primeiro.');
  rp = { aba: aba === 'ia' && iaDisponivel ? 'ia' : 'extrato', itens: [], aviso: '', ouvindo: null, arquivo: '', ia: null, lendo: false, gravador: null };
  openDlg2('Lançar rápido', 'Do jeito mais fácil pra você', '', { tipo: 'rapido', largo: true });
  renderRapido();
  carregarDic();
  sb.rpc('ia_meu_saldo').then(r => { if (!r.error && r.data){ rp.ia = r.data; if (rp.aba === 'ia') renderRapido(); } }, () => {});
}
document.querySelectorAll('[data-rp-abrir]').forEach(b => b.addEventListener('click', () => openRapido(b.dataset.rpAbrir)));

function renderRapido(){
  if (dlg2.tipo !== 'rapido') return;
  const texto = $('rpTexto') ? $('rpTexto').value : '';
  const cel = (tipo, atual) => listaCats(tipo, atual).map(c => `<option value="${esc(c)}"${c === atual ? ' selected' : ''}>${esc(rotuloCat(c))}</option>`).join('');
  $('dlg2Body').innerHTML = `
    ${iaDisponivel ? `<div class="seg rp-abas" role="group" aria-label="Como lançar">
      <button type="button" data-rp-aba="ia" aria-pressed="${rp.aba === 'ia'}">Foto, PDF, áudio</button>
      <button type="button" data-rp-aba="extrato" aria-pressed="${rp.aba === 'extrato'}">Extrato</button>
    </div>` : ''}
    ${rp.aba === 'texto' ? `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <label for="rpTexto" class="hint">Fale, escreva ou cole a notificação do banco. Pode ser mais de um gasto.</label>
        <textarea class="input rp-texto" id="rpTexto" placeholder="Gastei 50 no mercado e 20 de Uber ontem">${esc(texto)}</textarea>
        <div class="rp-acoes">
          ${SR ? `<button class="btn btn-secondary btn-sm" type="button" data-rp="falar">${rp.ouvindo ? 'Parar' : '🎤 Falar'}</button>` : ''}
          ${rp.ouvindo ? '<span class="rp-ouvindo" role="status">Ouvindo…</span>' : ''}
          <button class="btn btn-primary btn-sm" type="button" data-rp="entender">Entender</button>
        </div>
        ${SR ? '' : '<p class="hint">Para falar, toque no microfone do teclado do celular.</p>'}
      </div>` : rp.aba === 'ia' ? `
      <div class="rp-arquivo">
        <b style="font-size:15px;">Foto da nota, print, PDF ou áudio</b>
        <span class="hint">A IA lê e mostra o que achou para você conferir. O arquivo não fica guardado.</span>
        <div class="rp-acoes">
          <button class="btn btn-secondary btn-sm" type="button" data-rp="ia-foto"${rp.lendo || rp.gravador ? ' disabled' : ''}>📷 Foto ou print</button>
          <button class="btn btn-secondary btn-sm" type="button" data-rp="ia-pdf"${rp.lendo || rp.gravador ? ' disabled' : ''}>📄 PDF</button>
          <button class="btn ${rp.gravador ? 'btn-danger' : 'btn-secondary'} btn-sm" type="button" data-rp="ia-gravar"${rp.lendo ? ' disabled' : ''}>${rp.gravador ? '⏹ Parar e ler' : '🎙️ Gravar áudio'}</button>
          <input type="file" id="rpIaArq" hidden>
        </div>
        ${rp.gravador ? '<span class="rp-ouvindo" role="status">Gravando… fale os gastos (até 1 minuto)</span>' : ''}
        ${rp.lendo ? '<span class="hint" role="status">🕵️ Lendo… isso leva alguns segundos.</span>' : ''}
        ${rp.ia ? `<span class="hint">Leituras este mês: <b>${rp.ia.usadas} de ${rp.ia.limite}</b>. Leitura feita por IA (Google Gemini).</span>` : ''}
      </div>` : `
      <div class="rp-arquivo">
        <b style="font-size:15px;">Extrato do banco (OFX ou CSV)</b>
        <span class="hint">No app do seu banco, exporte o extrato em OFX ou CSV e escolha o arquivo aqui. Ele é lido só neste aparelho.</span>
        <input type="file" id="rpArquivo" accept=".ofx,.csv,.txt,text/csv,application/x-ofx" class="input" style="padding:8px;">
        ${rp.arquivo ? `<span class="hint">Arquivo: <b>${esc(rp.arquivo)}</b></span>` : ''}
      </div>`}
    ${rp.aviso ? `<p class="hint" role="status" style="color:var(--text);">${rp.aviso}</p>` : ''}
    ${rp.itens.length ? `
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div class="rp-topo"><span>Confira antes de lançar. Toque para corrigir.</span>
          ${rp.aba === 'extrato' ? '<button class="btn btn-ghost btn-sm" type="button" data-rp="inverter">Inverter entradas e saídas</button>' : ''}</div>
        <div class="rp-lista">${rp.itens.map((i, k) => `
          <div class="rp-item${i.sel ? '' : ' off'}" data-k="${k}">
            <input type="checkbox" data-f="sel" aria-label="Lançar ${esc(i.desc)}"${i.sel ? ' checked' : ''}>
            <select class="input rp-tipo" data-f="type" aria-label="Tipo"><option value="exp"${i.type === 'exp' ? ' selected' : ''}>Saída</option><option value="inc"${i.type === 'inc' ? ' selected' : ''}>Entrada</option></select>
            <input class="input rp-desc" data-f="desc" value="${esc(i.desc)}" maxlength="200" aria-label="Descrição">
            <input class="input rp-valor" data-f="amount" inputmode="decimal" value="${esc(i.amount.toFixed(2).replace('.', ','))}" aria-label="Valor">
            <input class="input rp-data" data-f="date" type="date" value="${esc(i.date)}" aria-label="Data">
            <select class="input rp-cat" data-f="cat" aria-label="Categoria">${cel(i.type, i.cat)}</select>
            ${i.dup ? '<span class="rp-dup">Parece já lançado (mesmo valor e data). Marque se quiser lançar mesmo assim.</span>' : i.nota ? `<span class="rp-dup">${esc(i.nota)}</span>` : ''}
          </div>`).join('')}</div>
        <div class="rp-rodape" id="rpRodape"></div>
      </div>` : ''}`;
  rpRodape();
}
function rpRodape(){
  const el = $('rpRodape'); if (!el) return;
  const tot = rp.itens.filter(i => i.sel);
  const soma = tot.reduce((a, i) => a + (i.type === 'exp' ? -i.amount : i.amount), 0);
  el.innerHTML = `<span class="hint">${plural(tot.length, 'lançamento')} · saldo ${soma < 0 ? '−' : '+'}${brl(Math.abs(soma))}</span>
    <button class="btn btn-primary" type="button" data-rp="lancar"${tot.length ? '' : ' disabled'}>Lançar ${tot.length || ''}</button>`;
}

// texto → itens (frase inteira; se não der, linha por linha)
async function rpEntender(){
  const texto = ($('rpTexto').value || '').trim();
  if (!texto) return toast('Fale ou escreva o que quer lançar.');
  const E = PE(), hoje = todayISO(), dic = await carregarDic(), cats = catsCtl();
  let lancs = [], faltou = [], ignorados = 0;
  const tentar = t => {
    const r = E.entender(t, hoje, cats, dic);
    if (r.tipo === 'lancar') { lancs.push(...r.lancs); return true; }
    if (r.tipo === 'perguntar' && r.falta === 'valor') faltou.push(r.rotulo);
    return false;
  };
  if (!tentar(texto)) for (const l of texto.split(/\n+/).map(x => x.trim()).filter(Boolean)) if (!tentar(l)) ignorados++;
  rp.itens.push(...lancs.map(l => rpItem({ type: l.tipo, desc: l.descricao, amount: l.valor, date: l.data, cat: l.categoria })));
  rp.aviso = !lancs.length
    ? (faltou.length ? `Faltou o valor de <b>${esc(faltou.join(', '))}</b>. Tente "${esc(faltou[0])} 50".` : 'Não entendi. Tente algo como <b>Mercado 50</b> ou <b>Recebi 200 de freela</b>.')
    : (ignorados ? `Entendi ${plural(lancs.length, 'lançamento')}. Algumas partes ficaram de fora.` : '');
  if (lancs.length) $('rpTexto').value = '';
  renderRapido();
}

function rpFalar(){
  if (rp.ouvindo){ try { rp.ouvindo.stop(); } catch {} return; }
  const rec = new SR(); rec.lang = 'pt-BR'; rec.interimResults = false; rec.continuous = false;
  rec.onresult = e => {
    const t = [...e.results].map(r => r[0].transcript).join(' ').trim();
    const ta = $('rpTexto'); if (ta && t) ta.value = (ta.value ? ta.value.trim() + '\n' : '') + t;
  };
  rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Libere o microfone para o app nas configurações do navegador.'); };
  rec.onend = () => { const tinha = $('rpTexto') && $('rpTexto').value.trim(); rp.ouvindo = null; renderRapido(); if (tinha) rpEntender(); };
  rp.ouvindo = rec; renderRapido();
  try { rec.start(); } catch { rp.ouvindo = null; renderRapido(); }
}

/* ---------- leitura de extrato ---------- */
function numBanco(v){
  let s = String(v || '').replace(/R\$|\s| /g, '');
  if (!s) return NaN;
  let neg = /^-|^\(.*\)$|-$|D$/i.test(s);
  s = s.replace(/[()\-+CD]/gi, '');
  const ul = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (s.includes(',') && s.includes('.')) s = s.slice(0, ul).replace(/[.,]/g, '') + '.' + s.slice(ul + 1);
  else if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isNaN(n) ? NaN : (neg ? -n : n);
}
function dataBanco(v){
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (m){ const a = m[3].length === 2 ? '20' + m[3] : m[3]; return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return '';
}
function descBonita(d){
  let t = String(d || '').replace(/\s+/g, ' ').trim();
  // "Compra no débito - UBER *TRIP" → "UBER *TRIP"
  const m = t.match(/^(compra no (debito|débito|credito|crédito)|compra|transfer[eê]ncia (recebida|enviada)( pelo pix)?|pagamento de boleto efetuado|pagamento efetuado|pix (enviado|recebido)|d[eé]bito autom[aá]tico|pagamento)\s+-\s+(.+)$/i);
  if (m) t = m[m.length - 1];
  t = t.slice(0, 80);
  if (t && t === t.toUpperCase()) t = t.toLowerCase().replace(/(^|[\s*\/-])([a-zà-ú])/g, (x, a, b) => a + b.toUpperCase());
  return t || 'Sem descrição';
}
function lerOFX(txt){
  return txt.split(/<STMTTRN>/i).slice(1).map(b => {
    const tag = n => ((b.match(new RegExp(`<${n}>([^<\\r\\n]*)`, 'i')) || [])[1] || '').trim();
    const v = numBanco(tag('TRNAMT').replace(',', '.'));
    return { valor: v, data: dataBanco(tag('DTPOSTED')), desc: tag('MEMO') || tag('NAME') || tag('PAYEE') };
  });
}
function linhasCSV(txt, sep){
  const out = []; let lin = [], cel = '', q = false;
  for (let i = 0; i < txt.length; i++){
    const c = txt[i];
    if (q){ if (c === '"'){ if (txt[i + 1] === '"'){ cel += '"'; i++; } else q = false; } else cel += c; continue; }
    if (c === '"') q = true; else if (c === sep){ lin.push(cel); cel = ''; }
    else if (c === '\n' || c === '\r'){ if (c === '\r' && txt[i + 1] === '\n') i++; lin.push(cel); out.push(lin); lin = []; cel = ''; }
    else cel += c;
  }
  if (cel || lin.length){ lin.push(cel); out.push(lin); }
  return out.filter(l => l.some(x => x.trim()));
}
function lerCSV(txt){
  const l1 = txt.split(/\r?\n/).slice(0, 5).join('\n');
  const sep = (l1.match(/;/g) || []).length > (l1.match(/,/g) || []).length ? ';' : ((l1.match(/\t/g) || []).length > 2 ? '\t' : ',');
  const rows = linhasCSV(txt, sep);
  const n = x => PE().norm(x || '');
  let h = rows.findIndex(r => r.some(c => /^(data|date|dt)/.test(n(c))) && r.some(c => /(valor|amount|value|quantia)/.test(n(c))));
  if (h < 0) return { itens: [], cartao: false };
  const cab = rows[h].map(n);
  const iData = cab.findIndex(c => /^(data|date|dt)/.test(c));
  const iValor = cab.findIndex(c => /(valor|amount|value|quantia)/.test(c) && !/saldo/.test(c));
  // coluna da descrição: na ordem de preferência (Nubank tem "Identificador" antes de "Descrição"; Inter tem "Histórico" e "Descrição")
  const achar = re => cab.findIndex(c => re.test(c) && !/^(data|date)/.test(c));
  const iDesc = [/descri/, /title|titulo/, /estabelecimento/, /memo/, /histor/, /lancamento|detalhe|nome/].map(achar).find(i => i >= 0) ?? -1;
  const iHist = achar(/histor/);
  const itens = rows.slice(h + 1).map(r => ({ valor: numBanco(r[iValor]), data: dataBanco(r[iData]),
    desc: (iDesc >= 0 && (r[iDesc] || '').trim()) ? r[iDesc] : (iHist >= 0 ? r[iHist] : '') }));
  const cartao = cab.includes('title') || cab.some(c => /fatura|cartao/.test(c)) || !itens.some(i => i.valor < 0);
  return { itens, cartao };
}
async function rpArquivo(file){
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast('Arquivo grande demais (máximo 5 MB).');
  rp.arquivo = file.name; rp.aviso = 'Lendo o extrato…'; renderRapido();
  const buf = await file.arrayBuffer();
  let txt = new TextDecoder('utf-8').decode(buf);
  if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(buf);   // extrato antigo em Latin-1
  const ofx = /<OFX>|<STMTTRN>/i.test(txt);
  let { itens, cartao } = ofx ? { itens: lerOFX(txt), cartao: false } : lerCSV(txt);
  itens = itens.filter(i => i.data && isFinite(i.valor) && i.valor !== 0);
  if (!itens.length){ rp.itens = []; rp.aviso = 'Não consegui ler esse arquivo. Exporte o extrato em <b>OFX</b> ou <b>CSV</b> no app do banco e tente de novo.'; return renderRapido(); }
  let cortados = 0;
  if (itens.length > 300){ itens.sort((a, b) => b.data.localeCompare(a.data)); cortados = itens.length - 300; itens = itens.slice(0, 300); }
  const dic = await carregarDic(), cats = catsCtl(), E = PE();
  // o que já está lançado no controle (mesmo tipo, valor e data com até 1 dia de diferença)
  const datas = itens.map(i => i.data).sort();
  const dia = (iso, d) => { const x = new Date(iso + 'T12:00:00'); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
  const { data: ja } = await sb.from('lancamentos').select('tipo,valor,data').eq('controle_id', state.cid).gte('data', dia(datas[0], -1)).lte('data', dia(datas[datas.length - 1], 1)).limit(2000);
  const usados = new Set();
  rp.itens = itens.map(i => {
    const type = cartao ? (i.valor > 0 ? 'exp' : 'inc') : (i.valor < 0 ? 'exp' : 'inc');
    const amount = Math.abs(i.valor), desc = descBonita(i.desc);
    const k = (ja || []).findIndex((r, j) => !usados.has(j) && r.tipo === type && Math.abs(Number(r.valor) - amount) < 0.005 &&
      Math.abs((new Date(r.data) - new Date(i.data)) / 864e5) <= 1);
    if (k >= 0) usados.add(k);
    // na fatura do cartão, o pagamento da própria fatura não é entrada de dinheiro
    const nota = cartao && type === 'inc' && /pagamento|pgto/i.test(desc) ? 'Pagamento da fatura: normalmente não precisa lançar.' : '';
    return rpItem({ type, desc, amount, date: i.data, cat: E.categorizar(desc, type, cats, dic), dup: k >= 0, nota });
  }).sort((a, b) => b.date.localeCompare(a.date));
  const dups = rp.itens.filter(i => i.dup).length;
  rp.aviso = `${rp.itens.length} ${rp.itens.length === 1 ? 'movimentação' : 'movimentações'} no extrato${dups ? ` · ${dups} parece${dups > 1 ? 'm' : ''} já lançada${dups > 1 ? 's' : ''} (desmarcada${dups > 1 ? 's' : ''})` : ''}${cortados ? ` · só as 300 mais recentes (${cortados} ficaram de fora)` : ''}.`;
  renderRapido();
}

/* ---------- foto, PDF e áudio pela IA (função "leitor" no Supabase) ---------- */
async function reduzirImagem(file){
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, erro) => { const i = new Image(); i.onload = () => ok(i); i.onerror = erro; i.src = url; });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
  } catch { return null; }
  finally { URL.revokeObjectURL(url); }
}
// áudio gravado → WAV 16 kHz mono (formato que a IA lê em qualquer celular)
async function paraWav(blob){
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const dec = await ctx.decodeAudioData(await blob.arrayBuffer());
    const taxa = 16000, n = Math.ceil(dec.duration * taxa);
    const off = new OfflineAudioContext(1, n, taxa); const src = off.createBufferSource(); src.buffer = dec; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const buf = new ArrayBuffer(44 + pcm.length * 2), v = new DataView(buf);
    const txt = (o, t) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    txt(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); txt(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, taxa, true); v.setUint32(28, taxa * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++){ const x = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
    return new Blob([buf], { type: 'audio/wav' });
  } finally { ctx.close && ctx.close(); }
}
const paraB64 = blob => new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = erro; r.readAsDataURL(blob); });

async function rpEnviarIA(blob, mime){
  if (!blob || !blob.size) return toast('Não consegui abrir esse arquivo.');
  if (blob.size > 5 * 1024 * 1024) return toast('Arquivo grande demais (máximo 5 MB).');
  rp.lendo = true; rp.aviso = ''; renderRapido();
  try {
    const cats = { exp: listaCats('exp'), inc: listaCats('inc') };
    const { data, error } = await sb.functions.invoke('leitor', { body: { mime, dados: await paraB64(blob), hoje: todayISO(), cats } });
    let r = data;
    if (error){ try { r = await error.context.json(); } catch { r = { erro: ehRede(error) ? 'rede' : 'falhou' }; } }
    if (r && r.limite != null && r.restam != null) rp.ia = { usadas: r.limite - r.restam, limite: r.limite };
    const MSG = { sem_saldo: `Suas ${r?.limite ?? ''} leituras de IA deste mês acabaram. Lance pelo formulário ou pelo extrato (sem limite), ou espere o dia 1º.`,
      sem_ia: 'A leitura por IA ainda não está ligada. Por enquanto, use o extrato.', nao_liberado: 'A leitura por IA ainda não foi liberada para a sua conta.', login: 'Sua sessão expirou. Entre de novo.',
      nao_aprovado: 'Sua conta ainda não foi liberada.', tipo: 'Esse tipo de arquivo não dá para ler. Use foto, PDF ou áudio.',
      tamanho: 'Arquivo grande demais (máximo 5 MB).', rede: 'Sem internet. A leitura por IA precisa de conexão.' };
    if (!r || r.erro){ rp.aviso = MSG[r?.erro] || 'Não consegui ler agora. Tente de novo daqui a pouco.'; return; }
    if (!r.itens.length){ rp.aviso = 'Não achei nenhum valor. Tente uma foto mais nítida, ou escreva o gasto (não gastou sua leitura).'; return; }
    rp.itens.push(...r.itens.map(i => rpItem({ type: i.tipo, desc: i.descricao, amount: i.valor, date: i.data, cat: i.categoria,
      nota: i.confianca === 'baixa' ? 'A IA ficou em dúvida aqui: confira valor e data.' : '' })).map(i => ({ ...i, sel: true })));
    rp.aviso = `🕵️ A IA leu ${r.itens.length > 1 ? `${r.itens.length} lançamentos` : '1 lançamento'}. Confira antes de lançar.`;
  } catch { rp.aviso = 'Não consegui ler agora. Tente de novo daqui a pouco.'; }
  finally { rp.lendo = false; renderRapido(); }
}
async function rpIaArquivo(file){
  if (!file) return;
  if (file.type === 'application/pdf') return rpEnviarIA(file, 'application/pdf');
  if (file.type.startsWith('image/')){
    const menor = await reduzirImagem(file);
    return menor ? rpEnviarIA(menor, 'image/jpeg') : rpEnviarIA(file, file.type);   // HEIC que o navegador não abre vai como está
  }
  toast('Use foto, print ou PDF.');
}
async function rpGravar(){
  if (rp.gravador){ if (rp.gravador.state === 'recording') rp.gravador.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Este navegador não grava áudio. Use o microfone do teclado na aba "Texto ou voz".');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { return toast('Libere o microfone para o app nas configurações do navegador.'); }
  const rec = new MediaRecorder(stream), partes = [];
  rec.ondataavailable = e => { if (e.data.size) partes.push(e.data); };
  rec.onstop = async () => {
    stream.getTracks().forEach(t => t.stop()); clearTimeout(rp.gravaFim); rp.gravador = null;
    const bruto = new Blob(partes, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
    if (bruto.size < 2000){ renderRapido(); return toast('Não ouvi nada. Tente de novo falando perto do celular.'); }
    let wav = null; try { wav = await paraWav(bruto); } catch {}
    rpEnviarIA(wav || bruto, wav ? 'audio/wav' : bruto.type);
  };
  rec.start(); rp.gravador = rec;
  rp.gravaFim = setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 60000);
  renderRapido();
}

async function rpLancar(){
  const sel = rp.itens.filter(i => i.sel);
  const ruim = sel.find(i => !i.desc.trim() || !(i.amount > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(i.date));
  if (ruim) return toast(`Confira "${ruim.desc || 'sem descrição'}": falta descrição, valor ou data.`);
  const rows = sel.map(i => ({ ...toRow({ type: i.type, desc: i.desc.trim(), cat: i.cat, amount: i.amount, date: i.date }), id: novoId(), controle_id: state.cid }));
  const b = document.querySelector('[data-rp="lancar"]'); if (b) b.disabled = true;
  for (let k = 0; k < rows.length; k += 200){
    const { error } = await sb.from('lancamentos').insert(rows.slice(k, k + 200));
    if (error){ if (b) b.disabled = false; return showError(`Não deu para lançar${k ? ` (${k} já foram)` : ''}. ${ehRede(error) ? 'Sem internet.' : 'Tente de novo.'}`); }
  }
  closeDlg2();
  toast(`${plural(rows.length, 'lançamento')} ${rows.length > 1 ? 'feitos' : 'feito'} ✅`, true);
  await refresh();
}

$('dlg2Body').addEventListener('click', e => {
  if (dlg2.tipo !== 'rapido') return;
  const aba = e.target.closest('[data-rp-aba]');
  if (aba){ if (rp.ouvindo) try { rp.ouvindo.stop(); } catch {} if (rp.gravador || rp.lendo) return; rp.aba = aba.dataset.rpAba; rp.aviso = ''; return renderRapido(); }
  const b = e.target.closest('[data-rp]'); if (!b) return;
  if (b.dataset.rp === 'ia-foto' || b.dataset.rp === 'ia-pdf'){
    const inp = $('rpIaArq'); inp.accept = b.dataset.rp === 'ia-pdf' ? 'application/pdf,.pdf' : 'image/*'; inp.value = ''; inp.click(); return;
  }
  if (b.dataset.rp === 'ia-gravar') return rpGravar();
  if (b.dataset.rp === 'entender') rpEntender();
  else if (b.dataset.rp === 'falar') rpFalar();
  else if (b.dataset.rp === 'lancar') rpLancar();
  else if (b.dataset.rp === 'inverter'){ rp.itens.forEach(i => { i.type = i.type === 'exp' ? 'inc' : 'exp'; i.cat = catValida(i.type, PE().categorizar(i.desc, i.type, catsCtl(), dicDetetive || [])); }); renderRapido(); }
});
$('dlg2Body').addEventListener('change', e => {
  if (dlg2.tipo !== 'rapido') return;
  if (e.target.id === 'rpArquivo') return rpArquivo(e.target.files[0]);
  if (e.target.id === 'rpIaArq') return rpIaArquivo(e.target.files[0]);
  const row = e.target.closest('.rp-item'); if (!row) return;
  const i = rp.itens[Number(row.dataset.k)], f = e.target.dataset.f; if (!i || !f) return;
  // atualiza só o que mudou (redesenhar tudo faria perder o toque no próximo campo)
  if (f === 'sel'){ i.sel = e.target.checked; row.classList.toggle('off', !i.sel); }
  else if (f === 'amount'){ const v = PE().lerValor(e.target.value) ?? numBanco(e.target.value); i.amount = v > 0 ? Math.round(v * 100) / 100 : 0; e.target.value = i.amount.toFixed(2).replace('.', ','); }
  else if (f === 'type'){
    i.type = e.target.value; i.cat = catValida(i.type, PE().categorizar(i.desc, i.type, catsCtl(), dicDetetive || []));
    row.querySelector('[data-f="cat"]').innerHTML = listaCats(i.type, i.cat).map(c => `<option value="${esc(c)}"${c === i.cat ? ' selected' : ''}>${esc(rotuloCat(c))}</option>`).join('');
  }
  else i[f] = e.target.value;
  rpRodape();
});
$('dlg2Body').addEventListener('keydown', e => { if (dlg2.tipo === 'rapido' && e.target.id === 'rpTexto' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); rpEntender(); } });

/* ======================= IMPOSTÔMETRO =======================
   Estimativa do imposto embutido nos gastos do mês, por média de cada categoria.
   É aproximado: o imposto real muda de produto para produto e de estado para estado.
   Revisar as médias de tempos em tempos (reforma tributária muda as alíquotas até 2033). */
// Médias com base nas tabelas do IBPT/Impostômetro (ex.: arroz/feijão 17%, carne 29%, higiene ~40%, luz 48%,
// telefone 46%, água 24%, restaurante 32%, cinema 21%, ônibus 34%, remédio 34%, escola 26%).
const IMPOSTO_CAT = { 'Mercado': .25, 'Alimentação': .32, 'Lazer': .30, 'Contas': .40, 'Transporte': .35, 'Saúde': .30, 'Moradia': .07,
  'Educação': .26, 'Cartão de crédito': .30, 'Outros': .27 };
const IMPOSTO_PADRAO = .27;   // categorias criadas pela pessoa
const IMPOSTO_FORA = new Set(['Metas']);   // guardar em meta não é gasto
const impKey = () => `pof-imp-${currentUser ? currentUser.id : ''}`;
let impComo = false;
function renderImposto(month, inc){
  const gastos = month.filter(e => e.type === 'exp' && !IMPOSTO_FORA.has(e.cat));
  const btn = $('btnImp'), card = $('impCard');
  if (!gastos.length){ btn.hidden = true; card.hidden = true; return; }
  const por = {}; let tot = 0, gasto = 0;
  for (const e of gastos){ const t = e.amount * (IMPOSTO_CAT[e.cat] ?? IMPOSTO_PADRAO); por[e.cat] = (por[e.cat] || 0) + t; tot += t; gasto += e.amount; }
  const top = Object.entries(por).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const max = top[0][1] || 1;
  let aberto = false; try { aberto = localStorage.getItem(impKey()) === '1'; } catch {}
  btn.hidden = false;
  btn.setAttribute('aria-expanded', String(aberto));
  $('btnImpTxt').textContent = `Impostos R$ ${Math.round(tot).toLocaleString('pt-BR')}`;
  card.hidden = !aberto;
  if (!aberto) return;
  const usadas = [...new Set([...Object.keys(IMPOSTO_CAT), ...Object.keys(por)])].filter(c => por[c] != null);
  const pct = Math.round(tot / gasto * 100);
  card.innerHTML = `
    <div class="imp-top"><span class="ic" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg></span><b>Impostômetro</b><span class="imp-tag">Estimativa</span></div>
    <div class="imp-corpo">
      <div class="imp-total"><span class="k">Imposto embutido nos seus gastos de ${esc(MONTHS[state.m].toLowerCase())}</span><span class="v">${brl(tot)}</span>
        <div class="imp-chips"><span><b>${pct}%</b> do que você gastou</span></div></div>
      <div class="imp-cats"><span class="k">Onde mais pesou</span>${top.map(([c, v]) => `<div class="imp-row"><div class="l">${esc(rotuloCat(c))} <small title="Média de imposto da categoria">${Math.round((IMPOSTO_CAT[c] ?? IMPOSTO_PADRAO) * 100)}%</small><b>${brl(v)}</b></div><span class="bar"><i style="width:${Math.max(4, Math.round(v / max * 100))}%"></i></span></div>`).join('')}</div>
    </div>
    <div class="imp-aviso"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg><span>Valor aproximado, calculado com médias por categoria. O imposto real muda de produto para produto e de estado para estado. <button type="button" id="impComoBtn" aria-expanded="${impComo}">Como calculamos?</button></span></div>
    ${impComo ? `<div class="imp-como">Usamos a média de impostos (ICMS, PIS/Cofins, IPI, ISS…) que costuma vir no preço de cada tipo de gasto e multiplicamos pelo que você gastou em cada categoria. Não entra o imposto sobre o salário (IR e INSS).
      <table>${usadas.map(c => `<tr><td>${esc(rotuloCat(c))}</td><td>${Math.round((IMPOSTO_CAT[c] ?? IMPOSTO_PADRAO) * 100)}%</td></tr>`).join('')}</table></div>` : ''}`;
}
$('btnImp').onclick = () => {
  const abrir = $('btnImp').getAttribute('aria-expanded') !== 'true';
  try { localStorage.setItem(impKey(), abrir ? '1' : '0'); } catch {}
  render();
};
$('impCard').addEventListener('click', e => { if (e.target.closest('#impComoBtn')){ impComo = !impComo; render(); } });

/* ======================= FILTRO ENTRADAS / SAÍDAS ======================= */
state.filtro = null;
function toggleFiltro(f){ state.filtro = state.filtro === f ? null : f; state.filtroCat = null; render(); }
document.querySelectorAll('.stat-filtro').forEach(el => {
  el.addEventListener('click', () => toggleFiltro(el.dataset.filtro));
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggleFiltro(el.dataset.filtro); } });
});
$('filtroLimpar').onclick = () => { state.filtro = null; state.filtroCat = null; render(); };
// "Para onde foi": tocar numa categoria mostra só os lançamentos dela (tocar de novo volta a mostrar tudo)
state.filtroCat = null;
$('cats').addEventListener('click', e => {
  const b = e.target.closest('[data-cat-filtro]'); if (!b) return;
  state.filtroCat = state.filtroCat === b.dataset.catFiltro ? null : b.dataset.catFiltro;
  state.filtro = null;
  render();
  if (state.filtroCat && innerWidth <= 900) $('tableWrap').closest('div.span2').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ======================= NAVEGAÇÃO ======================= */
function shift(n){ const d = new Date(state.y, state.m + n, 1); state.y = d.getFullYear(); state.m = d.getMonth(); render(); refresh(); }
$('prev').onclick = () => shift(-1);
$('next').onclick = () => shift(1);
$('today').onclick = () => { const d = new Date(); state.y = d.getFullYear(); state.m = d.getMonth(); render(); refresh(); };
$('rows').addEventListener('click', async e => {
  const ed = e.target.closest('[data-edit]');
  if (ed) return openLancEdit(ed.dataset.edit);
  const b = e.target.closest('[data-del]');
  if (!b) return;
  const id = b.dataset.del;
  const ent = state.entries.find(x => x.id === id);
  if (ent && ent.pend){   // ainda não foi enviado: só tira da fila deste celular
    if (!await confirmar(`Excluir "${ent.desc}"? Ele ainda não foi enviado.`)) return;
    gravarFila(lerFila().filter(i => i.id !== id)); state.entries = state.entries.filter(x => x.id !== id); render(); atualizarFaixa(); return;
  }
  if (ent && !await confirmar(`Excluir este lançamento?

${ent.desc} · ${ent.type === 'inc' ? '+' : '−'} ${brl(ent.amount)}`)) return;
  const before = state.entries;
  state.entries = state.entries.filter(x => x.id !== id);
  render();
  const { error, count } = await sb.from('lancamentos').delete({ count: 'exact' }).eq('id', id);
  if (error || count === 0){ state.entries = before; render(); toast('Não foi possível excluir. Tente de novo.'); return; }
  if (state.contas.length && await loadContas()) renderContas();   // se era o pagamento de uma conta, ela volta a ficar em aberto
});

/* ---------- editar um lançamento (lápis) ---------- */
async function openLancEdit(id){
  const ent = state.entries.find(x => x.id === id); if (!ent) return;
  // lançamentos criados por pagamento de conta ou por meta mudam por lá, para os valores não ficarem diferentes
  const [pg, mm] = await Promise.all([
    sb.from('pagamentos').select('conta_id').eq('lancamento_id', id).limit(1),
    sb.from('meta_movs').select('meta_id').eq('lancamento_id', id).limit(1)
  ]);
  if (pg.data && pg.data.length){ const c = findConta(pg.data[0].conta_id); return toast(`Esse lançamento é o pagamento da conta ${c ? '"' + c.nome + '"' : ''}. Para mudar, desfaça o pagamento na aba Contas a pagar.`); }
  if (mm.data && mm.data.length){ const m = state.metas.find(x => x.id === mm.data[0].meta_id); return toast(`Esse lançamento veio da meta ${m ? '"' + m.nome + '"' : ''}. Para mudar, desfaça o movimento na aba Metas.`); }
  const tipoBtn = (t, lab) => `<button type="button" data-letipo="${t}" aria-pressed="${ent.type === t}">${lab}</button>`;
  openDlg2('Editar lançamento', ent.desc, `
    <div class="seg" id="leTipo" role="group" aria-label="Tipo" style="align-self:flex-start;">${tipoBtn('exp','Saída')}${tipoBtn('inc','Entrada')}</div>
    <div class="field"><label for="leDesc">Descrição</label><input class="input" id="leDesc" maxlength="200" autocomplete="off" value="${esc(ent.desc)}"></div>
    <div class="grid2">
      <div class="field"><label for="leValor">Valor (R$)</label><input class="input" id="leValor" inputmode="numeric" data-dinheiro value="${num(ent.amount)}" style="font-variant-numeric:tabular-nums;"></div>
      <div class="field"><label for="leCat">Categoria</label><select class="input" id="leCat"></select></div>
    </div>
    <div class="field"><label for="leData">Data</label><input class="input" id="leData" type="date" value="${esc(ent.date)}"></div>
    <button class="btn btn-primary" type="button" data-act="leSalvar" style="min-height:44px;">Salvar alterações</button>`,
    { tipo: 'lancEdit', id, letipo: ent.type, cat: ent.cat });
  leCats();
}
function leCats(){
  const mesmoTipo = dlg2.letipo === (state.entries.find(x => x.id === dlg2.id) || {}).type;
  $('leCat').innerHTML = opcoesCat(dlg2.letipo, mesmoTipo ? dlg2.cat : null, false);
}
$('dlg2Body').addEventListener('click', async e => {
  if (dlg2.tipo !== 'lancEdit') return;
  const t = e.target.closest('[data-letipo]');
  if (t){ dlg2.letipo = t.dataset.letipo; document.querySelectorAll('#leTipo [data-letipo]').forEach(b => b.setAttribute('aria-pressed', String(b === t))); leCats(); return; }
  const b = e.target.closest('[data-act="leSalvar"]'); if (!b) return;
  const desc = $('leDesc').value.trim(), valor = parseAmount($('leValor').value), data = $('leData').value;
  if (!desc) return toast('Escreva uma descrição.');
  if (!(valor > 0)) return toast('Informe um valor maior que zero.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return toast('Escolha a data.');
  b.disabled = true;
  const novo = { type: dlg2.letipo, desc, cat: $('leCat').value, amount: valor, date: data };
  const { data: row, error } = await sb.from('lancamentos').update(toRow(novo)).eq('id', dlg2.id).select(colsLanc()).single();
  if (error || !row){ b.disabled = false; return toast('Não foi possível salvar. Tente de novo.'); }
  const i = state.entries.findIndex(x => x.id === dlg2.id);
  if (i >= 0) state.entries[i] = fromRow(row);
  closeDlg2();
  const [y, m] = data.split('-').map(Number);
  if (y !== state.y || m - 1 !== state.m){ toast(`Lançamento atualizado e movido para ${MONTHS[m - 1]} ${y}.`, true); await refresh(); }
  else { toast('Lançamento atualizado.', true); render(); }
});

$('ctrlSelect').addEventListener('change', async e => {
  selectControle(e.target.value);
  state.entries = []; state.members = []; state.contas = []; state.pags = []; state.partes = {}; state.cmeses = {}; state.metas = []; state.metaMovs = []; state.invs = []; state.invMovs = [];
  render();
  await loadMembers(); await refresh();
});
async function criarControle(nome){
  const { data, error } = await sb.rpc('criar_controle', { p_nome: nome.trim() });
  if (error) return toast(rpcMsg(error));
  await loadControles(); selectControle(data); await loadMembers(); await refresh();
  openManage();
}
$('ctrlNew').onclick = async () => {
  const nome = await pedirTexto('Novo controle', 'Um controle separado para dividir com outras pessoas (casal, família, viagem).',
    { rotulo: 'Nome', placeholder: 'Casa', okTxt: 'Criar controle' });
  if (nome === null) return;
  await criarControle(nome);
};
$('ctrlJoin').onclick = async () => {
  const cod = await pedirTexto('Entrar com código', 'Digite o código que a pessoa te mandou.', { rotulo: 'Código', placeholder: 'K7P4-QX9M', okTxt: 'Entrar' });
  if (cod === null) return;
  const { data, error } = await sb.rpc('entrar_com_codigo', { p_codigo: cod });
  if (error) return toast(rpcMsg(error));
  await loadControles(); selectControle(data); await loadMembers(); await refresh();
  const c = current(); toast(`Você entrou em "${c ? c.nome : 'controle'}".`);
};
$('ctrlManage').onclick = () => openManage();

$('invites').addEventListener('click', async e => {
  const b = e.target.closest('[data-inv]');
  if (!b) return;
  b.disabled = true;
  const aceitar = b.dataset.ok === '1';
  const { data, error } = await sb.rpc('responder_convite', { conv: b.dataset.inv, aceitar });
  if (error){ b.disabled = false; return toast(rpcMsg(error)); }
  await loadInvites();
  if (aceitar && data){
    await loadControles(); selectControle(data); await loadMembers(); await refresh();
    const c = current(); toast(`Agora você participa de "${c ? c.nome : 'controle'}".`);
  }
});

/* ======================= TEMPO REAL ======================= */
// Quando alguém do mesmo controle lança, apaga ou entra/sai, a tela atualiza sozinha.
let rtChan = null, rtTimer = null, rtOk = false;
function rtLater(fn){ clearTimeout(rtTimer); rtTimer = setTimeout(fn, 400); }
async function rtReloadEntries(){ if ($('viewApp').hidden) return; await loadMembers(); await refresh(); }
async function rtReloadAll(){
  if ($('viewApp').hidden) return;
  if (await loadControles()){ await loadMembers(); await refresh(); }
}
function startRealtime(){
  stopRealtime();
  if (!currentUser) return;
  rtChan = sb.channel('pof-' + currentUser.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lancamentos' }, p => {
      const n = p.new || {}, o = p.old || {};
      if (n.controle_id === state.cid || o.controle_id === state.cid || (o.id && state.entries.some(e => e.id === o.id)))
        rtLater(rtReloadEntries);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'membros' }, () => rtLater(rtReloadAll))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'convites' }, () => loadInvites())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'contas' }, () => rtContas())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conta_partes' }, () => rtContas())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conta_meses' }, () => rtContas())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pagamentos' }, () => rtContas())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'metas' }, () => rtMetas())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'meta_movs' }, () => rtMetas())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'investimentos' }, () => rtInvest())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'inv_movs' }, () => rtInvest())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cartoes' }, () => rtCartoes())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'compras_cartao' }, () => rtCartoes())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pag_faturas' }, () => rtCartoes())
    .subscribe(status => { rtOk = status === 'SUBSCRIBED'; });
}
let rtContasTimer = null, rtCartTimer = null;
function rtCartoes(){
  clearTimeout(rtCartTimer);
  rtCartTimer = setTimeout(async () => { if (!$('viewApp').hidden && await loadCartoes()) render(); }, 400);
}
function rtContas(){
  clearTimeout(rtContasTimer);
  rtContasTimer = setTimeout(async () => { if (!$('viewApp').hidden && await loadContas()) renderContas(); }, 400);
}
function stopRealtime(){
  if (rtChan){ sb.removeChannel(rtChan); rtChan = null; }
  rtOk = false;
}
// plano B: se o tempo real cair, confere a cada 30 s enquanto o app estiver aberto
setInterval(() => {
  if (!rtOk && document.visibilityState === 'visible' && profile && !$('viewApp').hidden) rtReloadEntries();
}, 30000);

// ao voltar para o app (ex.: trocou de aba ou de aparelho), busca os dados atualizados
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !profile || profile.status !== 'aprovado') return;
  if (!$('viewApp').hidden){
    if (await loadControles()){ await loadMembers(); await refresh(); }
    loadInvites();
  }
  if (!$('viewAdmin').hidden) loadUsers();
});

function renderInvites(){
  const list = state.invites || [];
  $('invites').hidden = list.length === 0;
  $('invites').innerHTML = list.map(v => `
    <div class="blueprint invite">
      <div style="min-width:0;">
        <span class="kicker" style="color:var(--accent-text);">Convite</span>
        <div style="font-weight:600;"><b>${esc(v.de_nome || displayName(v.de_login) || 'Alguém')}</b> te convidou para o controle <b>"${esc(v.controle_nome)}"</b></div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm" data-inv="${esc(v.id)}" data-ok="1">Aceitar</button>
        <button class="btn btn-secondary btn-sm" data-inv="${esc(v.id)}" data-ok="0">Recusar</button>
      </div>
    </div>`).join('');
}

function renderCtrlBar(){
  const c = current();
  $('ctrlSelect').innerHTML = state.controles.map(x =>
    `<option value="${esc(x.id)}"${x.id === state.cid ? ' selected' : ''}>${esc(x.nome)}${x.pessoal ? ' (pessoal)' : ''}</option>`).join('');
  $('ctrlManage').hidden = !c || c.pessoal;
  $('ctrlShare').hidden = !c || !c.pessoal;
  $('ctrlInfo').textContent = !c ? '' : c.pessoal
    ? 'Só você vê'
    : `Compartilhado · ${plural(c.participantes,'pessoa')}${c.sou_dono ? ' · você é o dono' : ''}`;
}

function render(){
  cacheDaTela();
  const {entries, y, m} = state;
  const ym = `${y}-${pad(m+1)}`;
  const month = entries.filter(e => e.date.startsWith(ym)).sort((a,b) => b.date.localeCompare(a.date));
  const expList = month.filter(e => e.type === 'exp');
  const inc = month.filter(e => e.type === 'inc').reduce((s,e) => s + e.amount, 0);
  const exp = expList.reduce((s,e) => s + e.amount, 0);
  const bal = inc - exp;
  const shared = isShared();

  renderImposto(month, inc);
  renderCtrlBar();
  $('mesLongo').textContent = `${MONTHS[m]} ${y}`;
  $('mesCurto').textContent = `${MONTHS[m].slice(0, 3)} ${y}`;
  { const d = new Date(); $('today').classList.toggle('mes-atual', y === d.getFullYear() && m === d.getMonth()); }
  $('incVal').textContent = brl(inc); $('incVal').classList.toggle('zero', !inc); $('incNote').textContent = plural(month.length - expList.length,'lançamento');
  $('expVal').textContent = brl(exp); $('expVal').classList.toggle('zero', !exp); $('expNote').textContent = plural(expList.length,'lançamento');
  $('balVal').textContent = brl(bal); $('balVal').classList.toggle('zero', !bal);
  $('balNote').textContent = !month.length ? 'Sem lançamentos'
    : bal >= 0 ? `Sobrou ${inc ? Math.round(bal/inc*100) : 0}% do que entrou` : 'Gastou mais do que entrou';
  $('balCard').classList.toggle('neg', bal < 0);
  $('balCard').classList.toggle('pos', bal > 0);   // saldo positivo verde, negativo vermelho

  const limit = state.budget;
  $('budget').hidden = !(limit > 0);
  if (limit > 0){
    $('budgetLimit').textContent = `Orçamento do mês · ${brl(limit)}`;
    $('budgetLabel').textContent = exp <= limit ? `Restam ${brl(limit - exp)}` : `Passou ${brl(exp - limit)}`;
    $('budgetFill').style.width = `${Math.min(100, exp/limit*100)}%`;
    $('budgetFill').style.background = exp > limit ? 'var(--red)' : 'var(--accent)';
  }

  const pending = localPending().length;
  $('importLocal').hidden = !pending;
  $('importLocal').textContent = `Enviar ${plural(pending,'lançamento')} deste aparelho`;

  // filtro pelos cartões Entradas / Saídas (só a lista muda)
  const f = state.filtro;
  document.querySelectorAll('.stat-filtro').forEach(el => {
    const on = el.dataset.filtro === f;
    el.classList.toggle('on', on); el.setAttribute('aria-pressed', String(on));
  });
  const fc = state.filtroCat;
  $('filtroInfo').hidden = !f && !fc;
  $('filtroNome').textContent = fc ? rotuloCat(fc) : f === 'inc' ? 'entradas' : 'saídas';
  const shown = month.filter(e => (!f || e.type === f) && (!fc || (e.cat === fc && e.type === 'exp')));
  $('tableWrap').hidden = shown.length === 0;
  $('empty').hidden = shown.length > 0;
  $('empty').textContent = fc ? `Nenhum gasto em ${rotuloCat(fc)} neste mês.` : !f ? 'Nenhum lançamento neste mês. Use o formulário acima para adicionar o primeiro.'
    : f === 'inc' ? 'Nenhuma entrada neste mês.' : 'Nenhuma saída neste mês.';
  $('rows').innerHTML = shown.map(e => {
    const mine = currentUser && e.uid === currentUser.id;
    return `
    <tr>
      <td style="color:var(--muted);">${e.date.slice(8,10)}/${e.date.slice(5,7)}</td>
      <td><span class="ldesc">${esc(e.desc)}</span>${origemSelo(e, 'd')}${shared ? `<div class="by">por ${esc(nameOf(e.uid))}</div>` : ''}<div class="lmeta">${e.date.slice(8,10)}/${e.date.slice(5,7)} · ${esc(rotuloCat(e.cat))}${shared ? ` · ${mine ? 'você' : esc(nameOf(e.uid))}` : ''}${origemSelo(e, 'm')}</div><span class="tag cat-inline ${e.type === 'inc' ? 'tag-green' : 'tag-neutral'}">${esc(rotuloCat(e.cat))}</span></td>
      <td><span class="tag ${e.type === 'inc' ? 'tag-green' : 'tag-neutral'}">${esc(rotuloCat(e.cat))}</span></td>
      <td style="text-align:right;white-space:nowrap;font-weight:500;color:${e.type === 'inc' ? 'var(--green)' : 'var(--out)'};">${e.type === 'inc' ? '+ ' : '− '}${brl(e.amount)}</td>
      <td style="text-align:right;white-space:nowrap;">${e.pend ? `<span class="pend-tag" title="Será enviado quando a internet voltar">⏳ aguardando</span><button class="btn btn-ghost btn-icon" data-del="${esc(e.id)}" style="color:var(--muted);" aria-label="Excluir ${esc(e.desc)}"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>` : mine ? `<button class="btn btn-ghost btn-icon" data-edit="${esc(e.id)}" style="color:var(--muted);" aria-label="Editar ${esc(e.desc)}"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button><button class="btn btn-ghost btn-icon" data-del="${esc(e.id)}" style="color:var(--muted);" aria-label="Excluir ${esc(e.desc)}"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>` : ''}</td>
    </tr>`;
  }).join('');

  // "Guardado: …" (dinheiro que foi para uma meta) não é gasto: fica fora do ranking e aparece separado
  const guardadoMeta = e => e.cat === 'Metas' && /^Guardado: /.test(e.desc);
  const gastos = expList.filter(e => !guardadoMeta(e));
  const guardadoMes = r2(expList.filter(guardadoMeta).reduce((s, e) => s + e.amount, 0));
  const totalGastos = r2(gastos.reduce((s, e) => s + e.amount, 0));
  const byCat = {};
  gastos.forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + e.amount; });
  const list = Object.entries(byCat).sort((a,b) => b[1] - a[1]);
  const max = list.length ? list[0][1] : 0;
  renderTabs();
  renderContas();
  renderCartoes();
  renderMetas();
  renderInvest();
  vincOpcoes();
  pagComOpcoes();
  const fcat = state.filtroCat;
  $('cats').classList.toggle('filtrando', !!fcat);
  $('cats').innerHTML = list.length ? list.map(([name,v]) => `
    <button type="button" class="cat-filtro${fcat === name ? ' on' : ''}" data-cat-filtro="${esc(name)}" aria-pressed="${fcat === name}" aria-label="Mostrar só ${esc(name)}">
      <div style="display:flex;justify-content:space-between;gap:var(--space-3);font-size:14px;">
        <span>${esc(rotuloCat(name))}</span>
        <span style="font-variant-numeric:tabular-nums;color:var(--muted);">${brl(v)} · ${Math.round(totalGastos ? v/totalGastos*100 : 0)}%</span>
      </div>
      <div style="height:6px;background:var(--track);border-radius:999px;overflow:hidden;"><div style="height:100%;width:${max ? v/max*100 : 0}%;background:var(--accent);border-radius:999px;"></div></div>
    </button>`).join('') : '<span style="font-size:14px;color:var(--muted);">Sem gastos neste mês.</span>';
  if (guardadoMes > 0) $('cats').insertAdjacentHTML('beforeend', `
    <div class="guardado-mes">
      <div style="display:flex;justify-content:space-between;gap:var(--space-3);font-size:14px;">
        <span>Guardado em metas</span><b class="verde" style="font-variant-numeric:tabular-nums;">${brl(guardadoMes)}</b>
      </div>
      <span class="by" style="margin:0;">Não é gasto: o dinheiro continua seu, só foi separado para as metas.</span>
    </div>`);
  const noCartao = cartaoOn() ? r2(parcelasDoMes('', mkey(state.y, state.m)).filter(p => !p.c.ajuste).reduce((s, p) => s + p.valor, 0)) : 0;
  if (noCartao > 0) $('cats').insertAdjacentHTML('beforeend', `
    <div class="guardado-mes">
      <div style="display:flex;justify-content:space-between;gap:var(--space-3);font-size:14px;">
        <span>💳 Comprado no cartão</span><b style="font-variant-numeric:tabular-nums;">${brl(noCartao)}</b>
      </div>
      <span class="by" style="margin:0;">Ainda não saiu da conta: entra no saldo quando a fatura for paga. Detalhes na aba Cartões.</span>
    </div>`);
}

/* ======================= CONTAS A PAGAR ======================= */
const MES_CURTO = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const mkey = (y, m) => { const d = new Date(y, m, 1); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-01`; };
const mdiff = (a, b) => (Number(b.slice(0,4)) - Number(a.slice(0,4))) * 12 + (Number(b.slice(5,7)) - Number(a.slice(5,7)));
const mlabel = k => `${MONTHS[Number(k.slice(5,7)) - 1]} ${k.slice(0,4)}`;
const r2 = n => Math.round(n * 100) / 100;
const cents = n => Math.round(n * 100);
const num = n => n.toFixed(2).replace('.', ',');
const ddmm = d => `${pad(d.getDate())}/${pad(d.getMonth()+1)}`;
const myId = () => currentUser ? currentUser.id : null;
const quem = uid => uid === myId() ? 'você' : nameOf(uid);

Object.assign(state, { tab: 'lanc', contas: [], partes: {}, cmeses: {}, pags: [], pagsMeses: [], contasOk: true });
try { const t = localStorage.getItem('pof-aba'); if (['lanc','cartoes','contas','metas','invest'].includes(t)) state.tab = t; } catch(e){}
try { const t = new URLSearchParams(location.search).get('aba'); if (ROTAS[t]) state.tab = t; } catch(e){}   // links antigos (?aba=)
if (ABA_DO_LINK) state.tab = ABA_DO_LINK;
function linkDaAba(t){
  try {
    const u = new URL(location.href); u.searchParams.delete('aba');
    const novo = APP_BASE + ROTAS[t] + u.search + u.hash;
    if (novo !== location.pathname + location.search + location.hash) history.replaceState(history.state, '', novo);
  } catch(e){}
}
if (ABA_DO_LINK || new URLSearchParams(location.search).has('aba')) linkDaAba(state.tab);

function ocorre(c, mk){
  if (c.tipo === 'unica') return mk === c.inicio;
  const i = mdiff(c.inicio, mk);
  if (c.tipo === 'parcelada') return i >= 0 && i < c.parcelas;
  return i >= 0 && (!c.fim || mk <= c.fim);
}

// A conta num mês: valor, quanto já foi pago, parte de cada um, situação
function instancia(c, mk){
  const y = Number(mk.slice(0,4)), m = Number(mk.slice(5,7)) - 1;
  const due = new Date(y, m, Math.min(c.dia, new Date(y, m + 1, 0).getDate()));
  const ov = state.cmeses[c.id + '|' + mk];
  const total = ov != null ? ov : Number(c.valor);
  const pags = state.pags.filter(p => p.conta_id === c.id && p.mes === mk);
  const pago = r2(pags.reduce((s, p) => s + Number(p.valor), 0));
  const falta = Math.max(0, r2(total - pago));
  const partes = state.partes[c.id] || [];
  const soma = partes.reduce((s, p) => s + Number(p.peso), 0);
  let resto = cents(total);
  const parts = partes.map((p, i) => {
    const share = i === partes.length - 1 ? resto / 100 : Math.round(cents(total) * Number(p.peso) / soma) / 100;
    resto -= cents(share);
    const pg = r2(pags.filter(x => x.user_id === p.user_id).reduce((s, x) => s + Number(x.valor), 0));
    return { uid: p.user_id, share, pago: pg, falta: Math.max(0, r2(share - pg)) };
  });
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const days = Math.round((due - hoje) / 86400000);
  const paid = falta <= 0;
  // meses de antes do cadastro (ex.: parcelada que já estava na 3ª) não contam como atrasados
  const antes = c.criado_em && mk < c.criado_em.slice(0, 7) + '-01';
  const st = paid ? 'paid' : antes ? 'ok' : days < 0 ? 'late' : days <= 3 ? 'soon' : 'ok';
  const n = c.tipo === 'parcelada' ? mdiff(c.inicio, mk) + 1 : null;
  return { c, mk, due, days, total, pago: Math.min(pago, total), falta, pags, parts, paid, st, n, ov: ov != null, antes };
}
const tipoTxt = i => i.c.tipo === 'parcelada' ? `${i.n}/${i.c.parcelas}` : i.c.tipo === 'fixa' ? 'Fixa' : 'Única';

let contasSeq = 0;
async function loadContas(){
  const seq = ++contasSeq;
  if (!state.cid){ state.contas = []; return true; }
  const cid = state.cid;
  const { data: cs, error } = await sb.from('contas').select('*').eq('controle_id', cid).order('dia').order('nome');
  if (seq !== contasSeq) return false;
  if (error){
    const faltaBanco = ['42P01','PGRST205','PGRST200'].includes(error.code) || /does not exist|could not find the table|schema cache/i.test(error.message || '');
    state.contasOk = !faltaBanco; state.contas = [];
    return faltaBanco;
  }
  const t = new Date();
  const meses = [...new Set([mkey(state.y, state.m), mkey(t.getFullYear(), t.getMonth()), mkey(t.getFullYear(), t.getMonth() - 1), mkey(t.getFullYear(), t.getMonth() - 2)])];
  const ids = cs.map(c => c.id);
  const vazio = Promise.resolve({ data: [] });
  const [pr, mr, gr] = await Promise.all([
    ids.length ? sb.from('conta_partes').select('conta_id,user_id,peso').in('conta_id', ids) : vazio,
    ids.length ? sb.from('conta_meses').select('conta_id,mes,valor').in('conta_id', ids) : vazio,
    ids.length ? sb.from('pagamentos').select('id,conta_id,mes,user_id,valor,data,criado_em').eq('controle_id', cid).in('mes', meses).order('criado_em') : vazio
  ]);
  if (seq !== contasSeq) return false;
  if (pr.error || mr.error || gr.error){ toast('Não foi possível carregar as contas a pagar.'); return false; }
  state.contasOk = true;
  state.contas = cs;
  state.partes = {};
  pr.data.forEach(p => (state.partes[p.conta_id] = state.partes[p.conta_id] || []).push(p));
  Object.values(state.partes).forEach(l => l.sort((a, b) => a.user_id.localeCompare(b.user_id)));
  state.cmeses = {};
  mr.data.forEach(x => { state.cmeses[x.conta_id + '|' + x.mes] = Number(x.valor); });
  state.pags = gr.data;
  state.pagsMeses = meses;
  return true;
}

function alertas(){
  const t = new Date();
  let late = 0, hoje = 0, primeiro = null;
  [-2, -1, 0].map(k => mkey(t.getFullYear(), t.getMonth() + k)).forEach(mk => {
    if (!state.pagsMeses.includes(mk)) return;
    state.contas.forEach(c => {
      if (!ocorre(c, mk)) return;
      const i = instancia(c, mk);
      if (i.paid || i.antes || i.days > 0) return;
      if (i.days < 0) late++; else hoje++;
      if (!primeiro || mk < primeiro) primeiro = mk;
    });
  });
  if (cartaoOn()) [-2, -1, 0].map(k => mkey(t.getFullYear(), t.getMonth() + k)).forEach(mk => {
    faturasDoMes(mk).forEach(i => {
      if (i.falta <= 0 || i.days > 0) return;
      if (i.days < 0) late++; else hoje++;
      if (!primeiro || mk < primeiro) primeiro = mk;
    });
  });
  return { late, hoje, primeiro };
}

const TITULOS = { lanc: 'Lançamentos', cartoes: 'Cartões', contas: 'Contas a pagar', metas: 'Metas', invest: 'Investimentos' };
// o aviso de contas vencidas só aparece em Contas a pagar (nas outras abas fica só o número no menu)
function syncAlerta(){
  $('billAlert').hidden = !state.alertaN || !modOn('contas') || state.tab !== 'contas';
}
function renderTabs(){
  const mods = modulosDe(current());
  document.querySelectorAll('[data-tab]').forEach(b => { b.hidden = !mods.includes(b.dataset.tab); });
  const desligada = !mods.includes(state.tab);
  $('tabOff').hidden = !desligada;
  if (desligada){
    const m = MODULOS.find(x => x.k === state.tab);
    $('tabOffTxt').textContent = `O controle "${(current() || {}).nome || ''}" não compartilha ${m ? m.nome : 'esta área'}. O que é só seu fica no Meu controle.`;
  }
  document.querySelectorAll('[data-tab]').forEach(b => {
    const on = b.dataset.tab === state.tab;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('tabLanc').hidden = desligada || state.tab !== 'lanc';
  $('tabCartoes').hidden = desligada || state.tab !== 'cartoes';
  $('tabContas').hidden = desligada || state.tab !== 'contas';
  $('tabMetas').hidden = desligada || state.tab !== 'metas';
  $('tabInvest').hidden = desligada || state.tab !== 'invest';
  $('export').hidden = state.tab !== 'lanc';
  syncAlerta();
  const porMes = state.tab === 'lanc' || state.tab === 'contas' || state.tab === 'cartoes';
  $('monthNav').style.display = porMes ? 'flex' : 'none';
  if (!porMes){ $('monthTitle').textContent = TITULOS[state.tab]; document.title = `${TITULOS[state.tab]} · Pra Onde Foi?`; }
  else { $('monthTitle').textContent = TITULOS[state.tab]; document.title = `${TITULOS[state.tab]} · ${MONTHS[state.m]} ${state.y} · Pra Onde Foi?`; }
}
function setTab(t){
  state.tab = t;
  try { localStorage.setItem('pof-aba', t); } catch(e){}
  linkDaAba(t);
  renderTabs();
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('navMenu').addEventListener('click', () => openMenu($('navMenu')));
$('tabOffBtn').addEventListener('click', async () => {
  const p = state.controles.find(c => c.pessoal); if (!p) return;
  selectControle(p.id); state.entries = []; state.members = []; render();
  await loadMembers(); await refresh();
});
$('billAlertGo').onclick = () => {
  const { primeiro } = alertas();
  setTab('contas');
  if (primeiro){ state.y = Number(primeiro.slice(0,4)); state.m = Number(primeiro.slice(5,7)) - 1; render(); refresh(); }
};

function partsLine(i){
  return i.parts.map(p => `${esc(quem(p.uid))} ${p.falta <= 0 ? '<span style="color:var(--green)">✓</span>' : 'falta ' + brl(p.falta)}`).join(' · ');
}

function renderContas(){
  const { late, hoje } = alertas();
  const n = late + hoje;
  document.querySelectorAll('[data-badge="contas"]').forEach(b => { b.hidden = !n || !modOn('contas'); b.textContent = n; });
  state.alertaN = n; syncAlerta();
  $('billAlertText').textContent = [
    late ? `${plural(late, 'conta')} ${late === 1 ? 'vencida' : 'vencidas'}` : '',
    hoje ? `${hoje} ${hoje === 1 ? 'conta vence' : 'contas vencem'} hoje` : ''
  ].filter(Boolean).join(' · ');

  if (!state.contasOk){
    $('billNew').disabled = true;
    $('billList').innerHTML = '';
    $('billEmpty').hidden = false;
    $('billEmpty').textContent = 'Esta área está temporariamente indisponível. Tente de novo mais tarde.';
    ['billTotal','billPaid','billLeft'].forEach(id => { $(id).textContent = brl(0); });
    ['billTotalNote','billPaidNote','billLeftNote'].forEach(id => { $(id).textContent = ''; });
    return;
  }
  $('billNew').disabled = false;
  const mk = mkey(state.y, state.m);
  const me = myId();
  const list = state.contas.filter(c => ocorre(c, mk)).map(c => instancia(c, mk))
    .filter(i => !(i.antes && i.c.tipo === 'parcelada' && i.pago === 0))
    .sort((a, b) => (a.paid - b.paid) || (a.due - b.due) || a.c.nome.localeCompare(b.c.nome));
  const fats = faturasDoMes(mk);
  const total = r2(list.reduce((s, i) => s + i.total, 0) + fats.reduce((s, i) => s + i.total, 0));
  const pago = r2(list.reduce((s, i) => s + i.pago, 0) + fats.reduce((s, i) => s + i.pago, 0));
  const falta = r2(list.reduce((s, i) => s + i.falta, 0) + fats.reduce((s, i) => s + i.falta, 0));
  const nTot = list.length + fats.length;
  const pagas = list.filter(i => i.paid).length + fats.filter(i => i.st === 'paga').length;
  const minhas = list.filter(i => i.parts.some(p => p.uid === me));
  const minhaFalta = r2(minhas.reduce((s, i) => s + i.parts.filter(p => p.uid === me).reduce((a, p) => a + Math.min(p.falta, i.falta), 0), 0));

  $('billTotal').textContent = brl(total);
  $('billTotalNote').textContent = plural(list.length, 'conta') + (fats.length ? ` + ${plural(fats.length, 'fatura')}` : '');
  $('billPaid').textContent = brl(pago); $('billPaid').classList.toggle('zero', !pago);
  const parciais = list.filter(i => !i.paid && i.pago > 0).length + fats.filter(i => i.st !== 'paga' && i.pago > 0).length;
  $('billPaidNote').textContent = !nTot ? '' : `${pagas} de ${nTot} ${nTot === 1 ? 'paga' : 'pagas'}` + (parciais ? ` · ${parciais} em parte` : '');
  $('billLeft').textContent = brl(falta);
  $('billLeftNote').textContent = !nTot ? 'Nenhuma conta neste mês'
    : falta <= 0 ? 'Tudo pago ✓'
    : minhas.length ? `Minha parte: falta ${brl(minhaFalta)}`
    : `${plural(nTot - pagas, 'conta')} em aberto`;

  $('billEmpty').hidden = nTot > 0;
  $('billEmpty').textContent = 'Nenhuma conta neste mês. Toque em "Nova conta" para cadastrar aluguel, luz, cartão…';
  $('billList').innerHTML = list.map(i => {
    const c = i.c;
    const tag = i.paid ? '<span class="tag tag-neutral">Paga ✓</span>'
      : i.st === 'late' ? `<span class="tag tag-red">Vencida</span>`
      : i.antes ? ''
      : i.days === 0 ? '<span class="tag tag-accent">Vence hoje</span>'
      : i.st === 'soon' ? `<span class="tag tag-accent">Vence em ${plural(i.days, 'dia')}</span>`
      : i.pago > 0 ? '<span class="tag tag-neutral">Parcial</span>' : '';
    const linha2 = [esc(rotuloCat(c.categoria)), `vence ${ddmm(i.due)}`, (!i.paid && i.pago > 0) ? `pago ${brl(i.pago)} de ${brl(i.total)}` : ''].filter(Boolean).join(' · ');
    return `
    <div class="bill ${i.st}" data-bill="${esc(c.id)}">
      <div class="bill-day"><b>${i.due.getDate()}</b><small>${MES_CURTO[i.due.getMonth()]}</small></div>
      <div style="min-width:0;">
        <div class="bill-name">${esc(c.nome)} <span class="tag tag-neutral">${tipoTxt(i)}</span></div>
        <div class="by">${linha2}</div>
        ${i.parts.length ? `<div class="by">${partsLine(i)}</div>` : ''}
        ${!i.paid && i.pago > 0 ? `<div class="prog"><div style="width:${Math.min(100, i.pago / i.total * 100)}%"></div></div>` : ''}
      </div>
      <div class="bill-side">
        <span class="bill-val">${brl(i.total)}</span>
        <span class="bill-act" style="display:flex;gap:6px;align-items:center;">${tag}${i.paid ? '' : `<button class="btn btn-primary btn-sm" data-pay="${esc(c.id)}" type="button" aria-label="Pagar ${esc(c.nome)}">Pagar</button>`}</span>
      </div>
    </div>`;
  }).join('') + (fats.length ? `<div class="kicker" style="margin:var(--space-4) 0 0;">Faturas de cartão</div>` + fats.map(fatHtml).join('') : '');
  vincOpcoes();   // a conta nova aparece na hora no "Usar para" de Lançamentos
}

$('billList').addEventListener('click', e => {
  const pay = e.target.closest('[data-pay]');
  if (pay) return openPay(pay.dataset.pay);
  const row = e.target.closest('[data-bill]');
  if (row) openBill(row.dataset.bill);
});
$('billNew').onclick = () => openBillForm(null);
$('ctrlShare').onclick = async () => {
  const c = current(); if (!c) return;
  if (!c.pessoal) return openManage();
  const nome = await pedirTexto('Compartilhar com alguém',
    'O "Meu controle" é só seu. Para dividir, criamos um controle compartilhado e você convida a pessoa. Seus lançamentos pessoais continuam só seus.',
    { rotulo: 'Nome do controle compartilhado', placeholder: 'Casa', okTxt: 'Compartilhar' });
  if (nome === null) return;
  await criarControle(nome);
};

/* ---------- janela ---------- */
let dlg2 = {};   // o que está aberto na janela: { tipo, id, mk }
function openDlg2(kicker, title, html, ctx){
  $('dlg2Kicker').textContent = kicker;
  $('dlg2Title').textContent = title;
  $('dlg2Body').innerHTML = html;
  $('dlg2').hidden = false;
  $('dlg2').classList.toggle('largo', !!(ctx && ctx.largo));
  dlg2 = ctx || {};
}
function closeDlg2(){ $('dlg2').hidden = true; dlg2 = {}; if (typeof pararEspera === 'function') pararEspera(); }
$('dlg2Close').onclick = closeDlg2;
// com uma janela aberta, a tela de trás não rola junto
const travaFundo = () => document.documentElement.classList.toggle('travado', !$('dlg').hidden || !$('dlg2').hidden || !$('drawer').hidden || !$('dlgConf').hidden);
['dlg','dlg2','drawer','dlgConf'].forEach(id => new MutationObserver(travaFundo).observe($(id), { attributes: true, attributeFilter: ['hidden'] }));
// (toque fora da janela não fecha: só o X, Cancelar ou salvar)

const findConta = id => state.contas.find(c => c.id === id);

function openPay(id){
  const c = findConta(id); if (!c) return;
  const mk = mkey(state.y, state.m);
  const i = instancia(c, mk);
  if (i.paid) return toast('Essa conta já está paga.');
  const minha = i.parts.find(p => p.uid === myId());
  const minhaFalta = minha ? Math.min(minha.falta, i.falta) : 0;
  const sugere = minhaFalta > 0 ? minhaFalta : i.falta;
  openDlg2(`Pagar · ${mlabel(mk)}`, c.nome + (i.n ? ` ${i.n}/${c.parcelas}` : ''), `
    <div class="dlg-sec">
      <div class="kv"><span>Valor do mês</span><b>${brl(i.total)}</b></div>
      ${i.pago > 0 ? `<div class="kv"><span>Já pago</span><b>${brl(i.pago)}</b></div>` : ''}
      <div class="kv"><span>Falta pagar</span><b style="color:var(--accent-text);">${brl(i.falta)}</b></div>
      ${i.parts.length ? `<div class="kv"><span>Divisão</span><b style="text-align:right;font-weight:500;">${partsLine(i)}</b></div>` : ''}
    </div>
    <div class="dlg-sec" style="gap:var(--space-3);">
      <div class="field">
        <label for="payVal">Quanto você está pagando (R$)</label>
        <input class="input" id="payVal" inputmode="numeric" data-dinheiro value="${num(sugere)}" style="font-variant-numeric:tabular-nums;">
      </div>
      ${minhaFalta > 0 && minhaFalta < i.falta ? `
      <div class="row" style="flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" type="button" data-fill="${num(minhaFalta)}">Minha parte · ${brl(minhaFalta)}</button>
        <button class="btn btn-secondary btn-sm" type="button" data-fill="${num(i.falta)}">Tudo que falta · ${brl(i.falta)}</button>
      </div>` : ''}
      <div class="field">
        <label for="payDate">Data do pagamento</label>
        <input class="input" id="payDate" type="date" value="${todayISO()}">
      </div>
      <p class="hint">Dá para pagar só uma parte. O valor entra como saída em Lançamentos, no seu nome.</p>
    </div>
    <button class="btn btn-primary" type="button" data-act="confirmPay" style="min-height:42px;">Confirmar pagamento</button>`,
    { tipo: 'pay', id, mk });
}

function openBill(id){
  const c = findConta(id); if (!c) return closeDlg2();
  const mk = mkey(state.y, state.m);
  if (!ocorre(c, mk)) return closeDlg2();
  const i = instancia(c, mk);
  const mine = c.criado_por === myId();
  const tipoLonga = c.tipo === 'parcelada' ? `Parcela ${i.n} de ${c.parcelas}`
    : c.tipo === 'fixa' ? `Todo mês desde ${mlabel(c.inicio)}${c.fim ? ` até ${mlabel(c.fim)}` : ''}`
    : `Só em ${mlabel(c.inicio)}`;
  const status = i.paid ? 'Paga ✓' : i.st === 'late' ? '<span style="color:var(--alerta);">Vencida</span>'
    : i.antes ? (i.pago > 0 ? `Parcial · falta ${brl(i.falta)}` : 'Em aberto')
    : i.days === 0 ? '<span style="color:var(--accent-text);">Vence hoje</span>'
    : i.pago > 0 ? `Parcial · falta ${brl(i.falta)}` : `Em aberto · vence em ${plural(i.days, 'dia')}`;
  openDlg2(`Conta · ${mlabel(mk)}`, c.nome, `
    <div class="dlg-sec">
      <div class="kv"><span>Valor ${i.ov ? 'deste mês (ajustado)' : 'do mês'}</span><b>${brl(i.total)}</b></div>
      <div class="kv"><span>Vencimento</span><b>${ddmm(i.due)}</b></div>
      <div class="kv"><span>Situação</span><b>${status}</b></div>
      <div class="kv"><span>Tipo</span><b>${tipoLonga}</b></div>
      <div class="kv"><span>Categoria</span><b>${esc(c.categoria)}</b></div>
      ${isShared() ? `<div class="kv"><span>Criada por</span><b>${esc(quem(c.criado_por))}</b></div>` : ''}
    </div>
    ${i.parts.length ? `
    <div class="dlg-sec">
      <h3>Divisão</h3>
      ${i.parts.map(p => `<div class="person"><span>${esc(quem(p.uid))}</span><span>${brl(p.share)} ${p.falta <= 0 ? '<span class="tag tag-accent">Pago ✓</span>' : p.pago > 0 ? `<span class="tag tag-neutral">falta ${brl(p.falta)}</span>` : '<span class="tag tag-neutral">em aberto</span>'}</span></div>`).join('')}
    </div>` : ''}
    <div class="dlg-sec">
      <h3>Pagamentos deste mês</h3>
      ${i.pags.length ? i.pags.map(p => {
        const d = p.data.split('-');
        return `<div class="person"><span>${d[2]}/${d[1]} · ${esc(quem(p.user_id))} · <b>${brl(Number(p.valor))}</b></span>
          ${p.user_id === myId() ? `<button class="btn btn-secondary btn-sm" type="button" data-act="undo" data-id="${esc(p.id)}">Desfazer</button>` : ''}</div>`;
      }).join('') : '<p class="hint">Nenhum pagamento ainda.</p>'}
    </div>
    <div class="row" style="flex-wrap:wrap;">
      ${i.paid ? '' : '<button class="btn btn-primary" type="button" data-act="pay">Pagar</button>'}
      ${mine ? '<button class="btn btn-secondary" type="button" data-act="edit">Editar</button>' : ''}
      ${mine && c.tipo !== 'unica' ? '<button class="btn btn-secondary" type="button" data-act="monthVal">Valor só deste mês</button>' : ''}
    </div>
    ${mine ? `
    <div class="dlg-sec" style="border-top:1px solid var(--divider);padding-top:14px;">
      <h3>Encerrar ou excluir</h3>
      <div class="row" style="flex-wrap:wrap;">
        ${c.tipo === 'fixa' ? '<button class="btn btn-secondary" type="button" data-act="end">Encerrar a partir deste mês</button>' : ''}
        <button class="btn btn-danger" type="button" data-act="del">Excluir conta</button>
      </div>
      <p class="hint">${c.tipo === 'fixa' ? 'Encerrar mantém os meses anteriores. ' : ''}Excluir apaga a conta em todos os meses. As saídas que já foram lançadas continuam em Lançamentos.</p>
    </div>` : `<p class="hint">Só ${esc(quem(c.criado_por))} (quem criou) pode editar ou excluir esta conta.</p>`}`,
    { tipo: 'bill', id, mk });
}

/* ---------- nova / editar conta ---------- */
let bf = {};   // estado do formulário
function openBillForm(c){
  const mk = mkey(state.y, state.m);
  const shared = isShared();
  const partes = c ? (state.partes[c.id] || []) : [];
  const iguais = partes.every(p => Number(p.peso) === Number((partes[0] || {}).peso));
  bf = { c, tipo: c ? c.tipo : 'fixa', dividir: partes.length > 0, modo: partes.length && !iguais ? 'valores' : 'iguais', valModo: c ? 'parcela' : 'total' };
  const cats = listaCats('exp', c ? c.categoria : null);
  const parcAtual = c && c.tipo === 'parcelada' ? Math.max(1, Math.min(c.parcelas, mdiff(c.inicio, mk) + 1)) : 1;
  const membros = state.members.length ? state.members : [{ user_id: myId(), login: currentUser.email }];
  const peso = uid => { const p = partes.find(x => x.user_id === uid); return p ? Number(p.peso) : 0; };
  openDlg2(c ? 'Editar conta' : `A partir de ${mlabel(mk)}`, c ? c.nome : 'Nova conta', `
    <form id="billForm" novalidate style="display:flex;flex-direction:column;gap:var(--space-4);">
      <div class="field">
        <label for="bfNome">Nome</label>
        <input class="input" id="bfNome" maxlength="60" placeholder="Aluguel" value="${c ? esc(c.nome) : ''}" autocomplete="off">
      </div>
      <div class="grid2">
        <div class="field">
          <label for="bfValor" id="bfValorLbl">Valor (R$)</label>
          <input class="input" id="bfValor" inputmode="numeric" data-dinheiro placeholder="0,00" value="${c ? num(Number(c.valor)) : ''}">
        </div>
        <div class="field">
          <label for="bfDia">Vence todo dia</label>
          <input class="input" id="bfDia" type="number" inputmode="numeric" min="1" max="31" placeholder="10" value="${c ? c.dia : ''}">
        </div>
      </div>
      <div class="field">
        <label for="bfCat">Categoria</label>
        <select class="input" id="bfCat">${cats.map(x => `<option value="${esc(x)}"${c && c.categoria === x ? ' selected' : (!c && x === 'Contas' ? ' selected' : '')}>${esc(rotuloCat(x))}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label>Tipo</label>
        <div class="seg" id="bfTipo" role="group" aria-label="Tipo de conta" style="max-width:100%;overflow-x:auto;">
          <button type="button" data-tipo="fixa">Fixa</button>
          <button type="button" data-tipo="parcelada">Parcelada</button>
          <button type="button" data-tipo="unica">Só este mês</button>
        </div>
      </div>
      <div id="bfParc" style="display:flex;flex-direction:column;gap:var(--space-3);">
      <div class="seg" id="bfValModo" role="group" aria-label="Como informar o valor" style="align-self:flex-start;max-width:100%;overflow-x:auto;">
        <button type="button" data-vm="total">Valor total</button>
        <button type="button" data-vm="parcela">Valor da parcela</button>
      </div>
      <div class="grid2">
        <div class="field">
          <label for="bfParcTot">Total de parcelas</label>
          <input class="input" id="bfParcTot" type="number" inputmode="numeric" min="2" max="240" placeholder="10" value="${c && c.parcelas ? c.parcelas : ''}">
        </div>
        <div class="field">
          <label for="bfParcAt">Parcela deste mês</label>
          <input class="input" id="bfParcAt" type="number" inputmode="numeric" min="1" max="240" value="${parcAtual}">
        </div>
      </div>
      <div class="sugere" id="bfParcInfo" hidden></div>
      </div>
      <p class="hint" id="bfTipoHint" style="margin:0;font-size:13px;color:var(--muted);"></p>
      ${shared ? `
      <div class="dlg-sec" style="border-top:1px solid var(--divider);padding-top:14px;gap:var(--space-3);">
        <label class="chk"><input type="checkbox" id="bfDiv"${bf.dividir ? ' checked' : ''}> Dividir entre participantes</label>
        <div id="bfDivBox" style="display:flex;flex-direction:column;gap:var(--space-2);">
          <div class="seg" id="bfModo" role="group" aria-label="Como dividir" style="align-self:flex-start;">
            <button type="button" data-modo="iguais">Partes iguais</button>
            <button type="button" data-modo="valores">Valor de cada um</button>
          </div>
          ${membros.map(p => `
          <div class="person" style="word-break:normal;">
            <label class="chk" style="min-width:0;"><input type="checkbox" data-pu="${esc(p.user_id)}"${!c || !partes.length || peso(p.user_id) ? ' checked' : ''}> <span style="overflow:hidden;text-overflow:ellipsis;">${esc(quem(p.user_id))}</span></label>
            <span class="by" data-ps="${esc(p.user_id)}" style="margin:0;white-space:nowrap;"></span>
            <input class="input" data-pv="${esc(p.user_id)}" inputmode="numeric" data-dinheiro placeholder="0,00" value="${peso(p.user_id) && bf.modo === 'valores' ? num(peso(p.user_id)) : ''}" style="width:120px;flex:none;">
          </div>`).join('')}
          <p class="hint" id="bfDivHint"></p>
        </div>
      </div>` : ''}
      <button class="btn btn-primary" type="submit" id="bfSave" style="min-height:42px;">${c ? 'Salvar alterações' : 'Adicionar conta'}</button>
    </form>`, { tipo: 'form', id: c ? c.id : null, mk });
  bfUpdate();
}

// valor que cai em cada mês (na parcelada com "valor total", divide pelo nº de parcelas)
function bfValorMes(){
  const v = parseAmount($('bfValor').value);
  if (bf.tipo !== 'parcelada' || bf.valModo !== 'total') return v;
  const n = parseInt($('bfParcTot').value, 10);
  return v > 0 && n >= 2 ? Math.round(v / n * 100) / 100 : NaN;
}
function bfUpdate(){
  const mk = dlg2.mk;
  const parc = bf.tipo === 'parcelada';
  document.querySelectorAll('#bfValModo button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.vm === bf.valModo)));
  $('bfValorLbl').textContent = !parc ? 'Valor (R$)' : bf.valModo === 'total' ? 'Valor total da compra (R$)' : 'Valor de cada parcela (R$)';
  if (parc){
    const n = parseInt($('bfParcTot').value, 10), at = parseInt($('bfParcAt').value, 10), vm = bfValorMes();
    const ok = n >= 2 && vm > 0 && at >= 1 && at <= n;
    $('bfParcInfo').hidden = !ok;
    if (ok){
      const rest = n - at;
      $('bfParcInfo').innerHTML = `<div><b>${n}x de ${brl(vm)}</b> (total ${brl(r2(vm * n))})</div>
        <div>Este mês é a <b>${at}ª</b>${rest ? ` · depois faltam mais <b>${rest}</b>, até ${mesCurto(mkey(state.y, state.m + rest))}` : ' · é a última'}.</div>
        <div style="color:var(--muted);">Ao pagar, vem ${brl(vm)} por mês.</div>`;
    }
  }
  document.querySelectorAll('#bfTipo button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tipo === bf.tipo)));
  $('bfParc').hidden = bf.tipo !== 'parcelada';
  const ini = bf.c && bf.c.tipo === bf.tipo && bf.tipo !== 'parcelada' ? bf.c.inicio : mk;
  $('bfTipoHint').textContent = bf.tipo === 'fixa' ? `Aparece todo mês a partir de ${mlabel(ini)}, até você encerrar.`
    : bf.tipo === 'unica' ? `Aparece só em ${mlabel(ini)}.`
    : 'Aparece deste mês até a última parcela; as anteriores não entram.';
  if (!$('bfDiv')) return;
  const on = $('bfDiv').checked;
  $('bfDivBox').hidden = !on;
  if (!on) return;
  document.querySelectorAll('#bfModo button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.modo === bf.modo)));
  const valor = bfValorMes();
  const iguais = bf.modo === 'iguais';
  const marcados = [...document.querySelectorAll('[data-pu]')].filter(x => x.checked).map(x => x.dataset.pu);
  document.querySelectorAll('[data-pu]').forEach(x => { x.disabled = !iguais; x.style.visibility = iguais ? '' : 'hidden'; });
  document.querySelectorAll('[data-pv]').forEach(x => { x.hidden = iguais; });
  document.querySelectorAll('[data-ps]').forEach(x => {
    x.hidden = !iguais;
    x.textContent = marcados.includes(x.dataset.ps) && valor > 0 ? brl(valor / marcados.length) : '';
  });
  const hint = $('bfDivHint');
  if (iguais){
    hint.style.color = '';
    hint.textContent = marcados.length ? `Cada um paga ${valor > 0 ? brl(valor / marcados.length) : 'a mesma parte'}.` : 'Marque quem divide a conta.';
  } else {
    const soma = r2([...document.querySelectorAll('[data-pv]')].reduce((s, x) => s + (parseAmount(x.value) || 0), 0));
    const ok = valor > 0 && Math.abs(soma - valor) < 0.005;
    hint.style.color = ok ? '' : 'var(--alerta)';
    hint.textContent = `Soma das partes: ${brl(soma)} de ${valor > 0 ? brl(valor) : 'R$ —'}`;
  }
}

$('dlg2Body').addEventListener('input', e => { if (dlg2.tipo === 'form') bfUpdate(); });
$('dlg2Body').addEventListener('change', e => { if (dlg2.tipo === 'form') bfUpdate(); });

$('dlg2Body').addEventListener('submit', async e => {
  if (e.target.id !== 'billForm') return;
  e.preventDefault();
  const c = bf.c, mk = dlg2.mk;
  const nome = $('bfNome').value.trim();
  const valor = bfValorMes();
  const dia = parseInt($('bfDia').value, 10);
  if (!nome) return toast('Dê um nome para a conta.');
  if (!(valor > 0)) return toast('Informe o valor da conta.');
  if (!(dia >= 1 && dia <= 31)) return toast('O dia do vencimento vai de 1 a 31.');
  let inicio = c && c.tipo === bf.tipo && bf.tipo !== 'parcelada' ? c.inicio : mk;
  let parcelas = null;
  if (bf.tipo === 'parcelada'){
    parcelas = parseInt($('bfParcTot').value, 10);
    const at = parseInt($('bfParcAt').value, 10);
    if (!(parcelas >= 2 && parcelas <= 240)) return toast('O total de parcelas vai de 2 a 240.');
    if (!(at >= 1 && at <= parcelas)) return toast(`A parcela deste mês vai de 1 a ${parcelas}.`);
    const d = new Date(state.y, state.m - (at - 1), 1);
    inicio = mkey(d.getFullYear(), d.getMonth());
  }
  let partes = [];
  if ($('bfDiv') && $('bfDiv').checked){
    if (bf.modo === 'iguais'){
      partes = [...document.querySelectorAll('[data-pu]')].filter(x => x.checked).map(x => ({ user_id: x.dataset.pu, peso: 1 }));
      if (!partes.length) return toast('Marque quem divide a conta.');
    } else {
      partes = [...document.querySelectorAll('[data-pv]')].map(x => ({ user_id: x.dataset.pv, peso: parseAmount(x.value) || 0 })).filter(p => p.peso > 0);
      const soma = r2(partes.reduce((s, p) => s + p.peso, 0));
      if (!partes.length) return toast('Coloque o valor de cada pessoa.');
      if (Math.abs(soma - valor) >= 0.005) return toast(`A soma das partes (${brl(soma)}) precisa dar o valor da conta (${brl(valor)}).`);
    }
  }
  const btn = $('bfSave'); btn.disabled = true;
  const { error } = await sb.rpc('salvar_conta', {
    p_id: c ? c.id : null, cid: state.cid, p_nome: nome, p_categoria: $('bfCat').value, p_valor: valor,
    p_dia: dia, p_tipo: bf.tipo, p_inicio: inicio, p_parcelas: parcelas, p_partes: partes
  });
  if (error){ btn.disabled = false; return toast(rpcMsg(error)); }
  closeDlg2();
  toast(c ? 'Conta atualizada.' : 'Conta adicionada.', true);
  if (await loadContas()) renderContas();
});

$('dlg2Body').addEventListener('click', async e => {
  const fill = e.target.closest('[data-fill]');
  if (fill){ $('payVal').value = fill.dataset.fill; return; }
  const tb = e.target.closest('#bfTipo button');
  if (tb){ bf.tipo = tb.dataset.tipo; return bfUpdate(); }
  const vmb = e.target.closest('#bfValModo button');
  if (vmb){
    if (vmb.dataset.vm !== bf.valModo){
      // converte o número digitado para não perder o que a pessoa já escreveu
      const v = parseAmount($('bfValor').value), n = parseInt($('bfParcTot').value, 10);
      if (v > 0 && n >= 2) $('bfValor').value = num(vmb.dataset.vm === 'total' ? r2(v * n) : Math.round(v / n * 100) / 100);
      bf.valModo = vmb.dataset.vm;
    }
    return bfUpdate();
  }
  const mb = e.target.closest('#bfModo button');
  if (mb){
    bf.modo = mb.dataset.modo;
    if (bf.modo === 'valores'){
      // começa preenchido com a divisão igual entre os marcados
      const valor = bfValorMes();
      const marc = [...document.querySelectorAll('[data-pu]')].filter(x => x.checked).map(x => x.dataset.pu);
      const vazios = [...document.querySelectorAll('[data-pv]')].every(x => !x.value.trim());
      if (vazios && valor > 0 && marc.length){
        let resto = cents(valor);
        marc.forEach((uid, k) => {
          const v = k === marc.length - 1 ? resto / 100 : Math.round(cents(valor) / marc.length) / 100;
          resto -= cents(v);
          const inp = document.querySelector(`[data-pv="${uid}"]`); if (inp) inp.value = num(v);
        });
      }
    }
    return bfUpdate();
  }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const a = b.dataset.act, id = dlg2.id, mk = dlg2.mk;
  if (a.startsWith('pf') || a.startsWith('mm') || a.startsWith('iv') || a.startsWith('le')) return;   // perfil e metas têm o próprio tratamento
  const c = findConta(id);
  let res;
  if (a === 'confirmPay'){
    const v = parseAmount($('payVal').value);
    if (!(v > 0)) return toast('Informe um valor maior que zero.');
    b.disabled = true;
    res = await sb.rpc('pagar_conta', { conta: id, p_mes: mk, p_valor: v, p_data: $('payDate').value || todayISO() });
    if (res.error){ b.disabled = false; return toast(rpcMsg(res.error)); }
    closeDlg2();
    toast(`Pagamento de ${brl(v)} registrado e lançado como saída.`, true);
    return refresh();
  }
  if (!c) return closeDlg2();
  if (a === 'pay') return openPay(id);
  if (a === 'edit') return openBillForm(c);
  if (a === 'undo'){
    if (!await confirmar('Desfazer este pagamento?\n\nA saída que ele criou em Lançamentos também será apagada.')) return;
    b.disabled = true;
    res = await sb.rpc('desfazer_pagamento', { pag: b.dataset.id });
    if (res.error){ b.disabled = false; return toast(rpcMsg(res.error)); }
    toast('Pagamento desfeito.', true);
    await refresh(); return openBill(id);
  }
  if (a === 'monthVal'){
    const i = instancia(c, mk);
    const v = await pedirTexto(`Valor só em ${mlabel(mk)}`, `Deixe em branco para voltar ao valor normal (${brl(Number(c.valor))}).`, { rotulo: `Valor de "${c.nome}" (R$)`, valor: num(i.total), modo: 'decimal', okTxt: 'Salvar', vazioOk: true });
    if (v === null) return;
    const val = v.trim() ? parseAmount(v) : null;
    if (val !== null && !(val > 0)) return toast('Informe um valor maior que zero.');
    res = await sb.rpc('valor_do_mes', { conta: id, p_mes: mk, p_valor: val });
    if (res.error) return toast(rpcMsg(res.error));
    if (await loadContas()) renderContas();
    return openBill(id);
  }
  if (a === 'end'){
    if (!await confirmar(`Encerrar "${c.nome}" a partir de ${mlabel(mk)}?\n\nEla deixa de aparecer deste mês em diante. Os meses anteriores continuam como estão.`)) return;
    res = await sb.rpc('encerrar_conta', { conta: id, p_mes: mk });
    if (res.error) return toast(rpcMsg(res.error));
    closeDlg2(); toast('Conta encerrada.', true);
    if (await loadContas()) renderContas();
    return;
  }
  if (a === 'del'){
    if (!await confirmar(`Excluir "${c.nome}" de todos os meses?\n\nAs saídas já lançadas continuam em Lançamentos. Não dá para desfazer.`)) return;
    res = await sb.rpc('excluir_conta', { conta: id });
    if (res.error) return toast(rpcMsg(res.error));
    closeDlg2(); toast('Conta excluída.', true);
    if (await loadContas()) renderContas();
  }
});


/* ======================= METAS ======================= */
const MODELOS_META = [
  { icone: '🛡️', nome: 'Reserva de emergência', reserva: true },
  { icone: '✈️', nome: 'Viagem' },
  { icone: '🏠', nome: 'Casa própria' },
  { icone: '🚗', nome: 'Carro' },
  { icone: '🎓', nome: 'Estudos' },
  { icone: '💍', nome: 'Casamento' },
];
const ICONES_META = ['🎯','🛡️','✈️','🏠','🚗','🎓','💍','👶','📱','🐶','🎁','💰'];
const MES_ABREV = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const mesCurto = k => `${MES_ABREV[Number(k.slice(5,7)) - 1]}/${k.slice(0,4)}`;
Object.assign(state, { metas: [], metaMovs: [], metasOk: true });

let metasSeq = 0;
async function loadMetas(){
  const seq = ++metasSeq;
  if (!state.cid){ state.metas = []; state.metaMovs = []; return true; }
  const cid = state.cid;
  const [m, v] = await Promise.all([
    sb.from('metas').select('*').eq('controle_id', cid).order('criado_em'),
    sb.from('meta_movs').select('id,meta_id,user_id,tipo,valor,data,lancamento_id,criado_em').eq('controle_id', cid).order('data').order('criado_em')
  ]);
  if (seq !== metasSeq) return false;
  if (m.error || v.error){
    const e = m.error || v.error;
    state.metasOk = !(['42P01','PGRST205','PGRST200'].includes(e.code) || /does not exist|could not find the table|schema cache/i.test(e.message || ''));
    state.metas = []; state.metaMovs = [];
    return !state.metasOk;
  }
  state.metasOk = true; state.metas = m.data; state.metaMovs = v.data;
  return true;
}
let rtMetasTimer = null;
function rtMetas(){
  clearTimeout(rtMetasTimer);
  rtMetasTimer = setTimeout(async () => { if (!$('viewApp').hidden && await loadMetas()) renderMetas(); }, 400);
}

// números de uma meta: saldo, quanto falta, quanto guardar por mês, ritmo
function infoMeta(m){
  const movs = state.metaMovs.filter(x => x.meta_id === m.id);
  const saldo = r2(movs.reduce((s, x) => s + (x.tipo === 'guardar' ? 1 : -1) * Number(x.valor), 0));
  const alvo = Number(m.alvo);
  const falta = Math.max(0, r2(alvo - saldo));
  const pct = Math.max(0, Math.min(100, alvo ? saldo / alvo * 100 : 0));
  const hoje = new Date(), mkHoje = mkey(hoje.getFullYear(), hoje.getMonth());
  const meses = m.prazo ? mdiff(mkHoje, m.prazo) + 1 : null;     // contando o mês atual
  const porMes = meses && meses > 0 ? r2(falta / meses) : null;
  // ritmo: média guardada por mês desde o primeiro depósito
  const guard = movs.filter(x => x.tipo === 'guardar');
  let ritmo = 0, chegaEm = null;
  if (guard.length){
    const primeiro = guard[0].data.slice(0, 7) + '-01';
    const nMeses = Math.max(1, mdiff(primeiro, mkHoje) + 1);
    ritmo = r2(saldo / nMeses);
    if (ritmo > 0 && falta > 0){ const d = new Date(hoje.getFullYear(), hoje.getMonth() + Math.ceil(falta / ritmo), 1); chegaEm = mkey(d.getFullYear(), d.getMonth()); }
  }
  const porPessoa = {};
  movs.forEach(x => { porPessoa[x.user_id] = r2((porPessoa[x.user_id] || 0) + (x.tipo === 'guardar' ? 1 : -1) * Number(x.valor)); });
  const enc = !!m.encerrada_em;
  const juntado = enc ? Number(m.usado || 0) : saldo;
  return { movs, saldo, alvo, falta: enc ? 0 : falta, pct: enc ? 100 : pct, meses, porMes, ritmo, chegaEm, porPessoa,
           done: enc || falta <= 0, enc, juntado };
}
// "Concluída em nov/2026 · levou 3 meses" / "Usada em nov/2026"
function conquistaMeta(m, i, curto){
  const mk = d => d ? d.slice(0, 7) + '-01' : null;
  const fim = mk(m.concluida_em) || mk(new Date().toISOString());
  const n = Math.max(0, mdiff(mk(m.criado_em), fim));
  const levou = n === 0 ? 'em menos de 1 mês' : `levou ${plural(n, 'mês').replace('mêss', 'meses')}`;
  if (i.enc) return curto ? `Em ${mesCurto(mk(m.encerrada_em))}` : `Usada em ${mesCurto(mk(m.encerrada_em))} · ${brl(i.juntado)}`;
  return `${curto ? 'Em' : 'Concluída em'} ${mesCurto(fim)} · ${levou}`;
}

function renderMetas(){
  $('metaModelos').innerHTML = MODELOS_META.map((x, k) => `<button class="chip" type="button" data-modelo="${k}">${x.icone} ${esc(x.nome)}</button>`).join('');
  if (!state.metasOk){
    $('metasGrid').innerHTML = '';
    $('metasVazio').hidden = false;
    $('metasVazio').textContent = 'Esta área está temporariamente indisponível. Tente de novo mais tarde.';
    $('metaNova').disabled = true;
    return;
  }
  $('metaNova').disabled = false;
  const lista = state.metas.map(m => ({ m, i: infoMeta(m) }));
  const abertas = lista.filter(x => !x.i.done)
    .sort((a, b) => ((a.m.prazo || '9999').localeCompare(b.m.prazo || '9999')) || a.m.criado_em.localeCompare(b.m.criado_em));
  const feitas = lista.filter(x => x.i.done)
    .sort((a, b) => (a.i.enc - b.i.enc) || String(b.m.concluida_em || '').localeCompare(String(a.m.concluida_em || '')));
  const ativas = lista.filter(x => !x.i.enc);
  const guardado = r2(ativas.reduce((s, x) => s + x.i.saldo, 0));
  const falta = r2(abertas.reduce((s, x) => s + x.i.falta, 0));
  const juntado = r2(feitas.reduce((s, x) => s + x.i.juntado, 0));
  $('mtGuardado').textContent = brl(guardado);
  $('mtGuardado').classList.toggle('zero', !guardado);
  $('mtGuardadoNote').textContent = ativas.length ? `em ${plural(ativas.length, 'meta')}` : (lista.length ? 'Nada guardado agora' : 'Crie sua primeira meta');
  $('mtFalta').textContent = brl(falta);
  $('mtFalta').classList.toggle('zero', !falta);
  const porMesTotal = r2(abertas.reduce((s, x) => s + (x.i.porMes || 0), 0));
  $('mtFaltaNote').textContent = !abertas.length ? (lista.length ? 'Tudo alcançado' : '') : porMesTotal ? `Guarde ${brl(porMesTotal)}/mês para chegar nos prazos` : `${plural(abertas.length, 'meta')} em andamento`;
  $('mtConcl').textContent = feitas.length;
  $('mtConcl').classList.toggle('zero', !feitas.length);
  $('mtConclNote').innerHTML = feitas.length ? `<b class="verde">${brl(juntado)}</b> juntados` : 'Nenhuma ainda';
  // abas
  const aba = state.metaAba === 'concluidas' ? 'concluidas' : 'andamento';
  $('mtCntAnd').textContent = abertas.length ? `(${abertas.length})` : '';
  $('mtCntConc').textContent = feitas.length ? `(${feitas.length})` : '';
  document.querySelectorAll('#metaAbas [data-maba]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.maba === aba)));
  $('metaAbas').hidden = !lista.length;
  $('metaRapido').hidden = aba === 'concluidas';
  const mostrar = aba === 'concluidas' ? feitas : abertas;
  $('metasVazio').hidden = mostrar.length > 0;
  $('metasVazio').textContent = !lista.length ? 'Nenhuma meta ainda. Toque num modelo acima (Viagem, Reserva de emergência…) ou em "Nova meta".'
    : aba === 'concluidas' ? 'Nenhuma meta concluída ainda. Quando uma meta chegar a 100%, ela aparece aqui.'
    : 'Nenhuma meta em andamento. Que tal começar a próxima? Toque num modelo acima ou em "Nova meta".';
  const shared = isShared();
  $('metasGrid').innerHTML = mostrar.map(({ m, i }) => {
    const por = shared && m.criado_por ? `criada por ${esc(quem(m.criado_por))}` : '';
    const sub = i.done ? por : [m.prazo ? `até ${mesCurto(m.prazo)}` : 'sem prazo', por].filter(Boolean).join(' · ');
    const dica = i.meses !== null && i.meses <= 0 ? '<span style="color:var(--alerta)">Prazo passou</span>'
      : i.porMes ? `Guarde <b>${brl(i.porMes)}/mês</b>`
      : i.chegaEm ? `No ritmo atual: ${mesCurto(i.chegaEm)}` : 'Comece guardando';
    const acoes = !i.done
      ? `<div class="meta-acts"><button class="btn btn-primary btn-sm" type="button" data-mguardar="${esc(m.id)}">Guardar</button>${i.saldo > 0 ? `<button class="btn btn-secondary btn-sm" type="button" data-mretirar="${esc(m.id)}">Retirar</button>` : ''}</div>`
      : i.enc ? ''
      : `<div class="meta-acts duas">
          <button class="btn btn-ok btn-sm btn-usar" type="button" data-musar="${esc(m.id)}">Usei o dinheiro</button>
          <button class="btn btn-secondary btn-sm" type="button" data-mretirar="${esc(m.id)}">Retirar</button>
          ${m.criado_por === myId() ? `<button class="btn btn-secondary btn-sm" type="button" data-mmais="${esc(m.id)}">Aumentar meta</button>` : ''}
        </div>`;
    return `
    <div class="meta${i.done ? ' done' : ''}${i.enc ? ' usada' : ''}" data-meta="${esc(m.id)}">
      <div class="meta-top">
        <span class="meta-ic">${esc(m.icone)}</span>
        <div style="min-width:0;"><div style="font-weight:700;" class="ellip">${esc(m.nome)}</div>${sub ? `<div class="by" style="margin:0;">${sub}</div>` : ''}</div>
      </div>
      <div class="meta-vals"><b>${brl(i.juntado)}</b> <span style="color:var(--muted);font-size:13px;white-space:nowrap;">${i.enc ? 'usados' : `de ${brl(i.alvo)}`}</span></div>
      <div class="prog big"><div style="width:${i.pct}%"></div></div>
      <div class="meta-foot"><span class="meta-pct">${Math.floor(i.pct)}%</span><span>${i.done ? `<b class="ok">${i.enc ? 'Usada ✓' : 'Concluída ✓'}</b>` : `Faltam <b>${brl(i.falta)}</b>`}</span></div>
      ${i.done ? `<div class="meta-conq">${conquistaMeta(m, i, true)}</div>` : `<div class="meta-dica">${dica}</div>`}
      ${acoes}
    </div>`;
  }).join('');
  vincOpcoes();   // a meta nova aparece na hora no "Usar para" de Lançamentos
}

document.querySelectorAll('#metaAbas [data-maba]').forEach(b => b.addEventListener('click', () => { state.metaAba = b.dataset.maba; renderMetas(); }));

$('metaNova').onclick = () => openMetaForm(null, null);
$('metaModelos').addEventListener('click', e => {
  const b = e.target.closest('[data-modelo]'); if (!b) return;
  if (!state.metasOk) return toast('Esta área está temporariamente indisponível. Tente de novo mais tarde.');
  openMetaForm(null, MODELOS_META[Number(b.dataset.modelo)]);
});
$('metasGrid').addEventListener('click', e => {
  const g = e.target.closest('[data-mguardar]'); if (g) return openMetaMov(g.dataset.mguardar, 'guardar');
  const r = e.target.closest('[data-mretirar]'); if (r) return openMetaMov(r.dataset.mretirar, 'retirar');
  const u = e.target.closest('[data-musar]'); if (u) return openMetaUsar(u.dataset.musar);
  const mais = e.target.closest('[data-mmais]'); if (mais){ const m = findMeta(mais.dataset.mmais); if (m) return openMetaForm(m, null); }
  const c = e.target.closest('[data-meta]'); if (c) openMeta(c.dataset.meta);
});
const findMeta = id => state.metas.find(m => m.id === id);

// média de gastos dos últimos 3 meses fechados (para sugerir a reserva de emergência)
async function mediaGastos3m(){
  const h = new Date();
  const ini = mkey(h.getFullYear(), h.getMonth() - 3), fim = mkey(h.getFullYear(), h.getMonth());
  const { data, error } = await sb.from('lancamentos').select('valor,data').eq('controle_id', state.cid).eq('tipo', 'exp').gte('data', ini).lt('data', fim).neq('categoria', 'Metas');
  if (error || !data || !data.length) return 0;
  const meses = new Set(data.map(x => x.data.slice(0, 7))).size || 1;
  return r2(data.reduce((s, x) => s + Number(x.valor), 0) / meses);
}

function openMetaForm(m, modelo){
  const ic = m ? m.icone : (modelo ? modelo.icone : '🎯');
  const reserva = modelo && modelo.reserva;
  openDlg2(m ? 'Editar meta' : (modelo ? 'Nova meta' : 'Metas'), m ? m.nome : (modelo ? modelo.nome : 'Nova meta'), `
    <form id="metaForm" novalidate style="display:flex;flex-direction:column;gap:var(--space-4);">
      <div class="field">
        <label>Ícone</label>
        <div class="ic-pick" id="mfIcones">${ICONES_META.map(x => `<button type="button" data-ic="${x}" aria-pressed="${x === ic}">${x}</button>`).join('')}</div>
      </div>
      <div class="field">
        <label for="mfNome">Nome</label>
        <input class="input" id="mfNome" maxlength="60" autocomplete="off" placeholder="Viagem" value="${esc(m ? m.nome : (modelo ? modelo.nome : ''))}">
      </div>
      <div class="grid2">
        <div class="field">
          <label for="mfAlvo">Objetivo (R$)</label>
          <input class="input" id="mfAlvo" inputmode="numeric" data-dinheiro placeholder="0,00" value="${m ? num(Number(m.alvo)) : ''}">
        </div>
        <div class="field">
          <label for="mfPrazo">Até quando <span style="color:var(--muted);font-weight:400;">(opcional)</span></label>
          <input class="input" id="mfPrazo" type="month" value="${m && m.prazo ? m.prazo.slice(0, 7) : ''}">
        </div>
      </div>
      ${reserva ? `<div class="sugere" id="mfSugere">Calculando quanto você gasta por mês…</div>` : ''}
      <button class="btn btn-primary" type="submit" id="mfSalvar" style="min-height:44px;">${m ? 'Salvar alterações' : 'Criar meta'}</button>
    </form>`, { tipo: 'metaForm', id: m ? m.id : null, icone: ic });
  if (reserva){
    mediaGastos3m().then(media => {
      const box = $('mfSugere'); if (!box || dlg2.tipo !== 'metaForm') return;
      if (!media){ box.innerHTML = '🛡️ A reserva de emergência ideal é de <b>6 meses dos seus gastos</b>. Lance seus gastos por alguns meses e o app calcula o valor para você.'; return; }
      const alvo = r2(media * 6);
      box.innerHTML = `🛡️ Você gasta em média <b>${brl(media)}/mês</b>. A reserva ideal é de <b>6 meses</b>: <b>${brl(alvo)}</b>.
        <span style="color:var(--muted);">É o primeiro passo para blindar o seu bolso.</span>
        <button class="btn btn-secondary btn-sm" type="button" data-usar="${num(alvo)}" style="align-self:flex-start;">Usar ${brl(alvo)}</button>`;
    });
  }
}

function openMetaMov(id, tipo){
  const m = findMeta(id); if (!m) return;
  const i = infoMeta(m);
  const g = tipo === 'guardar';
  const sugere = g ? (i.porMes && i.porMes < i.falta ? i.porMes : i.falta) : i.saldo;
  openDlg2(`${g ? 'Guardar em' : 'Retirar de'} · ${m.icone}`, m.nome, `
    <div class="dlg-sec">
      <div class="kv"><span>Guardado</span><b>${brl(i.saldo)} de ${brl(i.alvo)}</b></div>
      ${g ? `<div class="kv"><span>Falta</span><b style="color:var(--accent-text);">${brl(i.falta)}</b></div>` : ''}
    </div>
    <div class="field">
      <label for="mmValor">${g ? 'Quanto você está guardando (R$)' : 'Quanto vai retirar (R$)'}</label>
      <input class="input" id="mmValor" inputmode="numeric" data-dinheiro value="${sugere > 0 ? num(sugere) : ''}" placeholder="0,00">
    </div>
    <div class="field">
      <label for="mmData">Data</label>
      <input class="input" id="mmData" type="date" value="${todayISO()}">
    </div>
    <label class="chk"><input type="checkbox" id="mmLancar"> ${g ? 'Lançar também como saída em Lançamentos' : 'Lançar também como entrada em Lançamentos'}</label>
    <p class="hint" style="margin:-8px 0 0;">${g ? 'Marque se o dinheiro saiu da sua conta do dia a dia (ex.: foi para a poupança).' : 'Marque se o dinheiro voltou para a sua conta do dia a dia.'}</p>
    <button class="btn btn-primary" type="button" data-act="mmConfirmar" style="min-height:44px;">${g ? 'Guardar' : 'Retirar'}</button>`,
    { tipo: 'metaMov', id, mov: tipo });
}

function openMetaUsar(id){
  const m = findMeta(id); if (!m) return;
  const i = infoMeta(m);
  openDlg2(`Usei o dinheiro · ${m.icone}`, m.nome, `
    <div class="dlg-sec">
      <div class="kv"><span>Juntado nesta meta</span><b class="verde">${brl(i.saldo)}</b></div>
    </div>
    <p class="hint" style="margin:0;">Use quando o dinheiro já foi usado para o objetivo (a viagem, a compra…). A meta fica em <b>Concluídas</b> como usada e sai do total guardado.</p>
    <div class="field">
      <label for="muData">Data</label>
      <input class="input" id="muData" type="date" value="${todayISO()}">
    </div>
    <label class="chk"><input type="checkbox" id="muLancar"> Lançar também como saída em Lançamentos</label>
    <p class="hint" style="margin:-8px 0 0;">Marque só se você ainda não lançou esse gasto. Se, quando guardou, o dinheiro já saiu como saída, deixe desmarcado para não contar duas vezes.</p>
    <button class="btn btn-ok" type="button" data-act="mmUsarOk" style="min-height:44px;">Confirmar: usei ${brl(i.saldo)}</button>`,
    { tipo: 'metaUsar', id });
}

function comemorar(id){
  const m = findMeta(id); if (!m) return;
  const i = infoMeta(m);
  openDlg2('Parabéns!', 'Meta concluída', `
    <div class="festa">
      <div class="festa-ic">${esc(m.icone)}</div>
      <p>Você chegou lá na meta <b>${esc(m.nome)}</b>.</p>
      <div class="valor">${brl(i.juntado)}</div>
      <p class="hint">${conquistaMeta(m, i)}</p>
    </div>
    <button class="btn btn-ok" type="button" data-act="mmVerConcl" style="min-height:44px;">Ver minhas conquistas</button>`,
    { tipo: 'metaFesta', id });
}

function openMeta(id){
  const m = findMeta(id); if (!m) return closeDlg2();
  const i = infoMeta(m);
  const mine = m.criado_por === myId();
  const pessoas = Object.entries(i.porPessoa).filter(([, v]) => v !== 0);
  openDlg2(`Meta · ${m.icone}`, m.nome, `
    <div class="dlg-sec">
      <div class="meta-vals"><b>${brl(i.juntado)}</b> <span style="color:var(--muted);">${i.enc ? 'usados' : `de ${brl(i.alvo)}`} · ${Math.floor(i.pct)}%</span></div>
      <div class="prog big${i.done ? ' ok' : ''}"><div style="width:${i.pct}%"></div></div>
      ${i.done ? `<div class="kv"><span>Situação</span><b class="verde">${conquistaMeta(m, i)}</b></div>` : `<div class="kv"><span>Falta</span><b>${brl(i.falta)}</b></div>`}
      <div class="kv"><span>Prazo</span><b>${m.prazo ? MONTHS[Number(m.prazo.slice(5,7)) - 1] + ' ' + m.prazo.slice(0, 4) : 'Sem prazo'}</b></div>
      ${!i.done && i.porMes ? `<div class="kv"><span>Para chegar no prazo</span><b>${brl(i.porMes)}/mês</b></div>` : ''}
      ${!i.done && i.ritmo > 0 ? `<div class="kv"><span>Seu ritmo</span><b>${brl(i.ritmo)}/mês${i.chegaEm ? ` · chega em ${mesCurto(i.chegaEm)}` : ''}</b></div>` : ''}
    </div>
    ${isShared() && pessoas.length ? `<div class="dlg-sec"><h3>Quem guardou</h3>${pessoas.map(([u, v]) => `<div class="person"><span>${esc(quem(u))}</span><b>${brl(v)}</b></div>`).join('')}</div>` : ''}
    <div class="dlg-sec">
      <h3>Histórico</h3>
      ${i.movs.length ? i.movs.slice().reverse().map(x => {
        const d = x.data.split('-');
        return `<div class="person"><span>${d[2]}/${d[1]} · ${esc(quem(x.user_id))} · <b style="color:${x.tipo === 'guardar' ? 'var(--green)' : 'var(--alerta)'};">${x.tipo === 'guardar' ? '+' : '−'} ${brl(Number(x.valor))}</b></span>
          ${x.user_id === myId() && !i.enc ? `<button class="btn btn-secondary btn-sm" type="button" data-act="mmDesfazer" data-id="${esc(x.id)}">Desfazer</button>` : ''}</div>`;
      }).join('') : '<p class="hint">Nada guardado ainda.</p>'}
    </div>
    <div class="row" style="flex-wrap:wrap;">
      ${i.done ? '' : '<button class="btn btn-primary" type="button" data-act="mmGuardar">Guardar</button>'}
      ${i.done && !i.enc ? '<button class="btn btn-ok" type="button" data-act="mmUsar">Usei o dinheiro</button>' : ''}
      ${i.saldo > 0 ? '<button class="btn btn-secondary" type="button" data-act="mmRetirar">Retirar</button>' : ''}
      ${i.done && !i.enc && mine ? '<button class="btn btn-secondary" type="button" data-act="mmEditar">Aumentar meta</button>' : ''}
      ${i.enc ? '<button class="btn btn-secondary" type="button" data-act="mmReabrir">Desfazer: usei o dinheiro</button>' : ''}
      ${mine && !(i.done && !i.enc) ? '<button class="btn btn-secondary" type="button" data-act="mmEditar">Editar</button>' : ''}
      ${mine ? '<button class="btn btn-danger" type="button" data-act="mmExcluir">Excluir</button>' : ''}
    </div>
    ${mine ? '' : `<p class="hint">Só ${esc(quem(m.criado_por))} (quem criou) pode editar ou excluir esta meta.</p>`}`,
    { tipo: 'meta', id });
}

$('dlg2Body').addEventListener('click', async e => {
  if (!String(dlg2.tipo || '').startsWith('meta')) return;
  const ic = e.target.closest('[data-ic]');
  if (ic){ dlg2.icone = ic.dataset.ic; document.querySelectorAll('#mfIcones button').forEach(b => b.setAttribute('aria-pressed', String(b === ic))); return; }
  const usar = e.target.closest('[data-usar]');
  if (usar){ $('mfAlvo').value = usar.dataset.usar; return; }
  const b = e.target.closest('[data-act^="mm"]'); if (!b) return;
  const a = b.dataset.act, id = dlg2.id, m = findMeta(id);
  let res;
  if (a === 'mmConfirmar'){
    const v = parseAmount($('mmValor').value);
    if (!(v > 0)) return toast('Informe um valor maior que zero.');
    if (dlg2.mov === 'retirar' && !await confirmar(`Retirar ${brl(v)} da meta "${m ? m.nome : ''}"?

O progresso da meta vai diminuir.`)) return;
    b.disabled = true;
    res = await sb.rpc('mover_meta', { meta: id, p_tipo: dlg2.mov, p_valor: v, p_data: $('mmData').value || todayISO(), p_lancar: $('mmLancar').checked });
    if (res.error){ b.disabled = false; return toast(rpcMsg(res.error)); }
    const antes = m ? infoMeta(m).done : false, mov = dlg2.mov;
    closeDlg2();
    await refresh();
    const depois = m && findMeta(id) ? infoMeta(findMeta(id)).done : false;
    if (!antes && depois) return comemorar(id);
    toast(mov === 'retirar' ? 'Retirada registrada.' : `${brl(v)} guardados.`, true);
    return;
  }
  if (a === 'mmVerConcl'){ closeDlg2(); state.metaAba = 'concluidas'; if (state.tab !== 'metas') setTab('metas'); renderMetas(); return; }
  if (!m) return closeDlg2();
  if (a === 'mmUsar') return openMetaUsar(id);
  if (a === 'mmUsarOk'){
    b.disabled = true;
    res = await sb.rpc('usar_meta', { meta: id, p_data: $('muData').value || todayISO(), p_lancar: $('muLancar').checked });
    if (res.error){ b.disabled = false; return toast(rpcMsg(res.error)); }
    closeDlg2(); state.metaAba = 'concluidas';
    toast(`Meta "${m.nome}" marcada como usada.`, true);
    return refresh();
  }
  if (a === 'mmReabrir'){
    if (!await confirmar(`Desfazer o "usei o dinheiro" da meta "${m.nome}"?\n\nO dinheiro volta para a meta${m.usado ? ` (${brl(Number(m.usado))})` : ''}. Se a saída foi lançada em Lançamentos, ela será apagada.`)) return;
    res = await sb.rpc('reabrir_meta', { meta: id });
    if (res.error) return toast(rpcMsg(res.error));
    await refresh(); return openMeta(id);
  }
  if (a === 'mmGuardar') return openMetaMov(id, 'guardar');
  if (a === 'mmRetirar') return openMetaMov(id, 'retirar');
  if (a === 'mmEditar') return openMetaForm(m, null);
  if (a === 'mmDesfazer'){
    if (!await confirmar('Desfazer este movimento?\n\nSe ele também foi lançado em Lançamentos, o lançamento será apagado.')) return;
    res = await sb.rpc('desfazer_meta_mov', { mov: b.dataset.id });
    if (res.error) return toast(rpcMsg(res.error));
    await refresh(); return openMeta(id);
  }
  if (a === 'mmExcluir'){
    if (!await confirmar(`Excluir a meta "${m.nome}"?\n\nO histórico dela será apagado. Lançamentos já feitos continuam em Lançamentos.`)) return;
    res = await sb.rpc('excluir_meta', { meta: id });
    if (res.error) return toast(rpcMsg(res.error));
    closeDlg2(); toast('Meta excluída.', true);
    if (await loadMetas()) renderMetas();
  }
});

$('dlg2Body').addEventListener('submit', async e => {
  if (e.target.id !== 'metaForm') return;
  e.preventDefault();
  const nome = $('mfNome').value.trim(), alvo = parseAmount($('mfAlvo').value);
  const prazoTxt = $('mfPrazo').value.trim();
  if (!nome) return toast('Dê um nome para a meta.');
  if (!(alvo > 0)) return toast('Informe o valor do objetivo.');
  let prazo = null;
  if (prazoTxt){
    const mm = prazoTxt.match(/^(\d{4})-(\d{1,2})$/) || prazoTxt.match(/^(\d{1,2})\/(\d{4})$/);
    if (!mm) return toast('Prazo inválido. Use mês e ano.');
    const [y, mo] = prazoTxt.includes('-') ? [mm[1], mm[2]] : [mm[2], mm[1]];
    prazo = `${y}-${pad(Number(mo))}-01`;
  }
  $('mfSalvar').disabled = true;
  const { data, error } = await sb.rpc('salvar_meta', { p_id: dlg2.id, cid: state.cid, p_nome: nome, p_icone: dlg2.icone || '🎯', p_alvo: alvo, p_prazo: prazo });
  if (error){ $('mfSalvar').disabled = false; return toast(rpcMsg(error)); }
  const editando = !!dlg2.id;
  closeDlg2();
  toast(editando ? 'Meta atualizada.' : 'Meta criada! Agora é só ir guardando.', true);
  if (await loadMetas()) renderMetas();
});

/* ======================= INVESTIMENTOS ======================= */
const TIPOS_INV = {
  poupanca:      { nome: 'Poupança',            ic: '🐷', idx: ['poupanca'] },
  cdb:           { nome: 'CDB',                 ic: '🏦', idx: ['cdi', 'pre', 'ipca'] },
  lci:           { nome: 'LCI',                 ic: '🏠', idx: ['cdi', 'pre', 'ipca'] },
  lca:           { nome: 'LCA',                 ic: '🌾', idx: ['cdi', 'pre', 'ipca'] },
  tesouro_selic: { nome: 'Tesouro Selic',       ic: '🏛️', idx: ['selic'] },
  tesouro_ipca:  { nome: 'Tesouro IPCA+',       ic: '📈', idx: ['ipca'] },
  tesouro_pre:   { nome: 'Tesouro Prefixado',   ic: '📌', idx: ['pre'] },
  acao:          { nome: 'Ações',               ic: '📊', idx: ['cotacao'] },
  fii:           { nome: 'Fundos imobiliários', ic: '🏢', idx: ['cotacao'] },
  outro:         { nome: 'Outro',               ic: '💼', idx: ['manual'] },
};
const IDX_LABEL = { cdi: '% do CDI', pre: 'Prefixado (% ao ano)', ipca: 'IPCA + (% ao ano)' };
const IR_ALIQ = d => d <= 180 ? 0.225 : d <= 360 ? 0.20 : d <= 720 ? 0.175 : 0.15;
const IOF_TAB = [96,93,90,86,83,80,76,73,70,66,63,60,56,53,50,46,43,40,36,33,30,26,23,20,16,13,10,6,3,0];
const isoDe = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
const pct = n => (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const numBR = (n, c = 2) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: c });
function diasUteis(a, b){
  let n = 0; const d = new Date(a + 'T12:00'), e = new Date(b + 'T12:00');
  while (d < e){ const w = d.getDay(); if (w && w < 6) n++; d.setDate(d.getDate() + 1); }
  return n;
}
Object.assign(state, { invs: [], invMovs: [], invOk: true, idx: { cdi: [], selic: [], ipca: [], selic_meta: [] }, idxDesde: null, idxEm: 0 });

let invSeq = 0;
async function loadInvest(){
  const seq = ++invSeq;
  if (!state.cid){ state.invs = []; state.invMovs = []; return true; }
  const cid = state.cid;
  const [i, m] = await Promise.all([
    sb.from('investimentos').select('*').eq('controle_id', cid).order('criado_em'),
    sb.from('inv_movs').select('id,investimento_id,user_id,tipo,valor,quantidade,data,lancamento_id,criado_em').eq('controle_id', cid).order('data').order('criado_em')
  ]);
  if (seq !== invSeq) return false;
  if (i.error || m.error){
    const e = i.error || m.error;
    state.invOk = !(['42P01','PGRST205','PGRST200'].includes(e.code) || /does not exist|could not find the table|schema cache/i.test(e.message || ''));
    state.invs = []; state.invMovs = [];
    return !state.invOk;
  }
  state.invOk = true; state.invs = i.data; state.invMovs = m.data;
  // taxas do Banco Central desde a aplicação mais antiga (cache de 1 hora)
  const h = new Date();
  let desde = isoDe(new Date(h.getFullYear() - 1, h.getMonth(), 1));
  m.data.forEach(x => { if (x.data < desde) desde = x.data; });
  if (!state.idxDesde || desde < state.idxDesde || Date.now() - state.idxEm > 3600e3){
    const all = [];
    for (let from = 0; ; from += 1000){
      const r = await sb.from('indices').select('serie,data,valor').gte('data', desde.slice(0, 7) + '-01').order('data').range(from, from + 999);
      if (r.error) break;
      all.push(...r.data);
      if (r.data.length < 1000) break;
    }
    if (seq !== invSeq) return false;
    state.idx = { cdi: [], selic: [], ipca: [], selic_meta: [] };
    all.forEach(x => { if (state.idx[x.serie]) state.idx[x.serie].push({ d: x.data, v: Number(x.valor) }); });
    state.idxDesde = desde; state.idxEm = Date.now();
  }
  return true;
}
let rtInvTimer = null;
function rtInvest(){
  clearTimeout(rtInvTimer);
  rtInvTimer = setTimeout(async () => { if (!$('viewApp').hidden && await loadInvest()) renderInvest(); }, 400);
}

/* ---------- cálculos ---------- */
const ultimo = s => { const a = state.idx[s]; return a.length ? a[a.length - 1] : null; };
const anual = diario => Math.pow(1 + diario / 100, 252) - 1;
function ipca12(){
  const a = state.idx.ipca; if (!a.length) return null;
  return a.slice(-12).reduce((f, x) => f * (1 + x.v / 100), 1) - 1;
}
function poupancaMensal(){
  const s = ultimo('selic'); if (!s) return null;
  const aa = anual(s.v);
  return aa > 0.085 ? 0.005 : Math.pow(1 + aa * 0.7, 1 / 12) - 1;   // regra da poupança (sem a TR, que é quase zero)
}
function fatorSerie(serie, de, ate, mult, extraAA){
  const arr = state.idx[serie]; let lo = 0, hi = arr.length;
  while (lo < hi){ const mid = (lo + hi) >> 1; if (arr[mid].d < de) lo = mid + 1; else hi = mid; }
  let f = 1, n = 0;
  for (let i = lo; i < arr.length && arr[i].d < ate; i++){ f *= 1 + arr[i].v / 100 * mult; n++; }
  if (extraAA) f *= Math.pow(1 + extraAA / 100, n / 252);
  return f;
}
function fatorIpca(de, ate){
  const a = state.idx.ipca; if (!a.length) return 1;
  const porMes = {}; a.forEach(x => { porMes[x.d.slice(0, 7)] = x.v; });
  const ult = a[a.length - 1].v;
  let f = 1, cur = new Date(de.slice(0, 7) + '-01T12:00');
  while (isoDe(cur) < ate){
    const mk = isoDe(cur), prox = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, 12), pk = isoDe(prox);
    const ini = de > mk ? de : mk, fim = ate < pk ? ate : pk;
    const frac = diasEntre(ini, fim) / diasEntre(mk, pk);
    const v = porMes[mk.slice(0, 7)] ?? ult;
    f *= Math.pow(1 + v / 100, frac);
    cur = prox;
  }
  return f;
}
function fatorInv(inv, de, ate){
  const t = Number(inv.taxa || 0);
  switch (inv.indexador){
    case 'cdi':      return fatorSerie('cdi', de, ate, t / 100, 0);
    case 'selic':    return fatorSerie('selic', de, ate, 1, t);
    case 'pre':      return Math.pow(1 + t / 100, diasUteis(de, ate) / 252);
    case 'ipca':     return fatorIpca(de, ate) * Math.pow(1 + t / 100, diasUteis(de, ate) / 252);
    case 'poupanca': { const r = poupancaMensal(); if (r === null) return 1; const a = new Date(de + 'T12:00'), b = new Date(ate + 'T12:00');
                       let m = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth(); if (b.getDate() < a.getDate()) m--; return Math.pow(1 + r, Math.max(0, m)); }
  }
  return 1;
}
function taxaMesAtual(inv){
  const h = new Date(), ini = isoDe(new Date(h.getFullYear(), h.getMonth(), 1)), fim = isoDe(new Date(h.getFullYear(), h.getMonth() + 1, 1));
  const du = diasUteis(ini, fim), t = Number(inv.taxa || 0);
  switch (inv.indexador){
    case 'cdi':      { const u = ultimo('cdi'); return u ? Math.pow(1 + u.v / 100 * t / 100, du) - 1 : null; }
    case 'selic':    { const u = ultimo('selic'); return u ? Math.pow(1 + u.v / 100, du) * Math.pow(1 + t / 100, du / 252) - 1 : null; }
    case 'pre':      return Math.pow(1 + t / 100, du / 252) - 1;
    case 'ipca':     { const u = ultimo('ipca'); return u ? (1 + u.v / 100) * Math.pow(1 + t / 100, 1 / 12) - 1 : null; }
    case 'poupanca': return poupancaMensal();
  }
  return null;
}
const precisaTaxa = inv => ({ cdi: 'cdi', selic: 'selic', ipca: 'ipca', poupanca: 'selic' })[inv.indexador];

function calcInv(inv){
  const movs = state.invMovs.filter(m => m.investimento_id === inv.id);
  const hoje = todayISO();
  if (inv.indexador === 'cotacao'){
    let q = 0, custo = 0;
    movs.forEach(m => { const qq = Number(m.quantidade || 0), v = Number(m.valor);
      if (m.tipo === 'aporte'){ custo += v; q += qq; }
      else if (m.tipo === 'resgate' && q > 0){ custo -= custo / q * qq; q -= qq; } });
    const pm = q ? custo / q : 0, preco = inv.cotacao ? Number(inv.cotacao) : pm, valor = r2(q * preco);
    return { movs, aplicado: r2(custo), liquido: valor, ganho: r2(valor - custo), ir: 0, mes: null, q, pm, preco, semCotacao: !inv.cotacao };
  }
  if (inv.indexador === 'manual'){
    let aplicado = 0, valor = 0, em = null;
    movs.forEach(m => { const v = Number(m.valor);
      if (m.tipo === 'aporte'){ aplicado += v; valor += v; } else if (m.tipo === 'resgate'){ aplicado -= v; valor -= v; } else { valor = v; em = m.data; } });
    return { movs, aplicado: r2(aplicado), liquido: r2(valor), ganho: r2(valor - aplicado), ir: 0, mes: null, em };
  }
  const semTaxa = precisaTaxa(inv) && !state.idx[precisaTaxa(inv)].length;
  let bruto = 0, aplicado = 0, pesoDias = 0, somaAp = 0;
  movs.forEach(m => {
    const v = Number(m.valor), s = m.tipo === 'aporte' ? 1 : -1;
    bruto += s * v * fatorInv(inv, m.data, hoje); aplicado += s * v;
    if (m.tipo === 'aporte'){ pesoDias += v * diasEntre(m.data, hoje); somaAp += v; }
  });
  const dias = somaAp ? pesoDias / somaAp : 0, ganhoBruto = bruto - aplicado;
  let ir = 0, iof = 0;
  if (!inv.isento && ganhoBruto > 0){
    if (dias < 30) iof = ganhoBruto * (IOF_TAB[Math.max(0, Math.floor(dias) - 1)] || 0) / 100;
    ir = (ganhoBruto - iof) * IR_ALIQ(dias);
  }
  const liquido = bruto - ir - iof;
  const tm = taxaMesAtual(inv);
  const mes = tm === null ? null : bruto * tm * (inv.isento ? 1 : 1 - IR_ALIQ(dias + 15));
  return { movs, aplicado: r2(aplicado), bruto: r2(bruto), liquido: r2(liquido), ganho: r2(liquido - aplicado), ir: r2(ir + iof), mes: mes === null ? null : r2(mes), dias, semTaxa };
}
function rendeTxt(inv){
  const t = Number(inv.taxa || 0);
  switch (inv.indexador){
    case 'cdi': return `${numBR(t)}% do CDI`;
    case 'pre': return `${numBR(t)}% ao ano`;
    case 'ipca': return `IPCA + ${numBR(t)}% a.a.`;
    case 'selic': return t ? `Selic + ${numBR(t, 4)}%` : '100% da Selic';
    case 'poupanca': return 'Regra da poupança';
    case 'cotacao': return inv.ticker || '';
    default: return 'Valor atualizado por você';
  }
}

/* ---------- tela ---------- */
function renderInvest(){
  const cdi = ultimo('cdi'), sel = ultimo('selic'), ip = ipca12();
  $('idxInfo').innerHTML = !state.invOk ? ''
    : !cdi && !sel ? '⏳ As taxas do Banco Central ainda não chegaram. Elas são buscadas automaticamente algumas vezes por dia.'
    : [cdi ? `CDI <b>${pct(anual(cdi.v))}</b> a.a.` : '', ultimo('selic_meta') ? `Selic <b>${numBR(ultimo('selic_meta').v)}%</b> a.a. (meta Copom)` : sel ? `Selic <b>${pct(anual(sel.v))}</b> a.a.` : '', ip !== null ? `IPCA 12 meses <b>${pct(ip)}</b>` : '',
       cdi ? `<span>atualizado em ${cdi.d.slice(8, 10)}/${cdi.d.slice(5, 7)} · Banco Central</span>` : ''].filter(Boolean).join(' · ');
  if (!state.invOk){
    $('invList').innerHTML = ''; $('invDist').innerHTML = '';
    $('invVazio').hidden = false;
    $('invVazio').textContent = 'Esta área está temporariamente indisponível. Tente de novo mais tarde.';
    $('invNovo').disabled = true;
    return;
  }
  $('invNovo').disabled = false;
  const lista = state.invs.map(inv => ({ inv, c: calcInv(inv) }));
  const aplicado = r2(lista.reduce((s, x) => s + x.c.aplicado, 0));
  const hoje = r2(lista.reduce((s, x) => s + x.c.liquido, 0));
  const mes = r2(lista.reduce((s, x) => s + (x.c.mes || 0), 0));
  const ganho = r2(hoje - aplicado);
  $('ivAplicado').textContent = brl(aplicado);
  $('ivAplicadoNote').textContent = lista.length ? plural(lista.length, 'investimento') : 'Nenhum ainda';
  $('ivHoje').textContent = brl(hoje);
  $('ivHojeNote').innerHTML = lista.length ? `${ganho >= 0 ? 'Rendeu' : 'Variação de'} <b class="${ganho >= 0 ? 'pos' : 'neg'}">${ganho >= 0 ? '+' : ''}${brl(ganho)}</b> já sem IR` : '';
  $('ivMes').textContent = (mes ? '+ ' : '') + brl(mes);
  $('ivMes').classList.toggle('zero', !mes); $('ivHoje').classList.toggle('zero', !hoje); $('ivAplicado').classList.toggle('zero', !lista.length);
  $('ivMesNote').textContent = lista.some(x => x.c.mes === null) && lista.length ? 'Renda fixa, já sem IR · ações e "outros" não entram' : 'Estimativa, já sem IR';
  $('invVazio').hidden = lista.length > 0;
  $('invVazio').textContent = 'Nenhum investimento ainda. Toque em "Novo investimento" e escolha o tipo: poupança, CDB, Tesouro, ações…';
  $('invList').innerHTML = lista.map(({ inv, c }) => {
    const T = TIPOS_INV[inv.tipo] || TIPOS_INV.outro;
    const sub = [T.nome, rendeTxt(inv), inv.vencimento ? `vence ${inv.vencimento.slice(5, 7)}/${inv.vencimento.slice(0, 4)}` : '',
                 inv.indexador === 'cotacao' && c.q ? `${numBR(c.q, 6)} un.` : '', inv.isento ? 'isento de IR' : ''].filter(Boolean).join(' · ');
    const g = c.ganho, gp = c.aplicado > 0 ? g / c.aplicado : 0;
    return `
    <div class="inv" data-inv="${esc(inv.id)}">
      <span class="inv-ic">${T.ic}</span>
      <div style="min-width:0;"><div style="font-weight:600;" class="ellip">${esc(inv.nome)}</div><div class="by" style="margin:0;">${esc(sub)}</div></div>
      <div class="inv-side">
        <b>${brl(c.liquido)}</b>
        <span class="${g >= 0 ? 'pos' : 'neg'}" style="font-size:13px;">${g >= 0 ? '+' : ''}${brl(g)} (${g >= 0 ? '+' : ''}${pct(gp)})</span>
        ${c.mes ? `<span class="by" style="margin:0;">este mês ≈ +${brl(c.mes)}</span>`
          : c.semTaxa ? '<span class="by" style="margin:0;">aguardando taxas</span>'
          : inv.indexador === 'cotacao' && c.semCotacao ? '<span class="by" style="margin:0;">informe a cotação</span>' : ''}
      </div>
    </div>`;
  }).join('');
  const porTipo = {};
  lista.forEach(({ inv, c }) => { const k = (TIPOS_INV[inv.tipo] || TIPOS_INV.outro).nome; porTipo[k] = (porTipo[k] || 0) + c.liquido; });
  const tops = Object.entries(porTipo).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const max = tops.length ? tops[0][1] : 0;
  $('invDist').innerHTML = tops.length ? tops.map(([n, v]) => `
    <div style="display:flex;flex-direction:column;gap:5px;">
      <div style="display:flex;justify-content:space-between;gap:var(--space-3);font-size:14px;"><span>${esc(n)}</span><span style="font-variant-numeric:tabular-nums;color:var(--muted);">${brl(v)} · ${Math.round(hoje ? v / hoje * 100 : 0)}%</span></div>
      <div style="height:6px;background:var(--track);border-radius:999px;overflow:hidden;"><div style="height:100%;width:${max ? v / max * 100 : 0}%;background:var(--accent);border-radius:999px;"></div></div>
    </div>`).join('') : '<span style="font-size:14px;color:var(--muted);">Nada investido ainda.</span>';
}

$('invNovo').onclick = () => openInvForm(null);
$('invList').addEventListener('click', e => { const r = e.target.closest('[data-inv]'); if (r) openInv(r.dataset.inv); });
const findInv = id => state.invs.find(x => x.id === id);

function openInvForm(tipo){
  const T = tipo ? TIPOS_INV[tipo] : null;
  const idxs = T ? T.idx : [];
  const ix = idxs[0];
  const rf = T && !['cotacao', 'manual'].includes(ix);
  const PH = { poupanca: 'Poupança', cdb: 'CDB', lci: 'LCI', lca: 'LCA', tesouro_selic: 'Tesouro Selic 2029', tesouro_ipca: 'Tesouro IPCA+ 2035', tesouro_pre: 'Tesouro Prefixado 2031', outro: 'Previdência' };
  openDlg2(T ? 'Novo investimento' : 'Investimentos', T ? `${T.ic} ${T.nome}` : 'Qual o tipo?', `
    <div class="tipo-grid" id="ifTipos">${Object.entries(TIPOS_INV).map(([k, t]) => `<button type="button" data-tipo="${k}" aria-pressed="${k === tipo}"><span>${t.ic}</span>${t.nome}</button>`).join('')}</div>
    ${!T ? '<p class="hint">Escolha o tipo para continuar.</p>' : `
    <form id="invForm" novalidate style="display:flex;flex-direction:column;gap:var(--space-4);">
      ${ix === 'cotacao' ? `
      <div class="grid2">
        <div class="field"><label for="ifTicker">Código</label><input class="input" id="ifTicker" maxlength="7" autocapitalize="characters" placeholder="${tipo === 'fii' ? 'MXRF11' : 'PETR4'}"></div>
        <div class="field"><label for="ifNome">Nome</label><input class="input" id="ifNome" maxlength="60" placeholder="${tipo === 'fii' ? 'Maxi Renda' : 'Petrobras'}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="ifQtd">Quantidade</label><input class="input" id="ifQtd" inputmode="decimal" placeholder="10"></div>
        <div class="field"><label for="ifPreco">Preço pago (R$ por unidade)</label><input class="input" id="ifPreco" inputmode="numeric" data-dinheiro placeholder="0,00"></div>
      </div>
      <div class="field"><label for="ifCot">Cotação de hoje (R$) <span style="color:var(--muted);font-weight:400;">(opcional)</span></label><input class="input" id="ifCot" inputmode="numeric" data-dinheiro placeholder="0,00"></div>
      <p class="hint" style="margin:-6px 0 0;">Por enquanto a cotação é informada por você. A atualização automática pela bolsa vem numa próxima versão.</p>` : `
      <div class="field"><label for="ifNome">Nome</label><input class="input" id="ifNome" maxlength="60" placeholder="${PH[tipo] || ''}" value="${tipo === 'poupanca' ? 'Poupança' : ''}"></div>`}
      ${idxs.length > 1 ? `
      <div class="field"><label for="ifIdx">Como rende</label>
        <select class="input" id="ifIdx">${idxs.map(x => `<option value="${x}">${IDX_LABEL[x]}</option>`).join('')}</select></div>` : ''}
      ${rf && ix !== 'poupanca' ? `
      <div class="grid2">
        <div class="field"><label for="ifTaxa" id="ifTaxaLbl">${ix === 'selic' ? 'Extra além da Selic (% a.a.)' : IDX_LABEL[ix]}</label>
          <input class="input" id="ifTaxa" inputmode="decimal" placeholder="${ix === 'cdi' ? '110' : ix === 'selic' ? '0,05' : '12'}" value="${ix === 'selic' ? '0' : ''}"></div>
        <div class="field"><label for="ifVenc">Vencimento <span style="color:var(--muted);font-weight:400;">(opcional)</span></label><input class="input" id="ifVenc" type="date"></div>
      </div>
      ${ix === 'selic' ? '<p class="hint" style="margin:-6px 0 0;">A Selic o app já busca sozinho no Banco Central. Aqui vai só o extra que aparece na compra (ex.: Selic + 0,05%). Se não souber, deixe 0.</p>' : ''}` : ''}
      ${ix !== 'cotacao' ? `
      <div class="grid2">
        <div class="field"><label for="ifValor">Valor aplicado (R$)</label><input class="input" id="ifValor" inputmode="numeric" data-dinheiro placeholder="0,00"></div>
        <div class="field"><label for="ifData">Data da aplicação</label><input class="input" id="ifData" type="date" value="${todayISO()}"></div>
      </div>` : `
      <div class="field"><label for="ifData">Data da compra</label><input class="input" id="ifData" type="date" value="${todayISO()}"></div>`}
      ${ix === 'manual' ? `<div class="field"><label for="ifAtual">Quanto vale hoje (R$) <span style="color:var(--muted);font-weight:400;">(opcional)</span></label><input class="input" id="ifAtual" inputmode="numeric" data-dinheiro placeholder="0,00"></div>` : ''}
      <label class="chk"><input type="checkbox" id="ifLancar"> Lançar também como saída em Lançamentos</label>
      <button class="btn btn-primary" type="submit" id="ifSalvar" style="min-height:44px;">Adicionar investimento</button>
    </form>`}`, { tipo: 'invForm', invTipo: tipo });
  if ($('ifIdx')) $('ifIdx').onchange = () => { const v = $('ifIdx').value; $('ifTaxaLbl').textContent = IDX_LABEL[v]; $('ifTaxa').placeholder = v === 'cdi' ? '110' : '12'; };
}

function openInv(id){
  const inv = findInv(id); if (!inv) return closeDlg2();
  const c = calcInv(inv), T = TIPOS_INV[inv.tipo] || TIPOS_INV.outro;
  const mine = inv.criado_por === myId();
  const g = c.ganho;
  openDlg2(`${T.ic} ${T.nome}`, inv.nome, `
    <div class="dlg-sec">
      <div class="kv"><span>Aplicado</span><b>${brl(c.aplicado)}</b></div>
      ${c.bruto !== undefined ? `<div class="kv"><span>Valor bruto hoje</span><b>${brl(c.bruto)}</b></div>
      <div class="kv"><span>Imposto estimado</span><b>${inv.isento ? 'isento' : '− ' + brl(c.ir)}</b></div>` : ''}
      <div class="kv"><span>${c.bruto !== undefined ? 'Valor líquido hoje' : 'Valor hoje'}</span><b>${brl(c.liquido)}</b></div>
      <div class="kv"><span>Resultado</span><b class="${g >= 0 ? 'pos' : 'neg'}">${g >= 0 ? '+' : ''}${brl(g)}</b></div>
      ${c.mes ? `<div class="kv"><span>Deve render este mês</span><b class="pos">≈ +${brl(c.mes)}</b></div>` : ''}
      <div class="kv"><span>Rentabilidade</span><b>${esc(rendeTxt(inv))}</b></div>
      ${inv.vencimento ? `<div class="kv"><span>Vencimento</span><b>${inv.vencimento.split('-').reverse().join('/')}</b></div>` : ''}
      ${inv.indexador === 'cotacao' ? `<div class="kv"><span>Quantidade · preço médio</span><b>${numBR(c.q, 6)} · ${brl(c.pm)}</b></div>
      <div class="kv"><span>Cotação</span><b>${inv.cotacao ? brl(Number(inv.cotacao)) + (inv.cotacao_em ? ` (${inv.cotacao_em.slice(8, 10)}/${inv.cotacao_em.slice(5, 7)})` : '') : 'não informada'}</b></div>` : ''}
      ${c.semTaxa ? '<p class="hint">As taxas do Banco Central ainda não chegaram; por enquanto o valor aparece sem rendimento.</p>' : ''}
    </div>
    <div class="dlg-sec">
      <h3>Movimentações</h3>
      ${c.movs.length ? c.movs.slice().reverse().map(x => {
        const d = x.data.split('-');
        const lbl = x.tipo === 'aporte' ? (inv.indexador === 'cotacao' ? 'Compra' : 'Aplicação') : x.tipo === 'resgate' ? (inv.indexador === 'cotacao' ? 'Venda' : 'Resgate') : 'Valor atualizado';
        return `<div class="person"><span>${d[2]}/${d[1]}/${d[0].slice(2)} · ${lbl}${x.quantidade ? ` · ${numBR(x.quantidade, 6)} un.` : ''}${isShared() ? ` · ${esc(quem(x.user_id))}` : ''} · <b>${brl(Number(x.valor))}</b></span>
          ${x.user_id === myId() ? `<button class="btn btn-secondary btn-sm" type="button" data-act="ivDesfazer" data-id="${esc(x.id)}">Desfazer</button>` : ''}</div>`;
      }).join('') : '<p class="hint">Nenhuma movimentação.</p>'}
    </div>
    <div class="row" style="flex-wrap:wrap;">
      <button class="btn btn-primary" type="button" data-act="ivAporte">${inv.indexador === 'cotacao' ? 'Comprar mais' : 'Aplicar mais'}</button>
      <button class="btn btn-secondary" type="button" data-act="ivResgate">${inv.indexador === 'cotacao' ? 'Vender' : 'Resgatar'}</button>
      ${inv.indexador === 'manual' ? '<button class="btn btn-secondary" type="button" data-act="ivSaldo">Atualizar valor</button>' : ''}
      ${inv.indexador === 'cotacao' ? '<button class="btn btn-secondary" type="button" data-act="ivCotacao">Atualizar cotação</button>' : ''}
      ${mine ? '<button class="btn btn-danger" type="button" data-act="ivExcluir">Excluir</button>' : ''}
    </div>`, { tipo: 'invDet', id });
}

function openInvMov(id, tipo){
  const inv = findInv(id); if (!inv) return;
  const cot = inv.indexador === 'cotacao';
  const titulo = { aporte: cot ? 'Comprar mais' : 'Aplicar mais', resgate: cot ? 'Vender' : 'Resgatar', saldo: 'Atualizar valor' }[tipo];
  openDlg2(titulo, inv.nome, `
    ${cot ? `
    <div class="grid2">
      <div class="field"><label for="imQtd">Quantidade</label><input class="input" id="imQtd" inputmode="decimal" placeholder="10"></div>
      <div class="field"><label for="imPreco">Preço por unidade (R$)</label><input class="input" id="imPreco" inputmode="numeric" data-dinheiro placeholder="0,00" value="${inv.cotacao ? num(Number(inv.cotacao)) : ''}"></div>
    </div>` : `
    <div class="field"><label for="imValor">${tipo === 'saldo' ? 'Quanto vale hoje (R$)' : 'Valor (R$)'}</label><input class="input" id="imValor" inputmode="numeric" data-dinheiro placeholder="0,00"></div>`}
    <div class="field"><label for="imData">Data</label><input class="input" id="imData" type="date" value="${todayISO()}"></div>
    ${tipo !== 'saldo' ? `<label class="chk"><input type="checkbox" id="imLancar"> Lançar também ${tipo === 'aporte' ? 'como saída' : 'como entrada'} em Lançamentos</label>` : ''}
    <button class="btn btn-primary" type="button" data-act="ivConfirmar" style="min-height:44px;">Confirmar</button>`,
    { tipo: 'invMov', id, mov: tipo });
}

$('dlg2Body').addEventListener('click', async e => {
  if (!String(dlg2.tipo || '').startsWith('inv')) return;
  const tb = e.target.closest('#ifTipos [data-tipo]');
  if (tb) return openInvForm(tb.dataset.tipo);
  const b = e.target.closest('[data-act^="iv"]'); if (!b) return;
  const a = b.dataset.act, id = dlg2.id, inv = findInv(id);
  let res;
  if (a === 'ivConfirmar'){
    const cot = inv && inv.indexador === 'cotacao';
    let valor, qtd = null;
    if (cot){
      qtd = parseAmount($('imQtd').value); const preco = parseAmount($('imPreco').value);
      if (!(qtd > 0)) return toast('Informe a quantidade.');
      if (!(preco > 0)) return toast('Informe o preço por unidade.');
      valor = r2(qtd * preco);
    } else {
      valor = parseAmount($('imValor').value);
      if (!(valor > 0)) return toast('Informe um valor maior que zero.');
    }
    if (dlg2.mov === 'resgate' && !await confirmar(cot ? `Vender ${numBR(qtd, 6)} un. de ${inv.ticker || inv.nome} por ${brl(valor)}?` : `Resgatar ${brl(valor)} de "${inv.nome}"?

O valor sai deste investimento.`)) return;
    b.disabled = true;
    res = await sb.rpc('mover_investimento', { inv: id, p_tipo: dlg2.mov, p_valor: valor, p_quantidade: qtd, p_data: $('imData').value || todayISO(), p_lancar: !!($('imLancar') && $('imLancar').checked) });
    if (res.error){ b.disabled = false; return toast(rpcMsg(res.error)); }
    closeDlg2(); toast('Movimentação registrada.', true);
    await refresh(); return openInv(id);
  }
  if (!inv) return closeDlg2();
  if (a === 'ivAporte') return openInvMov(id, 'aporte');
  if (a === 'ivResgate') return openInvMov(id, 'resgate');
  if (a === 'ivSaldo') return openInvMov(id, 'saldo');
  if (a === 'ivCotacao'){
    const v = await pedirTexto('Atualizar cotação', '', { rotulo: `Cotação de hoje de ${inv.ticker || inv.nome} (R$ por unidade)`, valor: inv.cotacao ? num(Number(inv.cotacao)) : '', modo: 'decimal', okTxt: 'Salvar' });
    if (v === null) return;
    const p = parseAmount(v); if (!(p > 0)) return toast('Informe um preço maior que zero.');
    res = await sb.rpc('atualizar_cotacao', { inv: id, p_preco: p });
    if (res.error) return toast(rpcMsg(res.error));
    await loadInvest(); renderInvest(); return openInv(id);
  }
  if (a === 'ivDesfazer'){
    if (!await confirmar('Desfazer esta movimentação?\n\nSe ela também foi lançada em Lançamentos, o lançamento será apagado.')) return;
    res = await sb.rpc('desfazer_inv_mov', { mov: b.dataset.id });
    if (res.error) return toast(rpcMsg(res.error));
    await refresh(); return openInv(id);
  }
  if (a === 'ivExcluir'){
    if (!await confirmar(`Excluir "${inv.nome}" e todo o histórico dele?\n\nLançamentos já feitos continuam em Lançamentos.`)) return;
    res = await sb.rpc('excluir_investimento', { inv: id });
    if (res.error) return toast(rpcMsg(res.error));
    closeDlg2(); toast('Investimento excluído.', true);
    if (await loadInvest()) renderInvest();
  }
});

$('dlg2Body').addEventListener('submit', async e => {
  if (e.target.id !== 'invForm') return;
  e.preventDefault();
  const tipo = dlg2.invTipo, T = TIPOS_INV[tipo];
  const ix = $('ifIdx') ? $('ifIdx').value : T.idx[0];
  let nome = $('ifNome').value.trim();
  const ticker = $('ifTicker') ? $('ifTicker').value.trim().toUpperCase() : null;
  if (!nome && ticker) nome = ticker;
  if (!nome) return toast('Dê um nome ao investimento.');
  const taxa = $('ifTaxa') ? parseAmount($('ifTaxa').value || '0') : null;
  if (ix === 'cdi' && !(taxa > 0)) return toast('Informe quanto rende do CDI (ex.: 110).');
  if (['pre', 'ipca'].includes(ix) && !(taxa >= 0 && $('ifTaxa').value.trim())) return toast('Informe a taxa ao ano.');
  let valor, qtd = null, cot = null;
  if (ix === 'cotacao'){
    qtd = parseAmount($('ifQtd').value); const preco = parseAmount($('ifPreco').value);
    if (!/^[A-Z0-9]{4,7}$/.test(ticker || '')) return toast('Informe o código do ativo (ex.: PETR4).');
    if (!(qtd > 0)) return toast('Informe a quantidade.');
    if (!(preco > 0)) return toast('Informe o preço pago por unidade.');
    valor = r2(qtd * preco);
    cot = $('ifCot').value.trim() ? parseAmount($('ifCot').value) : null;
  } else {
    valor = parseAmount($('ifValor').value);
    if (!(valor > 0)) return toast('Informe o valor aplicado.');
  }
  const data = $('ifData').value || todayISO();
  $('ifSalvar').disabled = true;
  const r1 = await sb.rpc('salvar_investimento', { p_id: null, cid: state.cid, p_nome: nome, p_tipo: tipo, p_indexador: ix, p_taxa: taxa, p_vencimento: ($('ifVenc') && $('ifVenc').value) || null, p_ticker: ticker });
  if (r1.error){ $('ifSalvar').disabled = false; return toast(rpcMsg(r1.error)); }
  const r2_ = await sb.rpc('mover_investimento', { inv: r1.data, p_tipo: 'aporte', p_valor: valor, p_quantidade: qtd, p_data: data, p_lancar: $('ifLancar').checked });
  if (r2_.error) toast(rpcMsg(r2_.error));
  if (ix === 'manual' && $('ifAtual').value.trim()){ const v = parseAmount($('ifAtual').value); if (v > 0) await sb.rpc('mover_investimento', { inv: r1.data, p_tipo: 'saldo', p_valor: v, p_quantidade: null, p_data: todayISO(), p_lancar: false }); }
  if (ix === 'cotacao' && cot > 0) await sb.rpc('atualizar_cotacao', { inv: r1.data, p_preco: cot });
  closeDlg2();
  if (!r2_.error) toast('Investimento adicionado.', true);
  await refresh();
});

/* ======================= CARTÕES DE CRÉDITO ======================= */
// O app nunca guarda dados do cartão: só apelido, banco (para a cor), dia de fechamento, dia de vencimento e limite.
// Compra no cartão não entra no saldo. Ela vai para a fatura; pagar a fatura cria a saída em Lançamentos.
const BANCOS = [
  ['nubank','Nubank','🟣'], ['itau','Itaú','🟠'], ['bradesco','Bradesco','🔴'], ['santander','Santander','🔴'],
  ['bb','Banco do Brasil','🟡'], ['caixa','Caixa','🔵'], ['inter','Inter','🟠'], ['c6','C6 Bank','⚫'],
  ['picpay','PicPay','🟢'], ['mercadopago','Mercado Pago','🔵'], ['xp','XP','⚫'], ['btg','BTG Pactual','🔵'],
  ['neon','Neon','🔵'], ['pagbank','PagBank','🟢'], ['next','Next','🟢'], ['pan','Banco Pan','🔵'],
  ['sicredi','Sicredi','🟢'], ['sicoob','Sicoob','🟢'], ['will','Will Bank','🟡'], ['porto','Porto Bank','🔵'],
  ['banrisul','Banrisul','🔵'], ['original','Original','🟢']
].map(([k, nome, cor]) => ({ k, nome, cor }));
const CORES_CARTAO = ['💳','🟣','🟠','🔴','🟡','🟢','🔵','⚫','⚪','🟤'];
const bancoDe = k => BANCOS.find(b => b.k === k);
const iconeCartao = k => (k && (k.icone || (bancoDe(k.banco) || {}).cor)) || '💳';
const findCartao = id => (state.cartoes || []).find(k => k.id === id);
const ultimoDia = (y, m) => new Date(y, m + 1, 0).getDate();
const podeCartao = k => !!k && ((currentUser && k.criado_por === currentUser.id) || !!(current() || {}).sou_dono);
const podeCompra = c => !!c && ((currentUser && c.user_id === currentUser.id) || !!(current() || {}).sou_dono);
const mesCurtoAno = mk => `${MES_CURTO[Number(mk.slice(5, 7)) - 1].toLowerCase()}/${mk.slice(2, 4)}`;
Object.assign(state, { cartoes: [], compras: [], pagFat: [], cartOk: true, kcSel: '', kcVista: 'mes' });

// em qual fatura (mês do vencimento) cai uma compra (igual à conta do banco de dados)
function faturaDaCompra(k, iso){
  const [y, m, d] = iso.split('-').map(Number);
  const fecha = Math.min(k.fecha, ultimoDia(y, m - 1));
  return mkey(y, m - 1 + (d >= fecha ? 1 : 0) + (k.vence <= k.fecha ? 1 : 0));
}
function datasFatura(k, mk){
  const y = Number(mk.slice(0, 4)), m = Number(mk.slice(5, 7)) - 1;
  const vence = new Date(y, m, Math.min(k.vence, ultimoDia(y, m)));
  const c = new Date(y, k.vence <= k.fecha ? m - 1 : m, 1);
  const fecha = new Date(c.getFullYear(), c.getMonth(), Math.min(k.fecha, ultimoDia(c.getFullYear(), c.getMonth())));
  return { fecha, vence };
}
// valor da parcela j (0 = a 1ª) — os centavos que sobram ficam na 1ª parcela
function valorParcela(c, j){
  const tot = cents(Number(c.valor)), base = Math.floor(tot / c.parcelas);
  return (j === 0 ? tot - base * (c.parcelas - 1) : base) / 100;
}
const iniDe = c => Math.max(1, Number(c.parcela_ini) || 1);
// parcelas que caem numa fatura. A compra entra na fatura "fatura" pela parcela "parcela_ini"
// (parcelado que já estava rolando antes do app começa no meio)
function parcelasNaFatura(kid, mk){
  const out = [];
  (state.compras || []).forEach(c => {
    if (kid && c.cartao_id !== kid) return;
    const i = mdiff(c.fatura, mk), j = iniDe(c) - 1 + i;
    if (i < 0 || j >= c.parcelas) return;
    out.push({ c, i, n: j + 1, valor: valorParcela(c, j) });
  });
  return out.sort((a, b) => b.c.data.localeCompare(a.c.data) || a.c.descricao.localeCompare(b.c.descricao));
}
// parcelas pelo mês em que a compra foi feita: a primeira no mês da compra, as outras nos meses seguintes
function parcelasDoMes(kid, mk){
  const out = [];
  (state.compras || []).forEach(c => {
    if (kid && c.cartao_id !== kid) return;
    // a data é a da compra (1ª parcela); as parcelas já pagas antes do app ficam de fora
    const j = mdiff(c.data.slice(0, 7) + '-01', mk);
    if (j < iniDe(c) - 1 || j >= c.parcelas) return;
    out.push({ c, i: j, n: j + 1, valor: valorParcela(c, j) });
  });
  return out.sort((a, b) => (a.i > 0) - (b.i > 0) || b.c.data.localeCompare(a.c.data) || a.c.descricao.localeCompare(b.c.descricao));
}
// primeira fatura que ainda não venceu (igual ao banco): a do mês, se o vencimento não passou; senão a do mês seguinte
function faturaPendente(k){
  const h = new Date(); h.setHours(0, 0, 0, 0);
  const venc = new Date(h.getFullYear(), h.getMonth(), Math.min(k.vence, ultimoDia(h.getFullYear(), h.getMonth())));
  return mkey(h.getFullYear(), h.getMonth() + (h <= venc ? 0 : 1));
}
// quantas parcelas de uma compra já venceram (pela data da compra e a data de hoje)
function pagasPelaData(k, iso, n){
  const f0 = faturaDaCompra(k, iso);
  return Math.max(0, Math.min(n, mdiff(f0, faturaPendente(k))));
}
// fatura onde cai cada parcela
const faturaDaParcela = (c, n) => mkey(Number(c.fatura.slice(0, 4)), Number(c.fatura.slice(5, 7)) - 1 + n - iniDe(c));
// a fatura "aberta" de um mês: a que recebe a maior parte das compras dele (as do dia 15)
const faturaAbertaDoMes = (k, mk) => faturaDaCompra(k, mk.slice(0, 8) + '15');
function infoFatura(k, mk){
  const parcelas = parcelasNaFatura(k.id, mk);
  const total = r2(parcelas.reduce((s, p) => s + p.valor, 0));
  const pags = (state.pagFat || []).filter(p => p.cartao_id === k.id && p.mes === mk);
  const pago = r2(pags.reduce((s, p) => s + Number(p.valor), 0));
  const falta = Math.max(0, r2(total - pago));
  const { fecha, vence } = datasFatura(k, mk);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const days = Math.round((vence - hoje) / 86400000);
  const st = total <= 0 && pago <= 0 ? 'vazia' : falta <= 0 ? 'paga' : hoje < fecha ? 'aberta' : days < 0 ? 'vencida' : 'fechada';
  return { k, mk, parcelas, total, pags, pago: Math.min(pago, total), falta, fecha, vence, days, st };
}
// quanto do limite está ocupado: tudo que foi comprado menos o que já foi pago
function usadoCartao(k){
  // parcelado que começou no meio: só conta o que falta das parcelas
  const comprado = (state.compras || []).filter(c => c.cartao_id === k.id)
    .reduce((s, c) => { let v = Number(c.valor); for (let j = 0; j < iniDe(c) - 1; j++) v -= valorParcela(c, j); return s + v; }, 0);
  const pago = (state.pagFat || []).filter(p => p.cartao_id === k.id).reduce((s, p) => s + Number(p.valor), 0);
  return Math.max(0, r2(comprado - pago));
}
const cartoesAtivos = () => (state.cartoes || []).filter(k => !k.oculto);
const cartaoOn = () => state.cartOk && modOn('cartoes');

let cartSeq = 0;
async function loadCartoes(){
  const seq = ++cartSeq;
  if (!state.cid){ state.cartoes = []; state.compras = []; state.pagFat = []; return true; }
  const cid = state.cid;
  const [a, b, c] = await Promise.all([
    sb.from('cartoes').select('id,nome,banco,icone,fecha,vence,limite,oculto,criado_por').eq('controle_id', cid).order('criado_em'),
    sb.from('compras_cartao').select('id,cartao_id,user_id,descricao,categoria,valor,parcelas,data,fatura' + (state.cart2 !== false ? ',parcela_ini,ajuste' : '')).eq('controle_id', cid).order('data', { ascending: false }),
    sb.from('pag_faturas').select('id,cartao_id,mes,user_id,valor,data').eq('controle_id', cid).order('criado_em')
  ]);
  if (seq !== cartSeq) return false;
  // banco ainda sem o SQL "cartões parte 2": segue sem parcela inicial e sem saldo anterior
  if (b.error && state.cart2 !== false && (b.error.code === '42703' || /parcela_ini|ajuste/.test(b.error.message || ''))){ state.cart2 = false; return loadCartoes(); }
  if (!b.error && state.cart2 !== false) state.cart2 = true;
  const e = a.error || b.error || c.error;
  if (e){
    // sem o SQL dos cartões rodado: a área fica indisponível e o resto do app segue normal
    if (['42P01','PGRST205','PGRST200'].includes(e.code) || /does not exist|could not find the table|schema cache/i.test(e.message || '')){
      state.cartOk = false; state.cartoes = []; state.compras = []; state.pagFat = [];
    }
    return true;
  }
  state.cartOk = true;
  state.cartoes = a.data; state.compras = b.data; state.pagFat = c.data;
  if (state.kcSel && !findCartao(state.kcSel)) state.kcSel = '';
  return true;
}

/* ---------- aba Cartões ---------- */
function renderCartoes(){
  renderTodasCompras();
  if (!$('tabCartoes')) return;
  const mk = mkey(state.y, state.m), mkProx = mkey(state.y, state.m + 1);
  const ativos = cartoesAtivos();
  const lista = state.kcSel ? [findCartao(state.kcSel)].filter(Boolean) : (state.cartoes || []);
  $('kcNova').disabled = !state.cartOk || !ativos.length;
  $('kcMeus').disabled = !state.cartOk;
  if (!state.cartOk){
    ['kcFat','kcLim','kcProx'].forEach(id => { $(id).textContent = brl(0); });
    ['kcFatNote','kcLimNote','kcProxNote'].forEach(id => { $(id).textContent = ''; });
    $('kcChips').innerHTML = ''; $('kcFaturas').innerHTML = ''; $('kcCompras').innerHTML = ''; $('kcCats').innerHTML = '';
    $('kcDetalhe').hidden = true;
    $('kcVazio').hidden = false; $('kcVazio').textContent = 'Esta área está temporariamente indisponível. Tente de novo mais tarde.';
    return;
  }
  // escolher o cartão
  $('kcChips').hidden = (state.cartoes || []).length < 2;
  $('kcChips').innerHTML = `<button type="button" class="chip" data-kc-sel="" aria-pressed="${!state.kcSel}">Todos</button>` +
    (state.cartoes || []).filter(k => !k.oculto || k.id === state.kcSel).map(k =>
      `<button type="button" class="chip" data-kc-sel="${esc(k.id)}" aria-pressed="${state.kcSel === k.id}"><span class="kc-chip-ic">${esc(iconeCartao(k))}</span>${esc(k.nome)}</button>`).join('');

  const nomeMes = MONTHS[state.m].toLowerCase();
  const mesNome = m => MONTHS[Number(m.slice(5, 7)) - 1].toLowerCase();
  const infos = lista.map(k => infoFatura(k, mk));                                   // vencem neste mês
  const abertas = lista.map(k => infoFatura(k, faturaAbertaDoMes(k, mk)));          // recebem as compras deste mês
  const aPagar = infos.filter(i => i.mk !== faturaAbertaDoMes(i.k, mk) && (i.falta > 0 || (state.kcSel && i.st !== 'vazia')));
  const visiveis = [...aPagar, ...abertas.filter(i => i.st !== 'vazia' || state.kcSel)];
  const parcelas = parcelasDoMes(state.kcSel, mk);
  // 1) quanto foi no cartão neste mês (compras do mês + parcelas de compras antigas)
  // saldo anterior não é gasto do mês: fica na fatura, mas fora da soma e do "No que gastou"
  const doMes = parcelas.filter(p => !p.c.ajuste);
  const gasto = r2(doMes.reduce((s, p) => s + p.valor, 0));
  const novas = doMes.filter(p => p.i === 0).length, antigas = doMes.length - novas;
  $('kcGastoK').textContent = `Gasto no cartão em ${nomeMes}`;
  $('kcFat').textContent = brl(gasto); $('kcFat').classList.toggle('zero', !gasto);
  $('kcFatNote').textContent = !(state.cartoes || []).length ? 'Nenhum cartão cadastrado'
    : !doMes.length ? 'Nenhuma compra neste mês'
    : [novas ? plural(novas, 'compra') : '', antigas ? `${antigas} ${antigas === 1 ? 'parcela' : 'parcelas'} de antes` : ''].filter(Boolean).join(' + ');
  // 2) a fatura aberta (normalmente a do mês seguinte), onde caem as compras deste mês
  const mesesAbertos = [...new Set(abertas.map(i => i.mk))];
  const totAberta = r2(abertas.reduce((s, i) => s + i.total, 0));
  const faltaMes = r2(aPagar.reduce((s, i) => s + i.falta, 0));
  const um = state.kcSel ? abertas[0] : null;
  $('kcPagarK').textContent = mesesAbertos.length === 1 ? `Fatura de ${mesNome(mesesAbertos[0])}` : 'Faturas abertas';
  $('kcProx').textContent = brl(totAberta); $('kcProx').classList.toggle('zero', !totAberta);
  $('kcProxNote').textContent = faltaMes > 0 ? `A pagar ainda em ${nomeMes}: ${brl(faltaMes)}`
    : um ? ({ vazia: `Fecha ${ddmm(um.fecha)} · vence ${ddmm(um.vence)}`, paga: 'Paga ✓', aberta: `Fecha ${ddmm(um.fecha)} · vence ${ddmm(um.vence)}`,
              fechada: `Fechada · vence ${ddmm(um.vence)}`, vencida: `Vencida em ${ddmm(um.vence)}` })[um.st]
    : !lista.length ? '' : mesesAbertos.length === 1 ? `Vence em ${mesNome(mesesAbertos[0])}` : plural(lista.length, 'cartão');
  // 3) limite
  const comLimite = lista.filter(k => Number(k.limite) > 0);
  const limite = r2(comLimite.reduce((s, k) => s + Number(k.limite), 0));
  const usado = r2(comLimite.reduce((s, k) => s + usadoCartao(k), 0));
  $('kcLim').textContent = comLimite.length ? brl(r2(limite - usado)) : '—';
  $('kcLim').classList.toggle('zero', !comLimite.length);
  $('kcLimNote').textContent = comLimite.length ? `Usado ${brl(usado)} de ${brl(limite)}` : 'Cadastre o limite em Meus cartões';
  $('kcFatTit').textContent = 'Faturas';
  $('kcComTit').textContent = `Compras de ${nomeMes}`;

  $('kcVazio').hidden = visiveis.length > 0;
  $('kcVazio').textContent = !(state.cartoes || []).length
    ? 'Cadastre seu cartão em "Meus cartões": só o apelido (ex.: Nubank), o dia que a fatura fecha e o dia que vence. Nada de número ou senha.'
    : 'Nenhuma compra nas faturas deste mês.';
  $('kcFaturas').innerHTML = visiveis.map(i => fatHtml(i, true)).join('');

  $('kcDetalhe').hidden = !(state.cartoes || []).length || state.kcVista === 'todas';
  const shared = isShared();
  $('kcCompras').innerHTML = parcelas.length ? parcelas.map(p => {
    const c = p.c, k = findCartao(c.cartao_id), pode = podeCompra(c);
    const meta = [c.ajuste ? 'saldo anterior' : `${c.data.slice(8, 10)}/${c.data.slice(5, 7)}`, c.ajuste ? '' : esc(rotuloCat(c.categoria)),
      c.parcelas > 1 ? `${p.n}/${c.parcelas}` : '', !state.kcSel && k ? esc(k.nome) : '', shared ? esc(quem(c.user_id)) : '',
      `fatura ${mesCurtoAno(faturaDaParcela(c, p.n))}`].filter(Boolean).join(' · ');
    return `<div class="kc-compra${pode ? ' pode' : ''}"${pode ? ` data-kc-compra="${esc(c.id)}" role="button" tabindex="0"` : ''}>
      <span class="kc-ic">${c.ajuste ? '🧾' : esc(iconeCat(c.categoria) || '🏷️')}</span>
      <span style="min-width:0;"><span class="kc-d" style="display:block;">${esc(c.descricao)}</span><span class="by" style="margin:0;">${meta}</span></span>
      <span class="kc-v">− ${brl(p.valor)}</span>
      <span class="kc-acao">${pode ? `<button class="btn btn-ghost btn-icon" type="button" data-kc-edit="${esc(c.id)}" style="color:var(--muted);" aria-label="Editar ${esc(c.descricao)}"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button><button class="btn btn-ghost btn-icon" type="button" data-kc-del="${esc(c.id)}" style="color:var(--muted);" aria-label="Excluir ${esc(c.descricao)}"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>` : ''}</span>
    </div>`;
  }).join('') : '<p style="font-size:14px;color:var(--muted);margin:0;">Nenhuma compra no cartão neste mês.</p>';

  const byCat = {};
  doMes.forEach(p => { byCat[p.c.categoria] = r2((byCat[p.c.categoria] || 0) + p.valor); });
  const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const max = cats.length ? cats[0][1] : 0, soma = cats.reduce((s, x) => s + x[1], 0);
  $('kcCats').innerHTML = cats.length ? cats.map(([name, v]) => `
    <div style="display:flex;flex-direction:column;gap:5px;">
      <div style="display:flex;justify-content:space-between;gap:var(--space-3);font-size:14px;">
        <span>${esc(rotuloCat(name))}</span>
        <span style="font-variant-numeric:tabular-nums;color:var(--muted);">${brl(v)} · ${Math.round(soma ? v / soma * 100 : 0)}%</span>
      </div>
      <div style="height:6px;background:var(--track);border-radius:999px;overflow:hidden;"><div style="height:100%;width:${max ? v / max * 100 : 0}%;background:var(--accent);border-radius:999px;"></div></div>
    </div>`).join('') : '<span style="font-size:14px;color:var(--muted);">Sem compras neste mês.</span>';
}
// uma fatura em forma de linha (usada em Cartões e em Contas a pagar)
function fatHtml(i, naAbaCartoes){
  const k = i.k;
  const tag = i.st === 'paga' ? '<span class="tag tag-neutral">Paga ✓</span>'
    : i.st === 'vencida' ? '<span class="tag tag-red">Vencida</span>'
    : i.st === 'aberta' ? '<span class="tag tag-neutral">Aberta</span>'
    : i.st === 'vazia' ? ''
    : i.days === 0 ? '<span class="tag tag-accent">Vence hoje</span>'
    : i.days <= 3 ? `<span class="tag tag-accent">Vence em ${plural(i.days, 'dia')}</span>`
    : '<span class="tag tag-neutral">Fechada</span>';
  const cls = i.st === 'paga' ? 'paid' : i.st === 'vencida' ? 'late' : (i.st === 'fechada' && i.days <= 3) ? 'soon' : 'ok';
  const linha2 = [i.st === 'aberta' ? `fecha ${ddmm(i.fecha)}` : `fechou ${ddmm(i.fecha)}`, `vence ${ddmm(i.vence)}`,
    i.st !== 'paga' && i.pago > 0 ? `pago ${brl(i.pago)} de ${brl(i.total)}` : '', plural(i.parcelas.length, 'compra')].filter(Boolean).join(' · ');
  return `
    <div class="bill fat ${cls}" data-kc-fat="${esc(k.id)}" data-mk="${esc(i.mk)}">
      <div class="bill-day"><b>${i.vence.getDate()}</b><small>${MES_CURTO[i.vence.getMonth()]}</small></div>
      <div style="min-width:0;">
        <div class="bill-name">${esc(iconeCartao(k))} ${esc(k.nome)} · fatura de ${MONTHS[Number(i.mk.slice(5, 7)) - 1].toLowerCase()}</div>
        <div class="by">${linha2}</div>
        ${i.st !== 'paga' && i.pago > 0 ? `<div class="prog"><div style="width:${Math.min(100, i.pago / i.total * 100)}%"></div></div>` : ''}
      </div>
      <div class="bill-side">
        <span class="bill-val">${brl(i.total)}</span>
        <span class="bill-act" style="display:flex;gap:6px;align-items:center;">${tag}${naAbaCartoes && state.cart2 && i.st !== 'paga' ? `<button class="btn btn-ghost btn-sm" data-kc-ajustar="${esc(k.id)}" data-mk="${esc(i.mk)}" type="button" aria-label="Ajustar fatura ${esc(k.nome)}">Ajustar</button>` : ''}${i.falta > 0 ? `<button class="btn btn-primary btn-sm" data-kc-pagar="${esc(k.id)}" data-mk="${esc(i.mk)}" type="button" aria-label="Pagar fatura ${esc(k.nome)}">Pagar</button>` : ''}</span>
      </div>
    </div>`;
}
// faturas do mês que aparecem em Contas a pagar
function faturasDoMes(mk){
  if (!cartaoOn()) return [];
  return (state.cartoes || []).map(k => infoFatura(k, mk)).filter(i => i.total > 0);
}
function cliqueFatura(e){
  const aj = e.target.closest('[data-kc-ajustar]');
  if (aj){ e.stopPropagation(); return openAjuste(aj.dataset.kcAjustar, aj.dataset.mk, null); }
  const pg = e.target.closest('[data-kc-pagar]');
  if (pg){ e.stopPropagation(); return openPagarFatura(pg.dataset.kcPagar, pg.dataset.mk); }
  const f = e.target.closest('[data-kc-fat]');
  if (f){ state.kcSel = f.dataset.kcFat; if (state.tab !== 'cartoes') setTab('cartoes'); renderCartoes(); return true; }
}
$('kcFaturas').addEventListener('click', cliqueFatura);
$('billList').addEventListener('click', e => { if (e.target.closest('[data-kc-fat]')){ e.stopImmediatePropagation(); cliqueFatura(e); } }, true);
$('kcChips').addEventListener('click', e => {
  const b = e.target.closest('[data-kc-sel]'); if (!b) return;
  state.kcSel = b.dataset.kcSel; renderCartoes();
});
// "Todas as compras": cada compra uma vez (não as parcelas), da mais nova para a mais antiga
function renderTodasCompras(){
  if (!$('kcTodasSec')) return;
  const todas = state.kcVista === 'todas' && state.cartOk && (state.cartoes || []).length > 0;
  $('kcVistaRow').hidden = !state.cartOk || !(state.cartoes || []).length;
  document.querySelectorAll('[data-kc-vista]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kcVista === (todas ? 'todas' : 'mes'))));
  $('kcTodasSec').hidden = !todas;
  if (todas) $('kcDetalhe').hidden = true;
  if (!todas) return;
  const hoje = mkey(new Date().getFullYear(), new Date().getMonth());
  const q = semAcento($('kcBusca').value.trim());
  const lista = (state.compras || []).filter(c => {
    if (state.kcSel && c.cartao_id !== state.kcSel) return false;
    if (!q) return true;
    const k = findCartao(c.cartao_id);
    return semAcento(`${c.descricao} ${c.categoria} ${k ? k.nome : ''}`).includes(q);
  }).sort((a, b) => b.data.localeCompare(a.data) || a.descricao.localeCompare(b.descricao));
  // quanto ainda vai cair: parcelas em faturas deste mês em diante
  const aCair = c => { let v = 0, n = 0; for (let j = iniDe(c) - 1; j < c.parcelas; j++) if (faturaDaParcela(c, j + 1) >= hoje){ v += valorParcela(c, j); n++; } return { v: r2(v), n }; };
  const total = r2(lista.reduce((s, c) => s + Number(c.valor), 0));
  const futuro = r2(lista.reduce((s, c) => s + aCair(c).v, 0));
  $('kcTodasResumo').textContent = !lista.length ? '' :
    `${plural(lista.length, 'compra')} · ${brl(total)} no total` + (futuro > 0 ? ` · ainda vão cair ${brl(futuro)} em faturas` : '');
  const shared = isShared();
  let mesAtual = '';
  $('kcTodas').innerHTML = lista.length ? lista.map(c => {
    const k = findCartao(c.cartao_id), pode = podeCompra(c), m = c.data.slice(0, 7);
    const cab = m !== mesAtual ? `<div class="kc-mes-tit">${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}</div>` : '';
    mesAtual = m;
    const resto = aCair(c);
    const parc = c.ajuste ? `saldo anterior · fatura ${mesCurtoAno(c.fatura)}`
      : c.parcelas > 1 ? `${c.parcelas}x de ${brl(valorParcela(c, 1))}` + (iniDe(c) > 1 ? ` (desde a ${iniDe(c)}ª)` : '') + (resto.n ? ` · faltam ${resto.n}` : ' · quitada')
      : 'à vista';
    const meta = [c.ajuste ? '' : `${c.data.slice(8, 10)}/${c.data.slice(5, 7)}/${c.data.slice(2, 4)}`, k ? `${esc(iconeCartao(k))} ${esc(k.nome)}` : '',
      c.ajuste ? '' : esc(rotuloCat(c.categoria)), shared ? esc(quem(c.user_id)) : ''].filter(Boolean).join(' · ');
    return cab + `<div class="kc-compra${pode ? ' pode' : ''}"${pode ? ` data-kc-compra="${esc(c.id)}" role="button" tabindex="0"` : ''}>
      <span class="kc-ic">${c.ajuste ? '🧾' : esc(iconeCat(c.categoria) || '🏷️')}</span>
      <span style="min-width:0;"><span class="kc-d" style="display:block;">${esc(c.descricao)}</span><span class="by" style="margin:0;">${meta}</span></span>
      <span class="kc-v" style="text-align:right;">− ${brl(Number(c.valor))}<span class="kc-sub">${esc(parc)}</span></span>
      <span class="kc-acao">${pode ? `<button class="btn btn-ghost btn-icon" type="button" data-kc-edit="${esc(c.id)}" style="color:var(--muted);" aria-label="Editar ${esc(c.descricao)}"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button><button class="btn btn-ghost btn-icon" type="button" data-kc-del="${esc(c.id)}" style="color:var(--muted);" aria-label="Excluir ${esc(c.descricao)}"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>` : ''}</span>
    </div>`;
  }).join('') : `<p style="font-size:14px;color:var(--muted);margin:0;">${q ? 'Nenhuma compra encontrada.' : 'Nenhuma compra no cartão ainda.'}</p>`;
}
$('kcVista').addEventListener('click', e => {
  const b = e.target.closest('[data-kc-vista]'); if (!b) return;
  state.kcVista = b.dataset.kcVista; renderCartoes();
});
$('kcBusca').addEventListener('input', () => renderTodasCompras());

async function cliqueCompras(e){
  const del = e.target.closest('[data-kc-del]');
  if (del){
    const c = (state.compras || []).find(x => x.id === del.dataset.kcDel); if (!c) return;
    if (!await confirmar(`Excluir esta compra?\n\n${c.descricao} · ${brl(Number(c.valor))}${c.parcelas > 1 ? ` em ${c.parcelas}x (todas as parcelas)` : ''}`)) return;
    del.disabled = true;
    const { error } = await sb.rpc('excluir_compra', { p_id: c.id });
    if (error){ del.disabled = false; return toast(rpcMsg(error)); }
    await loadCartoes(); render();
    return toast('Compra excluída.', true);
  }
  const ed = e.target.closest('[data-kc-edit]');
  if (ed){ const c = (state.compras || []).find(x => x.id === ed.dataset.kcEdit); return c && c.ajuste ? openAjuste(c.cartao_id, c.fatura, c) : openCompra(ed.dataset.kcEdit); }
  const r = e.target.closest('[data-kc-compra]');
  if (r){ const c = (state.compras || []).find(x => x.id === r.dataset.kcCompra); if (c && c.ajuste) openAjuste(c.cartao_id, c.fatura, c); else openCompra(r.dataset.kcCompra); }
}
$('kcCompras').addEventListener('click', cliqueCompras);
$('kcTodas').addEventListener('click', cliqueCompras);
$('kcTodas').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const r = e.target.closest('[data-kc-compra]'); if (r && !e.target.closest('button')){ e.preventDefault(); cliqueCompras(e); }
});
$('kcCompras').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const r = e.target.closest('[data-kc-compra]'); if (r){ e.preventDefault(); openCompra(r.dataset.kcCompra); }
});
$('kcMeus').onclick = () => openMeusCartoes();
$('kcNova').onclick = () => openCompra(null);

/* ---------- Lançamentos: "Pagar com" ---------- */
const opcoesParc = atual => Array.from({ length: 24 }, (_, i) => i + 1)
  .map(n => `<option value="${n}"${n === atual ? ' selected' : ''}>${n === 1 ? 'À vista (1x)' : n + 'x'}</option>`).join('');
$('parc').innerHTML = opcoesParc(1);
function pagComOpcoes(){
  const sel = $('pagCom'), atual = sel.value;
  const on = cartaoOn() && state.type === 'exp';
  $('pagComWrap').hidden = !on;
  if (!on){ sel.value = ''; aplicarPagCom(); return; }
  sel.innerHTML = '<option value="">💵 Dinheiro, débito ou Pix</option>' +
    (cartoesAtivos().length ? `<optgroup label="Cartão de crédito">${cartoesAtivos().map(k => `<option value="${esc(k.id)}">${esc(iconeCartao(k))} ${esc(k.nome)}</option>`).join('')}</optgroup>` : '') +
    '<option value="__novo">+ Cadastrar cartão…</option>';
  sel.value = [...sel.options].some(o => o.value === atual) && atual !== '__novo' ? atual : '';
  sel.dataset.ultimo = sel.value;
  aplicarPagCom();
}
function aplicarPagCom(){
  const k = findCartao($('pagCom').value);
  $('parcWrap').hidden = !k;
  // no cartão o "Usar para" (meta/conta) não se aplica
  if (k && $('vinc').value){ $('vinc').value = ''; aplicarVinc(false); }
  $('vinc').disabled = !!k || $('vinc').options.length <= 1;
  $('pagCom').disabled = !!vincAlvo();
  kcHintForm();
}
function kcHintForm(){
  const k = findCartao($('pagCom').value), h = $('kcHint');
  if (!k){ h.hidden = true; return; }
  const iso = $('date').value || todayISO(), n = Number($('parc').value) || 1;
  const f0 = faturaDaCompra(k, iso), pagas = pagasPelaData(k, iso, n);
  const v = parseAmount($('amount').value);
  const soma = (m, x) => mkey(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + x);
  if (pagas >= n){ h.textContent = `💳 Essa compra já foi toda paga (a última parcela caiu em ${mlabel(soma(f0, n - 1))}). Não precisa lançar.`; h.hidden = false; return; }
  const f = soma(f0, pagas), faltam = n - pagas;
  h.textContent = `💳 ${pagas ? `${pagas} ${pagas === 1 ? 'parcela já passou' : 'parcelas já passaram'}. ` : ''}Vai para a fatura de ${mlabel(f)} do ${k.nome}` +
    (faltam > 1 ? `, em ${faltam}x${v > 0 ? ' de ' + brl(Math.floor(cents(v) / n) / 100) : ''} até ${mlabel(soma(f, faltam - 1))}` : '') +
    '. Não mexe no saldo agora: entra quando a fatura for paga.';
  h.hidden = false;
}
$('pagCom').addEventListener('change', async () => {
  const sel = $('pagCom');
  if (sel.value === '__novo'){
    sel.value = sel.dataset.ultimo || '';
    const novo = await janelaCartao(null);
    if (novo){ pagComOpcoes(); sel.value = novo; }
  }
  sel.dataset.ultimo = sel.value;
  aplicarPagCom();
});
['parc', 'date'].forEach(id => $(id).addEventListener('change', kcHintForm));
$('amount').addEventListener('input', () => { if (!$('kcHint').hidden) kcHintForm(); });
$('vinc').addEventListener('change', () => { $('pagCom').disabled = !!vincAlvo(); });

// gravar a compra no cartão (chamado pelo formulário de Lançamentos)
async function salvarCompraForm(desc, amount){
  const k = findCartao($('pagCom').value); if (!k) return false;
  const data = $('date').value || todayISO(), n = Number($('parc').value) || 1, cat = $('cat').value;
  $('addBtn').disabled = true;
  const { data: f, error } = await sb.rpc('salvar_compra', { p_id: null, p_cartao: k.id, p_desc: desc, p_cat: cat, p_valor: amount, p_parcelas: n, p_data: data });
  $('addBtn').disabled = false;
  if (error){ showError(rpcMsg(error)); return true; }
  $('desc').value = ''; $('amount').value = ''; $('parc').value = '1';
  toast(`${brl(amount)}${n > 1 ? ` em ${n}x` : ''} na fatura de ${mlabel(String(f).slice(0, 10))} do ${k.nome}. Entra no saldo quando a fatura for paga.`, true);
  await loadCartoes(); render(); kcHintForm();
  $('desc').focus();
  return true;
}

/* ---------- janelas: cartão, meus cartões, compra, pagar fatura ---------- */
const opcoesDia = atual => Array.from({ length: 31 }, (_, i) => i + 1).map(d => `<option value="${d}"${d === atual ? ' selected' : ''}>Dia ${d}</option>`).join('');
function janelaCartao(k){
  return new Promise(res => {
    const banco = k ? (k.banco || 'outro') : '';
    openDlg2('Cartões', k ? 'Editar cartão' : 'Novo cartão', `
      <p class="hint" style="margin:0;">🔒 O app nunca pede número, CVV, validade ou senha. Só o que precisa para saber quando a fatura fecha e vence.</p>
      <div class="field"><label>Banco</label>
        <div class="kc-bancos" role="group" aria-label="Banco">${BANCOS.map(b => `<button type="button" class="kc-banco" data-kc-banco="${b.k}" aria-pressed="${banco === b.k}"><span>${b.cor}</span>${esc(b.nome)}</button>`).join('')}
          <button type="button" class="kc-banco" data-kc-banco="outro" aria-pressed="${banco === 'outro'}"><span>✏️</span>Outro</button></div>
      </div>
      <div class="field"><label for="kfNome">Apelido</label><input class="input" id="kfNome" maxlength="30" autocomplete="off" placeholder="Nubank" value="${k ? esc(k.nome) : ''}"></div>
      <div class="field" id="kfCorWrap"${banco === 'outro' ? '' : ' hidden'}><label>Cor</label>
        <div class="ct-emojis" role="group" aria-label="Cor">${CORES_CARTAO.map(c => `<button type="button" class="ct-emoji" data-kc-cor="${c}" aria-pressed="${(k && k.icone ? k.icone : '💳') === c}">${c}</button>`).join('')}</div>
      </div>
      <div class="kc-dias">
        <div class="field"><label for="kfFecha">Fatura fecha</label><select class="input" id="kfFecha">${opcoesDia(k ? k.fecha : 3)}</select></div>
        <div class="field"><label for="kfVence">Fatura vence</label><select class="input" id="kfVence">${opcoesDia(k ? k.vence : 10)}</select></div>
      </div>
      <div class="field"><label for="kfLim">Limite (opcional)</label><input class="input" id="kfLim" inputmode="numeric" data-dinheiro placeholder="5.000,00" value="${k && k.limite ? num(Number(k.limite)) : ''}" style="font-variant-numeric:tabular-nums;"></div>
      <span class="hint" style="margin:0;">Compras feitas no dia do fechamento ou depois vão para a fatura seguinte. As datas estão no app do banco, em "Fatura".</span>
      <span class="hint" id="kfErro" style="color:var(--alerta);" hidden></span>
      <button class="btn btn-primary" type="button" data-kc-salvar style="min-height:44px;">${k ? 'Salvar' : 'Cadastrar cartão'}</button>`,
      { tipo: 'kcform', k, res, banco, auto: k ? '' : null });
  });
}
function openMeusCartoes(){
  const l = (state.cartoes || []).slice().sort((a, b) => (a.oculto - b.oculto) || a.nome.localeCompare(b.nome));
  openDlg2('Cartões', 'Meus cartões', `
    <p class="hint" style="margin:0;">Só apelido, fechamento, vencimento e limite. ${isShared() ? 'Todos deste controle veem e lançam nestes cartões.' : 'Só você vê.'}</p>
    <div>${l.length ? l.map(k => `
      <div class="kc-item${k.oculto ? ' oculto' : ''}">
        <span class="kc-ic">${esc(iconeCartao(k))}</span>
        <span style="min-width:0;"><b>${esc(k.nome)}</b><small>fecha dia ${k.fecha} · vence dia ${k.vence}${Number(k.limite) > 0 ? ` · limite ${brl(Number(k.limite))}` : ''}${k.oculto ? ' · escondido' : ''}</small></span>
        <span class="kc-acoes">${podeCartao(k) ? `<button class="btn btn-ghost btn-sm" type="button" data-kc-editar="${esc(k.id)}">Editar</button>
          <button class="btn btn-ghost btn-sm" type="button" data-kc-ocultar="${esc(k.id)}">${k.oculto ? 'Mostrar' : 'Esconder'}</button>
          <button class="btn btn-ghost btn-sm" type="button" data-kc-excluir="${esc(k.id)}" style="color:var(--alerta);">Excluir</button>` : ''}</span>
      </div>`).join('') : '<p class="hint" style="margin:6px 0;">Nenhum cartão ainda.</p>'}</div>
    <button class="btn btn-primary" type="button" data-kc-novo style="min-height:44px;">+ Novo cartão</button>`, { tipo: 'kcmeus' });
}
function openCompra(id){
  const c = id ? (state.compras || []).find(x => x.id === id) : null;
  if (id && !c) return;
  const ativos = cartoesAtivos();
  const kid = c ? c.cartao_id : (state.kcSel && findCartao(state.kcSel) && !findCartao(state.kcSel).oculto ? state.kcSel : (ativos[0] || {}).id);
  const opts = (state.cartoes || []).filter(k => !k.oculto || k.id === kid)
    .map(k => `<option value="${esc(k.id)}"${k.id === kid ? ' selected' : ''}>${esc(iconeCartao(k))} ${esc(k.nome)}</option>`).join('');
  openDlg2('Cartão de crédito', c ? 'Editar compra' : 'Compra no cartão', `
    <div class="field"><label for="kpCartao">Cartão</label><select class="input" id="kpCartao">${opts}</select></div>
    <div class="field"><label for="kpDesc">Descrição</label><input class="input" id="kpDesc" maxlength="200" autocomplete="off" placeholder="Geladeira" value="${c ? esc(c.descricao) : ''}"></div>
    <div class="kc-dias">
      <div class="field"><label for="kpValor">Valor total (R$)</label><input class="input" id="kpValor" inputmode="numeric" data-dinheiro placeholder="0,00" value="${c ? num(Number(c.valor)) : ''}" style="font-variant-numeric:tabular-nums;"></div>
      <div class="field"><label for="kpParc">Parcelas</label><select class="input" id="kpParc">${opcoesParc(c ? c.parcelas : 1)}</select></div>
    </div>
    ${state.cart2 ? `<div class="field" id="kpIniWrap"${c && c.parcelas > 1 ? '' : ' hidden'}><label for="kpIni">Parcelas já pagas</label>
      <select class="input" id="kpIni">${opcoesIni(c ? c.parcelas : 1, c ? iniDe(c) - 1 : 0)}</select>
      <span class="hint" style="margin:0;">Compra antiga? Coloque a data em que você comprou: o app já conta as parcelas que venceram. Adiantou alguma? Ajuste aqui.</span></div>` : ''}
    <div class="kc-dias">
      <div class="field"><label for="kpCat">Categoria</label><select class="input" id="kpCat">${opcoesCat('exp', c ? c.categoria : null, false)}</select></div>
      <div class="field"><label for="kpData">Data da compra</label><input class="input" id="kpData" type="date" value="${c ? c.data : todayISO()}"></div>
    </div>
    <span class="hint" id="kpInfo" style="margin:0;"></span>
    <span class="hint" id="kpErro" style="color:var(--alerta);" hidden></span>
    <button class="btn btn-primary" type="button" data-kc-salvarcompra style="min-height:44px;">${c ? 'Salvar' : 'Lançar no cartão'}</button>
    ${c ? '<button class="btn btn-ghost" type="button" data-kc-excluircompra style="color:var(--alerta);">Excluir compra (todas as parcelas)</button>' : ''}`,
    { tipo: 'kccompra', c, pagasManual: !!c });
  kpInfo();
  if (!c) setTimeout(() => $('kpDesc').focus(), 0);
}
const opcoesIni = (n, atual) => Array.from({ length: n }, (_, i) => i)
  .map(i => `<option value="${i}"${i === atual ? ' selected' : ''}>${i === 0 ? 'Nenhuma' : `${i} de ${n}`}</option>`).join('');
function kpInfo(){
  const k = findCartao($('kpCartao').value); if (!k){ $('kpInfo').textContent = ''; return; }
  const n = Number($('kpParc').value) || 1, v = parseAmount($('kpValor').value), iso = $('kpData').value || todayISO();
  const auto = pagasPelaData(k, iso, n);
  // "parcelas já pagas": acompanha o número de parcelas e a data, até a pessoa mexer nele
  if ($('kpIni')){
    let atual = dlg2.pagasManual ? Math.min(Number($('kpIni').value) || 0, n - 1) : Math.min(auto, n - 1);
    if ($('kpIni').options.length !== n) $('kpIni').innerHTML = opcoesIni(n, atual);
    $('kpIni').value = String(atual);
    $('kpIniWrap').hidden = n < 2;
  }
  const f0 = faturaDaCompra(k, iso);
  const pagas = $('kpIni') && n > 1 ? Number($('kpIni').value) || 0 : 0;
  const parcela = Math.floor(cents(v) / n) / 100;
  const somaMes = (m, x) => mkey(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + x);
  if (auto >= n && !(dlg2.pagasManual && pagas < n)){
    $('kpInfo').textContent = `Essa compra já foi toda paga: a última parcela caiu na fatura de ${mlabel(somaMes(f0, n - 1))}. Não precisa lançar.`;
    return;
  }
  const primeira = somaMes(f0, pagas), faltam = n - pagas;
  $('kpInfo').textContent = (n === 1 ? `Vai para a fatura de ${mlabel(primeira)}.`
    : (pagas ? `${pagas} ${pagas === 1 ? 'parcela já passou' : 'parcelas já passaram'} e fica${pagas === 1 ? '' : 'm'} de fora. ` : '') +
      `${faltam === 1 ? 'A última parcela cai' : `As ${faltam} parcelas caem`} de ${mlabel(primeira)}${faltam > 1 ? ` a ${mlabel(somaMes(primeira, faltam - 1))}` : ''}` +
      (v > 0 ? ` (${brl(parcela)} cada).` : '.'));
}
function openAjuste(kid, mk, c){
  const k = findCartao(kid); if (!k) return;
  const i = infoFatura(k, mk);
  const outros = i.parcelas.filter(p => !p.c.ajuste).reduce((s, p) => s + p.valor, 0);
  openDlg2(`Ajustar · ${mlabel(mk)}`, `${iconeCartao(k)} ${k.nome} · fatura de ${MONTHS[Number(mk.slice(5, 7)) - 1].toLowerCase()}`, `
    <p class="hint" style="margin:0;">Começou a usar o app com a fatura já andando? Coloque aqui o valor que já estava nela, sem lançar compra por compra. Ele aparece como "Saldo anterior".</p>
    <div class="dlg-sec">
      <div class="kv"><span>Compras lançadas no app</span><b>${brl(r2(outros))}</b></div>
      <div class="kv"><span>Total da fatura agora</span><b>${brl(i.total)}</b></div>
      <div class="kv"><span>Vencimento</span><b>${ddmm(i.vence)}</b></div>
    </div>
    <div class="field"><label for="kaValor">Saldo anterior (R$)</label><input class="input" id="kaValor" inputmode="numeric" data-dinheiro placeholder="800,00" value="${c ? num(Number(c.valor)) : ''}" style="font-variant-numeric:tabular-nums;"></div>
    <div class="field"><label for="kaDesc">Descrição (opcional)</label><input class="input" id="kaDesc" maxlength="200" autocomplete="off" placeholder="Saldo anterior da fatura" value="${c && c.descricao !== 'Saldo anterior da fatura' ? esc(c.descricao) : ''}"></div>
    <span class="hint" id="kaErro" style="color:var(--alerta);" hidden></span>
    <button class="btn btn-primary" type="button" data-kc-salvarajuste style="min-height:44px;">${c ? 'Salvar' : 'Adicionar à fatura'}</button>
    ${c ? '<button class="btn btn-ghost" type="button" data-kc-excluirajuste style="color:var(--alerta);">Tirar o saldo anterior</button>' : ''}`,
    { tipo: 'kcajuste', kid, mk, c });
  setTimeout(() => $('kaValor').focus(), 0);
}
function openPagarFatura(kid, mk){
  const k = findCartao(kid); if (!k) return;
  const i = infoFatura(k, mk);
  const me = myId();
  openDlg2(`Pagar · ${mlabel(mk)}`, `${iconeCartao(k)} Fatura ${k.nome}`, `
    <div class="dlg-sec">
      <div class="kv"><span>Total da fatura</span><b>${brl(i.total)}</b></div>
      ${i.pago > 0 ? `<div class="kv"><span>Já pago</span><b>${brl(i.pago)}</b></div>` : ''}
      <div class="kv"><span>Falta pagar</span><b style="color:var(--accent-text);">${brl(i.falta)}</b></div>
      <div class="kv"><span>Vencimento</span><b>${ddmm(i.vence)}</b></div>
    </div>
    ${i.falta > 0 ? `<div class="dlg-sec" style="gap:var(--space-3);">
      <div class="field"><label for="kpgVal">Quanto você está pagando (R$)</label><input class="input" id="kpgVal" inputmode="numeric" data-dinheiro value="${num(i.falta)}" style="font-variant-numeric:tabular-nums;"></div>
      <div class="field"><label for="kpgData">Data do pagamento</label><input class="input" id="kpgData" type="date" value="${todayISO()}"></div>
      <span class="hint" style="margin:0;">Entra como saída em Lançamentos (💳 Cartão de crédito) e conta no saldo deste mês.</span>
      <span class="hint" id="kpgErro" style="color:var(--alerta);" hidden></span>
      <button class="btn btn-primary" type="button" data-kc-confpagar style="min-height:44px;">Registrar pagamento</button>
    </div>` : ''}
    ${i.pags.length ? `<div class="dlg-sec"><h3>Pagamentos</h3><div class="kc-pags">${i.pags.map(p => `
      <div class="kv"><span>${p.data.slice(8, 10)}/${p.data.slice(5, 7)} · ${esc(quem(p.user_id))}</span><b>${brl(Number(p.valor))}${p.user_id === me ? `<button class="btn btn-ghost btn-sm" type="button" data-kc-desfazer="${esc(p.id)}">Desfazer</button>` : ''}</b></div>`).join('')}</div></div>` : ''}`,
    { tipo: 'kcpag', kid, mk });
}

$('dlg2Body').addEventListener('click', async e => {
  const t = dlg2.tipo;
  if (!['kcform', 'kcmeus', 'kccompra', 'kcpag', 'kcajuste'].includes(t)) return;
  const ctx = dlg2;
  if (t === 'kcform'){
    const bb = e.target.closest('[data-kc-banco]');
    if (bb){
      document.querySelectorAll('[data-kc-banco]').forEach(x => x.setAttribute('aria-pressed', String(x === bb)));
      ctx.banco = bb.dataset.kcBanco;
      $('kfCorWrap').hidden = ctx.banco !== 'outro';
      // o apelido acompanha o banco enquanto a pessoa não escrever outro
      const b = bancoDe(ctx.banco), nome = $('kfNome');
      if (b && (!nome.value.trim() || nome.value === ctx.auto)){ nome.value = b.nome; ctx.auto = b.nome; }
      if (ctx.banco === 'outro' && nome.value === ctx.auto){ nome.value = ''; nome.focus(); }
      return;
    }
    const cor = e.target.closest('[data-kc-cor]');
    if (cor){ document.querySelectorAll('[data-kc-cor]').forEach(x => x.setAttribute('aria-pressed', String(x === cor))); return; }
    const sv = e.target.closest('[data-kc-salvar]'); if (!sv) return;
    const erro = m => { $('kfErro').textContent = m; $('kfErro').hidden = false; };
    const nome = $('kfNome').value.trim(), limTxt = $('kfLim').value.trim(), lim = limTxt ? parseAmount(limTxt) : null;
    if (!ctx.banco) return erro('Escolha o banco (ou "Outro").');
    if (!nome) return erro('Dê um apelido para o cartão.');
    if (/\d{12,}/.test(nome.replace(/[\s.-]/g, ''))) return erro('Não coloque o número do cartão. Use só um apelido, como "Nubank".');
    if (limTxt && !(lim > 0)) return erro('Limite inválido. Deixe em branco se não quiser informar.');
    const icone = ctx.banco === 'outro' ? ((document.querySelector('[data-kc-cor][aria-pressed="true"]') || {}).dataset || {}).kcCor || '💳' : null;
    sv.disabled = true;
    const { data: id, error } = await sb.rpc('salvar_cartao', { p_id: ctx.k ? ctx.k.id : null, cid: state.cid, p_nome: nome,
      p_banco: ctx.banco === 'outro' ? null : ctx.banco, p_icone: icone, p_fecha: Number($('kfFecha').value), p_vence: Number($('kfVence').value), p_limite: lim });
    sv.disabled = false;
    if (error) return erro(rpcMsg(error));
    await loadCartoes();
    closeDlg2(); render();
    toast(ctx.k ? 'Cartão atualizado.' : `Cartão "${nome}" cadastrado.`, true);
    if (ctx.res) ctx.res(id);
    return;
  }
  if (t === 'kcmeus'){
    if (e.target.closest('[data-kc-novo]')){ await janelaCartao(null); openMeusCartoes(); return; }
    const ed = e.target.closest('[data-kc-editar]');
    if (ed){ const k = findCartao(ed.dataset.kcEditar); if (k){ await janelaCartao(k); openMeusCartoes(); } return; }
    const oc = e.target.closest('[data-kc-ocultar]');
    if (oc){
      const k = findCartao(oc.dataset.kcOcultar); if (!k) return;
      oc.disabled = true;
      const { error } = await sb.rpc('ocultar_cartao', { p_id: k.id, p_oculto: !k.oculto });
      if (error){ oc.disabled = false; return toast(rpcMsg(error)); }
      await loadCartoes(); render(); openMeusCartoes();
      toast(k.oculto ? `"${k.nome}" voltou.` : `"${k.nome}" escondido. As compras dele continuam nas faturas.`, true);
      return;
    }
    const ex = e.target.closest('[data-kc-excluir]');
    if (ex){
      const k = findCartao(ex.dataset.kcExcluir); if (!k) return;
      const n = (state.compras || []).filter(c => c.cartao_id === k.id).length;
      if (!await confirmar(`Excluir o cartão "${k.nome}"?\n\n${n ? `As ${plural(n, 'compra')} dele somem junto. ` : ''}As faturas já pagas continuam em Lançamentos.`)) return openMeusCartoes();
      const { error } = await sb.rpc('excluir_cartao', { p_id: k.id });
      if (error){ toast(rpcMsg(error)); return openMeusCartoes(); }
      await loadCartoes(); render(); openMeusCartoes();
      toast('Cartão excluído.', true);
    }
    return;
  }
  if (t === 'kcajuste'){
    const erro = m => { $('kaErro').textContent = m; $('kaErro').hidden = false; };
    const sv = e.target.closest('[data-kc-salvarajuste]');
    if (sv){
      const v = parseAmount($('kaValor').value);
      if (!(v > 0)) return erro('Informe um valor maior que zero.');
      sv.disabled = true;
      const { error } = await sb.rpc('salvar_ajuste_fatura', { p_id: ctx.c ? ctx.c.id : null, p_cartao: ctx.kid, p_mes: ctx.mk, p_valor: v, p_desc: $('kaDesc').value.trim() || null });
      sv.disabled = false;
      if (error) return erro(rpcMsg(error));
      await loadCartoes(); closeDlg2(); render();
      toast(`Saldo anterior de ${brl(v)} na fatura de ${mlabel(ctx.mk)}.`, true);
      return;
    }
    if (e.target.closest('[data-kc-excluirajuste]') && ctx.c){
      if (!await confirmar(`Tirar o saldo anterior de ${brl(Number(ctx.c.valor))} desta fatura?`)) return openAjuste(ctx.kid, ctx.mk, ctx.c);
      const { error } = await sb.rpc('excluir_compra', { p_id: ctx.c.id });
      if (error){ toast(rpcMsg(error)); return; }
      await loadCartoes(); closeDlg2(); render();
      toast('Saldo anterior retirado.', true);
    }
    return;
  }
  if (t === 'kccompra'){
    const sv = e.target.closest('[data-kc-salvarcompra]');
    const erro = m => { $('kpErro').textContent = m; $('kpErro').hidden = false; };
    if (sv){
      const desc = $('kpDesc').value.trim(), v = parseAmount($('kpValor').value);
      if (!$('kpCartao').value) return erro('Cadastre um cartão primeiro.');
      if (!desc) return erro('Escreva uma descrição.');
      if (!(v > 0)) return erro('Informe um valor maior que zero.');
      sv.disabled = true;
      const n = Number($('kpParc').value) || 1;
      const args = { p_id: ctx.c ? ctx.c.id : null, p_cartao: $('kpCartao').value, p_desc: desc,
        p_cat: $('kpCat').value, p_valor: v, p_parcelas: n, p_data: $('kpData').value || todayISO() };
      if (state.cart2 && ctx.pagasManual) args.p_parcela_ini = $('kpIni') && n > 1 ? (Number($('kpIni').value) || 0) + 1 : 1;
      else if (state.cart2) args.p_parcela_ini = null;
      const { data: f, error } = await sb.rpc('salvar_compra', args);
      sv.disabled = false;
      if (error) return erro(rpcMsg(error));
      await loadCartoes(); closeDlg2(); render();
      toast(ctx.c ? 'Compra atualizada.' : `Lançado na fatura de ${mlabel(String(f).slice(0, 10))}.`, true);
      return;
    }
    if (e.target.closest('[data-kc-excluircompra]')){
      const c = ctx.c; if (!c) return;
      if (!await confirmar(`Excluir esta compra?\n\n${c.descricao} · ${brl(Number(c.valor))}${c.parcelas > 1 ? ` em ${c.parcelas}x (todas as parcelas)` : ''}`)) return openCompra(c.id);
      const { error } = await sb.rpc('excluir_compra', { p_id: c.id });
      if (error){ toast(rpcMsg(error)); return; }
      await loadCartoes(); closeDlg2(); render();
      toast('Compra excluída.', true);
    }
    return;
  }
  if (t === 'kcpag'){
    const ok = e.target.closest('[data-kc-confpagar]');
    if (ok){
      const v = parseAmount($('kpgVal').value);
      const erro = m => { $('kpgErro').textContent = m; $('kpgErro').hidden = false; };
      if (!(v > 0)) return erro('Informe um valor maior que zero.');
      ok.disabled = true;
      const { error } = await sb.rpc('pagar_fatura', { p_cartao: ctx.kid, p_mes: ctx.mk, p_valor: v, p_data: $('kpgData').value || todayISO() });
      ok.disabled = false;
      if (error) return erro(rpcMsg(error));
      closeDlg2();
      toast(`Pagamento de ${brl(v)} registrado. Já está em Lançamentos.`, true);
      await loadCartoes(); await refresh();
      return;
    }
    const d = e.target.closest('[data-kc-desfazer]');
    if (d){
      if (!await confirmar('Desfazer este pagamento? A saída em Lançamentos também é apagada.')) return openPagarFatura(ctx.kid, ctx.mk);
      const { error } = await sb.rpc('desfazer_pag_fatura', { pag: d.dataset.kcDesfazer });
      if (error){ toast(rpcMsg(error)); return; }
      await loadCartoes(); await refresh();
      openPagarFatura(ctx.kid, ctx.mk);
      toast('Pagamento desfeito.', true);
    }
  }
});
$('dlg2Body').addEventListener('change', e => {
  if (dlg2.tipo !== 'kccompra') return;
  if (e.target.id === 'kpIni') dlg2.pagasManual = true;
  if (['kpCartao', 'kpParc', 'kpData', 'kpIni'].includes(e.target.id)) kpInfo();
});
$('dlg2Body').addEventListener('input', e => {
  if (dlg2.tipo === 'kccompra' && e.target.id === 'kpValor') kpInfo();
  if (dlg2.tipo === 'kcform' && e.target.id === 'kfNome') dlg2.auto = null;   // a pessoa escreveu o próprio apelido
});

/* ======================= O QUE O CONTROLE COMPARTILHA ======================= */
const MODULOS = [
  { k: 'lanc', nome: 'Gastos (lançamentos)' },
  { k: 'contas', nome: 'Contas a pagar' },
  { k: 'metas', nome: 'Metas' },
  { k: 'invest', nome: 'Investimentos' },
  { k: 'cartoes', nome: 'Cartões de crédito' },
];
const modulosDe = c => !c || c.pessoal || !Array.isArray(c.modulos) ? ['lanc', 'contas', 'metas', 'invest', 'cartoes'] : c.modulos;
const modOn = k => modulosDe(current()).includes(k);
function modulosHtml(c){
  const ms = modulosDe(c), dono = c.sou_dono;
  return `
    <div class="dlg-sec">
      <h3>O que este controle compartilha</h3>
      ${MODULOS.map(m => `<label class="chk" style="padding:4px 0;"><input type="checkbox" data-mod="${m.k}"${ms.includes(m.k) ? ' checked' : ''}${dono ? '' : ' disabled'}> ${m.nome}</label>`).join('')}
      ${dono ? '<div class="row"><button class="btn btn-secondary" type="button" data-a="modulos">Salvar áreas</button></div><p class="hint">Desligar uma área não apaga nada: os dados voltam se você ligar de novo.</p>'
             : '<p class="hint">Só o dono escolhe o que o controle compartilha.</p>'}
    </div>`;
}

/* ======================= MENU ☰ E PERFIL ======================= */
let perfilNovo = true;   // false enquanto o banco não tiver os campos do perfil
const iniciais = s => (String(s || '?').trim().split(/[\s._@-]+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('') || '?').toUpperCase();
const avatarHtml = (nome, foto) => foto ? `<img src="${esc(foto)}" alt="" referrerpolicy="no-referrer">` : esc(iniciais(nome));
const meuNome = () => profile ? (profile.nome || displayName(profile.email)) : '';
const fmtWa = d => !d ? '' : d.length === 11 ? `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}` : d;
function renderMe(){
  if (!profile) return;
  $('userEmail').textContent = meuNome();
  $('meAvatar').innerHTML = avatarHtml(meuNome(), profile.foto);
  $('drAvatar').innerHTML = avatarHtml(meuNome(), profile.foto);
  $('drNome').textContent = meuNome();
  $('drLogin').textContent = profile.nome ? displayName(profile.email) : (perfilNovo ? 'Complete seu perfil' : displayName(profile.email));
}
// computador: abre como balão saindo do botão do perfil; celular: folha que sobe de baixo
function openMenu(origem){
  renderMe();
  const d = $('drawer'), b = origem && origem.getBoundingClientRect ? origem : null;
  const balao = b && b.id === 'menuBtn' && b.offsetParent !== null;
  d.classList.toggle('pop', balao); d.classList.toggle('folha', !balao);
  if (balao){
    const r = b.getBoundingClientRect();
    d.style.setProperty('--pop-x', Math.max(8, r.left) + 'px');
    d.style.setProperty('--pop-y', Math.max(8, innerHeight - r.top + 8) + 'px');
  }
  d.hidden = false;
}
addEventListener('resize', () => { if (!$('drawer').hidden && $('drawer').classList.contains('pop')) closeMenu(); });
function closeMenu(){ $('drawer').hidden = true; }
$('menuBtn').onclick = () => openMenu($('menuBtn'));
$('drClose').onclick = closeMenu;
$('drawer').addEventListener('click', e => { if (e.target.id === 'drawer' || e.target.closest('.drawer-item')) closeMenu(); });
$('drPerfil').addEventListener('click', () => openPerfil());
$('drCategorias').addEventListener('click', () => openCategorias());
// Menu → Meus controles: todos num lugar só, com configurar / sair / excluir
function openMeusControles(){
  const lista = state.controles || [];
  openDlg2('Menu', 'Meus controles', `
    <p class="hint" style="margin:0;">O "Meu controle" é só seu e não pode ser excluído. Os compartilhados você configura, deixa ou exclui (se for o dono).</p>
    <div>${lista.map(c => `
      <div class="mc-item">
        <span style="min-width:0;"><b>${esc(c.nome)}</b><small>${c.pessoal ? 'Pessoal · só você vê' : `Compartilhado · ${plural(c.participantes, 'pessoa')}${c.sou_dono ? ' · você é o dono' : ''}`}</small></span>
        <span class="mc-acoes">${c.pessoal ? '<span class="tag tag-neutral">Pessoal</span>' : `
          <button class="btn btn-secondary btn-sm" type="button" data-mc-config="${esc(c.id)}">Configurar</button>
          ${c.sou_dono ? `<button class="btn btn-danger btn-sm" type="button" data-mc-excluir="${esc(c.id)}">Excluir</button>`
                       : `<button class="btn btn-ghost btn-sm" type="button" data-mc-sair="${esc(c.id)}">Sair</button>`}`}</span>
      </div>`).join('')}</div>
    <button class="btn btn-secondary" type="button" data-mc-novo style="min-height:44px;">+ Novo controle</button>`, { tipo: 'meuscontroles' });
}
$('drControles').addEventListener('click', () => { if (typeof closeDrawer === 'function') closeDrawer(); openMeusControles(); });
async function irParaControle(id){
  if (state.cid !== id){ $('ctrlSelect').value = id; $('ctrlSelect').dispatchEvent(new Event('change')); }
  await loadMembers();
}
$('dlg2Body').addEventListener('click', async e => {
  if (dlg2.tipo !== 'meuscontroles') return;
  if (e.target.closest('[data-mc-novo]')){ closeDlg2(); $('ctrlNew').click(); return; }
  const cf = e.target.closest('[data-mc-config]');
  if (cf){ closeDlg2(); await irParaControle(cf.dataset.mcConfig); return openManage(); }
  const ex = e.target.closest('[data-mc-excluir]'), sa = e.target.closest('[data-mc-sair]');
  const b = ex || sa; if (!b) return;
  const c = (state.controles || []).find(x => x.id === (ex ? ex.dataset.mcExcluir : sa.dataset.mcSair)); if (!c) return;
  const ok = ex ? await confirmar(`Excluir o controle "${c.nome}"?\n\nTodos os lançamentos, contas, cartões e metas dele serão apagados para todo mundo. Não dá para desfazer.`)
                : await confirmar(`Sair de "${c.nome}"?\n\nOs lançamentos que você fez continuam no controle.`);
  if (!ok) return openMeusControles();
  b.disabled = true;
  const res = await sb.rpc(ex ? 'excluir_controle' : 'sair_controle', { cid: c.id });
  if (res.error){ b.disabled = false; return toast(rpcMsg(res.error)); }
  if (state.cid === c.id){ state.cid = null; try { localStorage.removeItem(ctrlKey()); } catch(err){} }
  toast(ex ? 'Controle excluído.' : `Você saiu de "${c.nome}".`);
  await loadControles(); await loadMembers(); await refresh();
  openMeusControles();
});
$('drDados').addEventListener('click', () => openDlg2('Privacidade', 'Seus dados', `
  <div class="dlg-sec">
    <p style="margin:0;font-size:15px;"><b>🔒 O Pra Onde Foi? não se conecta ao seu banco.</b></p>
    <p class="hint" style="margin:0;">Nunca pedimos CPF, número de cartão, CVV, senha do banco, agência ou conta. Tudo o que aparece aqui foi você (ou quem divide um controle com você) que lançou.</p>
  </div>
  <div class="dlg-sec">
    <h3>O que fica guardado</h3>
    <ul class="dados-lista">
      <li>Seu login (usuário ou e-mail) e a senha, criptografada: nem nós conseguimos ler.</li>
      <li>O que você escolher pôr no perfil: nome, foto, e-mail para avisos e WhatsApp. Tudo opcional.</li>
      <li>Os lançamentos, contas, metas, investimentos e cartões que você cadastrar. Dos cartões, só apelido, dias de fechamento e vencimento e limite.</li>
    </ul>
  </div>
  <div class="dlg-sec">
    <h3>O que não fazemos</h3>
    <ul class="dados-lista">
      <li>Não vendemos nem passamos seus dados para ninguém.</li>
      <li>Não mostramos propaganda.</li>
      <li>O administrador do app não vê seus valores, descrições nem categorias.</li>
    </ul>
  </div>
  <div class="dlg-sec">
    <h3>Você manda nos seus dados</h3>
    <div class="row" style="flex-wrap:wrap;">
      <button class="btn btn-secondary btn-sm" type="button" data-act="pfBaixar">Baixar tudo em Excel</button>
      <a class="btn btn-ghost btn-sm" href="privacidade.html" target="_blank" rel="noopener">Política de privacidade</a>
      <button class="btn btn-ghost btn-sm" type="button" data-act="pfExcluir" style="color:var(--alerta);">Excluir minha conta</button>
    </div>
  </div>`, { tipo: 'dados' }));
$('drExcel').addEventListener('click', () => $('export').click());
$('drCodigo').addEventListener('click', () => $('ctrlJoin').click());
// aparência: claro (padrão), escuro ou igual ao celular — guardado neste aparelho
function marcarTema(){ const t = window.temaEscolhido ? window.temaEscolhido() : 'claro'; document.querySelectorAll('#temaSeg [data-tema]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tema === t))); }
document.querySelectorAll('#temaSeg [data-tema]').forEach(b => b.addEventListener('click', () => {
  if (window.definirTema) window.definirTema(b.dataset.tema);
  marcarTema();
  if (currentUser) sb.rpc('definir_tema', { p_tema: b.dataset.tema }).then(() => {}, () => {});   // guarda na conta: vale nos outros aparelhos
}));
// ao entrar: usa o tema guardado na conta. Se a conta ainda não tem, guarda o que este aparelho já usa (se a pessoa escolheu)
async function temaDaConta(){
  try {
    const { data, error } = await sb.rpc('meu_tema');
    if (error) return;   // banco ainda sem o tema salvo: fica só neste aparelho
    if (data === 'claro' || data === 'escuro'){
      if (window.temaEscolhido && window.temaEscolhido() !== data && window.definirTema) window.definirTema(data);
      marcarTema();
    } else {
      let local = null; try { local = localStorage.getItem('pof-tema'); } catch {}
      if (local === 'claro' || local === 'escuro') await sb.rpc('definir_tema', { p_tema: local });
    }
  } catch {}
}
marcarTema();

function lerFoto(file){
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(file.type || '')) return reject(new Error('Escolha uma foto (JPG, PNG ou WEBP).'));
    if (file.size > 15 * 1024 * 1024) return reject(new Error('Foto grande demais. Escolha uma de até 15 MB.'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
      const lado = Math.min(img.naturalWidth, img.naturalHeight);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, S, S);
      ctx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, S, S);
      URL.revokeObjectURL(url);
      let q = 0.85, d = c.toDataURL('image/jpeg', q);
      while (d.length > 140000 && q > 0.4){ q -= 0.15; d = c.toDataURL('image/jpeg', q); }
      resolve(d);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir essa imagem.')); };
    img.src = url;
  });
}

async function openPerfil(){
  if (!profile) return;
  if (!perfilNovo){
    return openDlg2('Minha conta', 'Meu perfil', `<p class="hint">Esta área está temporariamente indisponível. Tente de novo mais tarde.</p>`, { tipo: 'perfil' });
  }
  let ids = currentUser.identities || [];
  try { const r = await sb.auth.getUserIdentities(); if (r && r.data && r.data.identities) ids = r.data.identities; } catch(e){}
  const temGoogle = ids.some(i => i.provider === 'google');
  const temSenha = ids.some(i => i.provider === 'email');
  const p = profile;
  openDlg2('Minha conta', 'Meu perfil', `
    <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;">
      <span class="avatar xl" id="pfAvatar">${avatarHtml(meuNome(), p.foto)}</span>
      <div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start;">
        <label class="btn btn-secondary btn-sm" style="cursor:pointer;">${p.foto ? 'Trocar foto' : 'Colocar foto'}<input type="file" id="pfFile" accept="image/*" hidden></label>
        ${p.foto ? '<button class="btn btn-ghost btn-sm" type="button" data-act="pfRemover">Remover foto</button>' : ''}
      </div>
    </div>
    <form id="perfilForm" novalidate style="display:flex;flex-direction:column;gap:var(--space-4);">
      <div class="field">
        <label for="pfNome">Nome</label>
        <input class="input" id="pfNome" maxlength="40" autocomplete="name" placeholder="Como você quer aparecer" value="${esc(p.nome || '')}">
        <p class="hint" style="margin:6px 0 0;">Aparece para quem divide controles com você.</p>
      </div>
      <div class="field">
        <label>Usuário</label>
        <div class="input ellip" style="display:flex;align-items:center;color:var(--muted);">${esc(displayName(p.email))}</div>
      </div>
      <div class="field">
        <label for="pfEmail">E-mail para avisos</label>
        <input class="input" id="pfEmail" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" placeholder="voce@email.com" value="${esc(p.email_aviso || '')}">
      </div>
      <div class="field">
        <label for="pfWa">WhatsApp <span style="color:var(--muted);font-weight:400;">(opcional)</span></label>
        <input class="input" id="pfWa" type="tel" inputmode="tel" autocomplete="tel" placeholder="(65) 99999-9999" value="${esc(fmtWa(p.whatsapp || ''))}">
      </div>
      <label class="chk"><input type="checkbox" id="pfAvisos"${p.avisos !== false ? ' checked' : ''}> Quero receber avisos de contas por e-mail</label>
      <p class="hint" style="margin:-6px 0 0;">Os avisos por e-mail começam a sair quando o domínio do app estiver pronto.</p>
      <button class="btn btn-primary" type="submit" id="pfSalvar" style="min-height:44px;">Salvar</button>
    </form>
    <div class="dlg-sec" style="border-top:1px solid var(--divider);padding-top:14px;">
      <h3>Formas de entrar</h3>
      <div class="person"><span>Usuário e senha</span>${temSenha ? '<span class="tag tag-neutral">Ativo</span>' : '<span class="by" style="margin:0;">não usa</span>'}</div>
      <div class="person"><span>Conta Google</span>${temGoogle ? '<span class="tag tag-accent">Conectada ✓</span>'
        : googleOn ? '<button class="btn btn-secondary btn-sm" type="button" data-act="pfGoogle">Conectar</button>'
        : '<span class="by" style="margin:0;">em breve</span>'}</div>
    </div>
    <div class="dlg-sec" style="border-top:1px solid var(--divider);padding-top:14px;">
      <h3>Seus dados</h3>
      <p class="hint" style="margin:0 0 10px;">Você pode baixar uma cópia dos lançamentos em planilha ou apagar a sua conta de vez. <a href="privacidade.html" target="_blank" rel="noopener" style="color:inherit;">Política de privacidade</a></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" type="button" data-act="pfBaixar">Baixar meus dados</button>
        <button class="btn btn-danger btn-sm" type="button" data-act="pfExcluir">Excluir minha conta</button>
      </div>
    </div>`, { tipo: 'perfil' });
}

// Meu perfil → Limites: o que tem limite por mês (custa para o app) e o que é à vontade
function openLimites(){
  openDlg2('Sua conta', 'Limites', '<p class="hint" style="margin:0;">Carregando…</p>', { tipo: 'limites' });
  renderLimites();
}
async function renderLimites(){
  const [ia, wa] = await Promise.all([
    sb.rpc('ia_meu_saldo').then(r => r.error ? null : r.data, () => null),
    BOT_LIGADO ? sb.rpc('bot_meu_saldo').then(r => r.error ? null : r.data, () => null) : null,
  ]);
  if (dlg2.tipo !== 'limites') return;
  const el = $('dlg2Body');
  if (!ia && !wa){ el.innerHTML = '<p class="hint" style="margin:0;">Não foi possível ver seus limites agora. Tente de novo em instantes.</p>'; return; }
  const hoje = new Date(), prox = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
  const renova = `1º de ${MONTHS[prox.getMonth()].toLowerCase()}`;
  const barra = (titulo, usadas, limite, extra) => {
    const pct = limite > 0 ? Math.min(100, Math.round(usadas / limite * 100)) : 100;
    return `<div class="bot-saldo"><div><span>${titulo}</span><b>${usadas} de ${limite}</b></div>
      <span class="bar"><i style="width:${pct}%${pct >= 100 ? ';background:#d23b3b' : ''}"></i></span>
      <small>${usadas >= limite ? 'Acabou este mês. ' : ''}${extra}</small></div>`;
  };
  el.innerHTML = `<p class="hint" style="margin:0;">Algumas coisas têm limite por mês porque custam para o app. Renova em <b>${renova}</b>.</p>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${ia ? barra('📷 Leituras de foto, PDF e áudio', ia.usadas, ia.limite, 'Feitas pela IA no app e no Detetive.') : ''}
      ${wa ? barra('💬 Mensagens do Detetive no WhatsApp', wa.usadas, wa.limite, 'Cada resposta do Detetive no WhatsApp conta 1.') : ''}
    </div>
    <p class="hint" style="margin:0;">✅ <b>Sem limite:</b> lançar pelo app, texto, voz, extrato do banco${BOT_LIGADO ? ' e o Detetive no Telegram' : ''}.</p>`;
}

/* ---------- Detetive Grana (bot do WhatsApp e do Telegram) ---------- */
const WA_BOT = '';   // número do bot no WhatsApp (só dígitos, com 55). Vazio: mostra "em breve"
const TG_BOT = 'praondefoi_teste_bot';   // usuário do bot no Telegram (sem @). Vazio: mostra "em breve"
const BOT_LIGADO = true;   // o promover troca para false no prod enquanto o bot não for lançado
let botDisponivel = false, botCodigo = '', botEspera = null;
const DET_LOGO = (document.querySelector('#botFab .det-logo') || {}).outerHTML || '';
const botFabKey = () => `pof-botfab-${currentUser ? currentUser.id : ''}`;
const fmtCel = t => { const d = String(t || '').replace(/\D/g, '').replace(/^55/, ''); return d.length >= 10 ? `(${d.slice(0,2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}` : d; };
const msgWa = cod => `Oi, Detetive Grana! 🕵️ Quero ativar meu bot. Código: ${cod.slice(0,3)} ${cod.slice(3)}`;

// mostra o item do menu e a bolinha do Detetive (só se o banco tem o bot)
let botBalTimer = null;
// leitura por IA e limites só aparecem quando o banco já tem o supabase-ia.sql
let iaDisponivel = false;
async function checarIA(){
  const { data, error } = await sb.rpc('ia_meu_saldo');
  iaDisponivel = !error && !(data && data.liberada === false);   // liberada: o admin ligou para esta conta
  $('rpAbrirIa').hidden = !iaDisponivel;
  document.querySelector('.rp-d-bt').classList.toggle('um', !iaDisponivel);
  $('rpDestTx').textContent = iaDisponivel ? 'Mande a foto da nota ou o extrato do banco. Vários lançamentos de uma vez.' : 'Importe o extrato do banco e lance o mês inteiro de uma vez.';
  if (iaDisponivel) $('drLimites').hidden = false;   // Limites aparece se a conta tem IA ou Detetive
}
async function checarBot(){
  if (!BOT_LIGADO) return;   // prod: o bot ainda não foi lançado
  const { data, error } = await sb.rpc('whatsapp_meu');
  botDisponivel = !error;
  if (botDisponivel){   // o admin libera o Detetive conta por conta (supabase-liberacoes.sql); banco antigo: liberado
    const r = await sb.rpc('meus_recursos');
    if (!r.error && r.data && r.data.bot === false) botDisponivel = false;
  }
  $('botFab').hidden = !botDisponivel;
  if (botDisponivel) $('drLimites').hidden = false;
  let visto = false; try { visto = localStorage.getItem(botFabKey()) === '1'; } catch {}
  const novo = botDisponivel && !visto && !(data || []).length;
  $('botFabNovo').hidden = !novo;
  // na primeira vez, o balãozinho aparece uns segundos para explicar
  clearTimeout(botBalTimer);
  $('botFabBal').hidden = !novo;
  if (novo) botBalTimer = setTimeout(() => { $('botFabBal').hidden = true; }, 7000);
}
function botVisto(){
  clearTimeout(botBalTimer);
  $('botFabNovo').hidden = true; $('botFabBal').hidden = true;
  try { localStorage.setItem(botFabKey(), '1'); } catch {}
}
$('drLimites').addEventListener('click', () => { if (typeof closeDrawer === 'function') closeDrawer(); openLimites(); });
$('botFab').addEventListener('click', () => { botVisto(); openBot(); });

function pararEspera(){ if (botEspera){ clearInterval(botEspera); botEspera = null; } }
async function openBot(){
  pararEspera();
  openDlg2('Novo', 'Detetive Grana', '<p class="hint" style="margin:0;">Carregando…</p>', { tipo: 'bot' });
  await renderBot();
}
const BOT_IC_TG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 4 3 11l6 2.5M21 4l-4 16-8-6.5M21 4 9 13.5V19l3-3.5"/></svg>';
const BOT_IC_WA = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4.1A8 8 0 1 1 20 11.5z"/></svg>';
// explica os limites de cada canal (fica embaixo dos botões do Detetive)
const botComoFunciona = () => `<div class="bot-info"><h4>Como funciona</h4><dl>
  <dt>Telegram</dt><dd>Sem limite. Mande quantas mensagens quiser.</dd>
  <dt>WhatsApp</dt><dd>300 respostas do Detetive por mês. O saldo vale o mês inteiro e zera no dia 1º. Avisamos quando chegar em 80%.</dd>
  <dt>Foto, PDF e áudio</dt><dd>Lidos com IA: 30 leituras por mês, em qualquer canal.</dd>
  <dt>No app</dt><dd>Sem limite.</dd></dl></div>`;
let botQtd = 0;   // quantos canais estavam ligados quando a tela abriu (para saber quando ligou mais um)
async function renderBot(){
  if (dlg2.tipo !== 'bot') return pararEspera();
  const { data, error } = await sb.rpc('whatsapp_meu');
  if (error){ $('dlg2Body').innerHTML = '<p class="hint" style="margin:0;">O Detetive Grana ainda não está disponível.</p>'; return; }
  const lig = data || [], atual = current();
  const tgV = lig.find(x => x.canal === 'telegram'), waV = lig.find(x => x.canal === 'whatsapp');
  botQtd = lig.length;
  // código para conectar o canal que falta
  let cod = '';
  if (!tgV || !waV){
    if (!botCodigo){
      const g = await sb.rpc('whatsapp_gerar_codigo', { cid: (lig[0] && lig[0].controle_id) || state.cid });
      if (!g.error) botCodigo = String(g.data);
    }
    cod = botCodigo;
  } else { pararEspera(); botCodigo = ''; }
  if (dlg2.tipo !== 'bot') return;
  const linkTg = TG_BOT ? `https://t.me/${TG_BOT}${cod ? `?start=${cod}` : ''}` : '';
  const linkWa = WA_BOT ? `https://wa.me/${WA_BOT}${cod ? `?text=${encodeURIComponent(msgWa(cod))}` : ''}` : '';
  const canal = (id, nome, v, link, ic, cor, nota) => {
    const topo = `<span class="ic">${ic}</span><span class="tx"><b>${nome}</b><small>${v ? `<span class="ok">✓ Conectado</span> · ` : ''}${v && id === 'whatsapp' && v.final ? `final ${esc(v.final)} · ` : ''}${nota}</small></span>`;
    if (v) return `<div class="bot-canal" style="--c:${cor}">${topo}<button class="btn btn-ghost btn-sm" type="button" data-act="botDesligar" data-canal="${id}" aria-label="Desligar o ${nome}">Desligar</button></div>`;
    if (!link) return `<div class="bot-canal off" style="--c:${cor}">${topo}<span class="tag tag-neutral">Em breve</span></div>`;
    if (!cod) return `<div class="bot-canal" style="--c:${cor}">${topo}</div>`;
    return `<a class="bot-canal" style="--c:${cor}" href="${link}" target="_blank" rel="noopener" data-canal="${id}">${topo}<span class="st ir">Conectar</span></a>`;
  };
  const lista = `<div class="bot-canais">
      ${canal('telegram', 'Telegram', tgV, linkTg, BOT_IC_TG, '#2a9fd8', 'Sem limite de mensagens')}
      ${canal('whatsapp', 'WhatsApp', waV, linkWa, BOT_IC_WA, '#1fa855', 'Até 300 mensagens por mês')}
    </div>`;
  const podeLigar = !!cod && ((!tgV && linkTg) || (!waV && linkWa));
  const espera = podeLigar ? `<p class="hint" id="botEspera" style="margin:0;font-size:12.5px;">${lig.length ? 'Para ligar o outro canal, toque em <b>Conectar</b>.' : 'É só tocar, e na conversa tocar em <b>Iniciar</b> ou <b>Enviar</b>.'} Esta tela avisa sozinha quando conectar.</p>` : '';
  if (lig.length){
    const v = lig[0], outro = atual && atual.id !== v.controle_id;
    const nomes = [tgV ? 'ao seu <b>Telegram</b>' : '', waV ? `ao WhatsApp com final <b>${esc(waV.final || '')}</b>` : ''].filter(Boolean).join(' e ');
    const abrirTg = tgV && TG_BOT ? `https://t.me/${TG_BOT}` : '', abrirWa = waV && WA_BOT ? `https://wa.me/${WA_BOT}` : '';
    const dois = abrirTg && abrirWa;
    let saldo = '';
    if (waV){   // WhatsApp tem saldo de mensagens por mês (cada resposta custa)
      const r = await sb.rpc('bot_meu_saldo');
      if (!r.error && r.data){
        const { usadas, limite } = r.data, pct = Math.min(100, Math.round(usadas / limite * 100));
        saldo = `<div class="bot-saldo"><div><span>Mensagens no WhatsApp este mês</span><b>${usadas} de ${limite}</b></div>
          <span class="bar"><i style="width:${pct}%"></i></span>
          <small>${usadas >= limite ? 'Acabou este mês. Continue pelo app ou pelo Telegram, que não têm limite. Volta no dia 1º.' : 'Zera no dia 1º. O app e o Telegram não têm limite.'}</small></div>`;
      }
    }
    if (dlg2.tipo !== 'bot') return;
    $('dlg2Body').innerHTML = `
      <p style="margin:0;font-size:15px;">✅ Conectado ${nomes}.</p>
      <p class="hint" style="margin:0;">O Detetive anota tudo em <b>${esc(v.controle_nome || 'Meu controle')}</b>. Mande <b>Ajuda</b> para ele quando quiser ver o que ele sabe fazer.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${abrirTg ? `<a class="btn btn-primary btn-sm" href="${abrirTg}" target="_blank" rel="noopener">${dois ? 'Abrir Telegram' : 'Abrir conversa'}</a>` : ''}
        ${abrirWa ? `<a class="btn ${abrirTg ? 'btn-secondary' : 'btn-primary'} btn-sm" href="${abrirWa}" target="_blank" rel="noopener">${dois ? 'Abrir WhatsApp' : 'Abrir conversa'}</a>` : ''}
        ${outro ? `<button class="btn btn-secondary btn-sm" type="button" data-act="botCtl">Anotar em "${esc(atual.nome)}"</button>` : ''}
      </div>
      ${lista}${espera}${saldo}${botComoFunciona()}`;
  } else {
    if (!cod){ $('dlg2Body').innerHTML = '<p class="hint" style="margin:0;">Não foi possível gerar o código agora. Tente de novo em instantes.</p>'; return; }
    $('dlg2Body').innerHTML = `
      <div class="bot-topo">${DET_LOGO}
        <div><b>Comece a lançar por mensagem</b><span>Mande <b>Mercado 50</b> ou <b>Uber 23,90 ontem</b> e o Detetive anota em <b>${esc(atual ? atual.nome : 'Meu controle')}</b>.</span></div></div>
      <p class="bot-pergunta">Onde você quer conversar com ele?</p>
      ${lista}${espera}${botComoFunciona()}`;
  }
  $('dlg2Body').querySelectorAll('a.bot-canal').forEach(a => a.addEventListener('click', () => {
    if ($('botEspera')) $('botEspera').innerHTML = `<span class="bot-girando" aria-hidden="true"></span> Esperando sua mensagem no <b>${a.dataset.canal === 'telegram' ? 'Telegram' : 'WhatsApp'}</b>… Se não abriu, toque de novo.`;
  }));
  // fica conferindo se a pessoa já mandou a mensagem (até 5 minutos)
  if (podeLigar && !botEspera){
    let n = 0;
    botEspera = setInterval(async () => {
      if (dlg2.tipo !== 'bot' || $('dlg2').hidden || ++n > 100) return pararEspera();
      const { data } = await sb.rpc('whatsapp_meu');
      if ((data || []).length > botQtd){ pararEspera(); botCodigo = ''; toast('🕵️ Detetive Grana conectado!', true); renderBot(); }
    }, 3000);
  }
}



$('dlg2Body').addEventListener('change', async e => {
  if (e.target.id !== 'pfFile' || !e.target.files || !e.target.files[0]) return;
  try {
    const foto = await lerFoto(e.target.files[0]);
    const { error } = await sb.rpc('salvar_foto', { p_foto: foto });
    if (error) return toast(rpcMsg(error));
    profile.foto = foto; renderMe();
    if ($('pfAvatar')) $('pfAvatar').innerHTML = avatarHtml(meuNome(), foto);
    toast('Foto atualizada.', true);
    await loadMembers(); render();
    openPerfil();
  } catch(err){ toast(err.message || 'Não foi possível usar essa imagem.'); }
});

$('dlg2Body').addEventListener('click', async e => {
  const b = e.target.closest('[data-act^="pf"], [data-act^="bot"]');
  if (!b) return;
  if (b.dataset.act === 'pfRemover'){
    const { error } = await sb.rpc('salvar_foto', { p_foto: null });
    if (error) return toast(rpcMsg(error));
    profile.foto = null; renderMe(); await loadMembers(); render(); openPerfil();
  }
  if (b.dataset.act === 'pfBaixar'){ $('export').click(); return; }
  if (b.dataset.act === 'botCtl'){
    b.disabled = true;
    const { error } = await sb.rpc('whatsapp_definir_controle', { cid: state.cid });
    if (error){ b.disabled = false; return toast(rpcMsg(error)); }
    toast('Pronto, o Detetive vai anotar neste controle.', true);
    return renderBot();
  }
  if (b.dataset.act === 'botDesligar'){
    b.disabled = true;
    const canal = b.dataset.canal || '', nome = canal === 'whatsapp' ? 'WhatsApp' : 'Telegram';
    let { error } = canal ? await sb.rpc('whatsapp_desligar', { p_canal: canal }) : await sb.rpc('whatsapp_desligar');
    if (error && canal && /function|schema cache/i.test(error.message || '')) ({ error } = await sb.rpc('whatsapp_desligar'));
    if (error){ b.disabled = false; return toast(rpcMsg(error)); }
    toast(canal ? `Detetive desligado do ${nome}.` : 'Detetive Grana desligado da sua conta.', true);
    botCodigo = '';
    return renderBot();
  }
  if (b.dataset.act === 'pfExcluir'){
    const t = await pedirTexto('Excluir minha conta',
      'Isso apaga de vez o seu perfil, a sua foto e o "Meu controle" com tudo dentro. Nos controles que você divide, eles passam para outra pessoa e os seus lançamentos ficam lá sem o seu nome. Não dá para desfazer.\n\nSe quiser, baixe seus dados antes.',
      { rotulo: 'Para confirmar, digite EXCLUIR', placeholder: 'EXCLUIR', okTxt: 'Excluir conta', perigo: true });
    if (t === null) return;
    if (t.trim().toUpperCase() !== 'EXCLUIR') return toast('Digite EXCLUIR para confirmar.');
    b.disabled = true;
    const { error } = await sb.rpc('excluir_minha_conta', { p_confirma: t });
    if (error){ b.disabled = false; return toast(rpcMsg(error)); }
    closeDlg2();
    toast('Sua conta foi excluída. Até mais!', true);
    await sb.auth.signOut({ scope: 'local' });
    return;
  }
  if (b.dataset.act === 'pfGoogle'){
    b.disabled = true;
    const { error } = await sb.auth.linkIdentity({ provider: 'google', options: { redirectTo: REDIRECT } });
    if (error){ b.disabled = false; toast(translateError(error)); }
  }
});

$('dlg2Body').addEventListener('submit', async e => {
  if (e.target.id !== 'perfilForm') return;
  e.preventDefault();
  const nome = $('pfNome').value.trim(), email = $('pfEmail').value.trim().toLowerCase();
  const wa = $('pfWa').value.replace(/\D/g, ''), avisos = $('pfAvisos').checked;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Esse e-mail não parece válido.');
  if (wa && (wa.length < 10 || wa.length > 13)) return toast('WhatsApp inválido. Use DDD + número, ex.: (65) 99999-9999.');
  $('pfSalvar').disabled = true;
  const { error } = await sb.rpc('salvar_perfil', { p_nome: nome, p_email: email, p_whatsapp: wa, p_avisos: avisos });
  if (error){ $('pfSalvar').disabled = false; return toast(rpcMsg(error)); }
  Object.assign(profile, { nome: nome || null, email_aviso: email || null, whatsapp: wa || null, avisos });
  renderMe(); closeDlg2(); toast('Perfil salvo.', true);
  await loadMembers(); render();
});

/* ======================= PESSOAS E CONVITES ======================= */
const fmtDateTime = iso => new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
function closeDlg(){ $('dlg').hidden = true; }
$('dlgClose').onclick = closeDlg;
// (toque fora da janela não fecha: só o X, Cancelar ou salvar)
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('drawer').hidden) closeMenu(); else if (!$('dlg2').hidden) closeDlg2(); else if (!$('dlg').hidden) closeDlg();
});

async function openManage(){
  const c = current();
  if (!c || c.pessoal) return;
  $('dlgTitle').textContent = c.nome;
  $('dlgBody').innerHTML = '<span class="kicker">Carregando…</span>';
  $('dlg').hidden = false;
  await loadMembers();
  let pend = [];
  if (c.sou_dono){
    const { data } = await sb.rpc('convites_enviados', { cid: c.id });
    pend = data || [];
  }
  if ($('dlg').hidden || state.cid !== c.id) return;
  const dono = c.sou_dono;
  const people = state.members.map(p => {
    const me = currentUser && p.user_id === currentUser.id;
    const nm = p.nome || displayName(p.login) || 'conta excluída';
    return `<div class="person">
      <span style="display:flex;align-items:center;gap:10px;min-width:0;"><span class="avatar sm">${avatarHtml(nm, p.foto)}</span><span style="min-width:0;">${esc(nm)}${me ? ' <span class="by">(você)</span>' : ''}${p.nome && p.login ? `<span class="by" style="display:block;margin:0;">${esc(displayName(p.login))}</span>` : ''}</span></span>
      <span style="display:flex;gap:6px;align-items:center;">
        ${p.eh_dono ? '<span class="tag tag-accent">Dono</span>' : ''}
        ${dono && !me ? `<button class="btn btn-danger btn-sm" data-a="remover" data-id="${esc(p.user_id)}" data-name="${esc(nm)}">Remover</button>` : ''}
      </span>
    </div>`;
  }).join('');
  const codeActive = c.codigo && c.codigo_expira && new Date(c.codigo_expira) > new Date();
  $('dlgBody').innerHTML = `
    ${dono ? `
    <div class="dlg-sec">
      <h3>Nome</h3>
      <div class="row"><input class="input" id="dlgName" maxlength="40" value="${esc(c.nome)}"><button class="btn btn-secondary" data-a="renomear">Salvar</button></div>
    </div>` : ''}
    <div class="dlg-sec">
      <h3>Participantes · ${state.members.length}</h3>
      ${people}
      ${pend.map(v => `<div class="person"><span>${esc(displayName(v.login))} <span class="by">(convite enviado)</span></span>
        <button class="btn btn-secondary btn-sm" data-a="cancelarConvite" data-id="${esc(v.id)}">Cancelar</button></div>`).join('')}
    </div>
    ${dono ? `
    <div class="dlg-sec">
      <h3>Convidar pelo usuário</h3>
      <p class="hint">A pessoa precisa ter conta aprovada no app. O convite aparece para ela na próxima vez que entrar.</p>
      <div class="row"><input class="input" id="dlgInvite" placeholder="Nome ou e-mail" autocapitalize="none" autocorrect="off" spellcheck="false"><button class="btn btn-primary" data-a="convidar">Convidar</button></div>
    </div>
    <div class="dlg-sec">
      <h3>Código de convite</h3>
      ${codeActive ? `
        <div class="code">${esc(c.codigo)}</div>
        <p class="hint">Vale até ${fmtDateTime(c.codigo_expira)}. Quem digitar em "Entrar com código" entra neste controle.</p>
        <div class="row" style="flex-wrap:wrap;">
          <button class="btn btn-primary" data-a="compartilhar">Enviar código</button>
          <button class="btn btn-secondary" data-a="gerar">Gerar outro</button>
          <button class="btn btn-secondary" data-a="cancelarCodigo">Cancelar código</button>
        </div>` : `
        <p class="hint">Gere um código para mandar pelo WhatsApp. Ele vale por 48 horas.</p>
        <div class="row"><button class="btn btn-primary" data-a="gerar">Gerar código</button></div>`}
    </div>` : `
    <p class="hint">Só o dono (${esc(displayName((state.members.find(p => p.eh_dono) || {}).login) || '—')}) pode convidar pessoas e mudar o nome.</p>`}
    ${modulosHtml(c)}
    <div class="dlg-sec ct-perigo">
      <h3>Sair ou excluir</h3>
      <p class="hint" style="margin:0;">Ao <b>sair</b>, os lançamentos que você fez continuam no controle para os outros.${dono ? ' Ao <b>excluir</b>, o controle e tudo dele (lançamentos, contas, cartões, metas) somem para todo mundo.' : ''}</p>
      <div class="row" style="flex-wrap:wrap;">
        <button class="btn btn-secondary" data-a="sair">Sair do controle</button>
        ${dono ? '<button class="btn btn-danger" data-a="excluir">Excluir controle</button>' : ''}
      </div>
    </div>`;
}

async function afterChange(reopen){
  await loadControles(); await loadMembers(); await refresh();
  if (reopen) openManage(); else closeDlg();
}

$('dlgBody').addEventListener('click', async e => {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const c = current(); if (!c) return;
  const a = b.dataset.a;
  let res;
  if (a === 'modulos'){
    const ms = [...document.querySelectorAll('#dlgBody [data-mod]')].filter(x => x.checked).map(x => x.dataset.mod);
    if (!ms.length) return toast('Deixe pelo menos uma área ligada.');
    b.disabled = true; res = await sb.rpc('definir_modulos', { cid: c.id, p_modulos: ms });
    if (res.error){ b.disabled = false; return toast(/function|schema cache/i.test(res.error.message || '') ? 'Esta área está temporariamente indisponível. Tente de novo mais tarde.' : rpcMsg(res.error)); }
    toast('Áreas atualizadas.', true); return afterChange(true);
  }
  if (a === 'renomear'){
    const n = $('dlgName').value.trim(); if (!n) return;
    b.disabled = true; res = await sb.rpc('renomear_controle', { cid: c.id, p_nome: n });
    if (res.error){ b.disabled = false; return toast(rpcMsg(res.error)); }
    toast('Nome salvo.'); return afterChange(true);
  }
  if (a === 'convidar'){
    const typed = $('dlgInvite').value.trim();
    const login = toLoginEmail(typed);
    if (!login) return toast('Digite o usuário ou o e-mail da pessoa.');
    b.disabled = true; res = await sb.rpc('convidar', { cid: c.id, p_login: login });
    if (res.error){ b.disabled = false; return toast(rpcMsg(res.error)); }
    toast(`Convite enviado para ${typed}.`); return afterChange(true);
  }
  if (a === 'cancelarConvite'){
    b.disabled = true; res = await sb.rpc('cancelar_convite', { conv: b.dataset.id });
    if (res.error){ b.disabled = false; return toast(rpcMsg(res.error)); }
    return afterChange(true);
  }
  if (a === 'gerar'){
    if (c.codigo && !await confirmar('Gerar outro código?\n\nO código atual deixa de funcionar.', 'Gerar código')) return;
    b.disabled = true; res = await sb.rpc('gerar_codigo', { cid: c.id });
    if (res.error){ b.disabled = false; return toast(rpcMsg(res.error)); }
    return afterChange(true);
  }
  if (a === 'cancelarCodigo'){
    b.disabled = true; res = await sb.rpc('cancelar_codigo', { cid: c.id });
    if (res.error){ b.disabled = false; return toast(rpcMsg(res.error)); }
    return afterChange(true);
  }
  if (a === 'compartilhar'){
    const texto = `Bora controlar os gastos juntos no Pra Onde Foi? 💸\n\n1. Abra ${REDIRECT}\n2. Entre com a sua conta\n3. Toque em "Entrar com código" e digite: ${c.codigo}\n\n(O código vale até ${fmtDateTime(c.codigo_expira)}.)`;
    if (navigator.share){ try { await navigator.share({ text: texto }); return; } catch(err){ if (err && err.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(texto); toast('Mensagem copiada! É só colar no WhatsApp.'); }
    catch(err){ await pedirTexto('Copie a mensagem', 'Não deu para copiar sozinho. Segure no campo, selecione tudo e copie.', { valor: texto, okTxt: 'Fechar' }); }
    return;
  }
  if (a === 'remover'){
    if (!await confirmar(`Remover ${b.dataset.name} deste controle?\n\nOs lançamentos que essa pessoa fez continuam aqui.`)) return;
    b.disabled = true; res = await sb.rpc('remover_participante', { cid: c.id, alvo: b.dataset.id });
    if (res.error){ b.disabled = false; return toast(rpcMsg(res.error)); }
    return afterChange(true);
  }
  if (a === 'sair'){
    const others = state.members.length - 1;
    const aviso = c.sou_dono
      ? (others > 0 ? 'Você é o dono. Ao sair, o controle passa para quem participa há mais tempo.' : 'Você é a única pessoa aqui. Ao sair, o controle e todos os lançamentos dele serão apagados.')
      : 'Os lançamentos que você fez continuam no controle.';
    if (!await confirmar(`Sair de "${c.nome}"?\n\n${aviso}`)) return;
    b.disabled = true; res = await sb.rpc('sair_controle', { cid: c.id });
    if (res.error){ b.disabled = false; return toast(rpcMsg(res.error)); }
    state.cid = null; try { localStorage.removeItem(ctrlKey()); } catch(err){}
    toast(`Você saiu de "${c.nome}".`); return afterChange(false);
  }
  if (a === 'excluir'){
    if (!await confirmar(`Excluir o controle "${c.nome}"?\n\nTodos os lançamentos dele serão apagados para todo mundo. Não dá para desfazer.`)) return;
    b.disabled = true; res = await sb.rpc('excluir_controle', { cid: c.id });
    if (res.error){ b.disabled = false; return toast(rpcMsg(res.error)); }
    state.cid = null; try { localStorage.removeItem(ctrlKey()); } catch(err){}
    toast('Controle excluído.'); return afterChange(false);
  }
});

/* ======================= PLANILHA EXCEL ======================= */
/* ======================= COMPARATIVO DE MESES ======================= */
// Botão abaixo dos resumos: escolhe dois meses e compara gastos e saldo, com uma frase que resume.
// Mês em andamento: compara até o mesmo dia nos dois meses. Tem o próprio olho, só para esta janela.
const mes7 = (y, m) => mkey(y, m).slice(0, 7);   // "2026-11"
const variacao = (a, b) => b ? Math.round((a - b) / b * 100) : null;
const nomeMes = k => MONTHS[Number(k.slice(5, 7)) - 1];
const rotMes = k => { const c = MES_CURTO[Number(k.slice(5, 7)) - 1]; return `${c[0]}${c.slice(1).toLowerCase()} ${k.slice(0, 4)}`; };   // "Out 2026"
const cmp = { a: '', b: '', oculto: false, cache: {} };
async function somaMes(k){
  if (cmp.cache[k]) return cmp.cache[k];
  const rows = [];
  for (let from = 0; ; from += 1000){
    const { data, error } = await sb.from('lancamentos').select('tipo,categoria,valor,data')
      .eq('controle_id', state.cid).gte('data', `${k}-01`).lt('data', mkey(Number(k.slice(0, 4)), Number(k.slice(5, 7)))).range(from, from + 999);
    if (error) return null;
    rows.push(...data); if (data.length < 1000) break;
  }
  return (cmp.cache[k] = rows);
}
function totais(rows, ate){
  const t = { inc: 0, exp: 0, cats: {} };
  rows.forEach(r => {
    if (Number(r.data.slice(8, 10)) > ate) return;
    const v = Number(r.valor); t[r.tipo] += v;
    if (r.tipo === 'exp') t.cats[r.categoria] = (t.cats[r.categoria] || 0) + v;
  });
  t.saldo = t.inc - t.exp;
  return t;
}
async function openComparativo(){
  if (!state.cid) return;
  cmp.a = mes7(state.y, state.m); cmp.b = mes7(state.y, state.m - 1); cmp.cache = {}; cmp.oculto = valoresOcultos;
  openDlg2('Comparativo', 'Comparar meses', '<p class="hint">Carregando…</p>', { tipo: 'comparativo' });
  await desenharComparativo();
}
async function desenharComparativo(){
  const [ra, rb] = await Promise.all([somaMes(cmp.a), somaMes(cmp.b)]);
  if (dlg2.tipo !== 'comparativo') return;
  if (!ra || !rb){ $('dlg2Body').innerHTML = '<p class="hint">Não foi possível carregar agora. Tente de novo.</p>'; return; }
  const hoje = new Date(), kHoje = mes7(hoje.getFullYear(), hoje.getMonth());
  const parcial = cmp.a === kHoje || cmp.b === kHoje;
  const ate = parcial ? hoje.getDate() : 31;
  const A = totais(ra, ate), B = totais(rb, ate), nA = nomeMes(cmp.a), nB = nomeMes(cmp.b);
  const R = v => cmp.oculto ? 'R$ ••••' : brl(r2(v));
  // frase do resumo
  const pg = variacao(A.exp, B.exp), dg = r2(A.exp - B.exp);
  let fGasto;
  if (!A.exp && !B.exp) fGasto = `Nenhum gasto em ${nA} nem em ${nB}.`;
  else if (Math.abs(dg) < 0.005) fGasto = `Você gastou o mesmo que em ${nB}.`;
  else if (pg === null) fGasto = `Você gastou ${R(A.exp)} em ${nA}; em ${nB} não teve gasto.`;
  else fGasto = dg > 0 ? `Você gastou <b class="ruim">${Math.abs(pg)}% a mais</b> que em ${nB}.` : `Você gastou <b class="bom">${Math.abs(pg)}% a menos</b> que em ${nB}.`;
  const taxa = t => t.inc > 0 ? Math.round(t.saldo / t.inc * 100) : null;
  const tA = taxa(A), tB = taxa(B);
  let fSaldo = '';
  if (A.saldo < -0.004) fSaldo = `Faltou <b class="ruim">${R(-A.saldo)}</b>: saiu mais do que entrou.`;
  else if (tA !== null && tB !== null) fSaldo = `Sobrou <b class="${tA >= tB ? 'bom' : 'ruim'}">${tA}% do que entrou</b>, contra ${tB}% em ${nB}.`;
  else if (tA !== null) fSaldo = `Sobrou <b class="bom">${tA}% do que entrou</b>.`;
  const card = (nome, a, b, maisEhBom) => {
    const d = r2(a - b), p = nome === 'Gastos' ? variacao(a, b) : null;
    const dif = Math.abs(d) < 0.005 ? '<span class="cmp-dif igual">igual</span>'
      : `<span class="cmp-dif ${(d > 0) === maisEhBom ? 'bom' : 'ruim'}">${d > 0 ? '↑' : '↓'} ${cmp.oculto ? (p !== null ? Math.abs(p) + '%' : '') : brl(Math.abs(d))}</span>`;
    return `<div class="cmp-card"><span class="lb">${nome}</span><span class="vl">${R(a)}</span>${dif}<span class="ant">${nB}: <span style="white-space:nowrap">${R(b)}</span></span></div>`;
  };
  const cats = [...new Set([...Object.keys(A.cats), ...Object.keys(B.cats)])]
    .map(c => ({ c, a: A.cats[c] || 0, b: B.cats[c] || 0 })).filter(x => Math.abs(x.a - x.b) >= 0.005)
    .sort((x, z) => Math.abs(z.a - z.b) - Math.abs(x.a - x.b)).slice(0, 3);
  const opcoes = sel => { const l = []; for (let k = 0; k < 18; k++){ const kk = mes7(hoje.getFullYear(), hoje.getMonth() - k); l.push(`<option value="${kk}"${kk === sel ? ' selected' : ''}>${rotMes(kk)}</option>`); }
    if (!l.some(o => o.includes(`"${sel}"`))) l.push(`<option value="${sel}" selected>${rotMes(sel)}</option>`); return l.join(''); };
  $('dlg2Body').innerHTML = `<div class="cmp-box">
    <div class="cmp-sel">
      <select class="input" id="cmpA" aria-label="Mês">${opcoes(cmp.a)}</select>
      <span>×</span>
      <select class="input" id="cmpB" aria-label="Comparar com">${opcoes(cmp.b)}</select>
      <button class="cmp-olho" type="button" data-cmp="olho" aria-pressed="${cmp.oculto}" title="${cmp.oculto ? 'Mostrar valores' : 'Esconder valores'}" aria-label="${cmp.oculto ? 'Mostrar valores' : 'Esconder valores'}">${cmp.oculto
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.6"/><path d="M6.6 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m3 3 18 18"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'}</button>
    </div>
    ${cmp.a === cmp.b ? '<p class="hint" style="margin:0;">Escolha dois meses diferentes.</p>' : `
    <p class="cmp-frase">${fGasto}${fSaldo ? ' ' + fSaldo : ''}</p>
    ${parcial ? `<p class="hint" style="margin:0;">O mês ainda não acabou: comparando do dia 1 ao dia ${ate} nos dois meses.</p>` : ''}
    <div class="cmp-cards">${card('Gastos', A.exp, B.exp, false)}${card('Saldo', A.saldo, B.saldo, true)}</div>
    ${cats.length ? `<div class="dlg-sec"><h3>Onde os gastos mudaram</h3>${cats.map(x => `<div class="cmp-cat"><span class="nm">${esc(rotuloCat(x.c))}</span><span class="cmp-dif ${x.a > x.b ? 'ruim' : 'bom'}">${x.a > x.b ? '↑' : '↓'} ${cmp.oculto ? '' : brl(r2(Math.abs(x.a - x.b)))}</span><span class="de">${R(x.b)} → ${R(x.a)}</span></div>`).join('')}</div>` : ''}`}
  </div>`;
}
$('btnComparar').onclick = openComparativo;
$('dlg2Body').addEventListener('change', e => {
  if (e.target.id !== 'cmpA' && e.target.id !== 'cmpB') return;
  cmp[e.target.id === 'cmpA' ? 'a' : 'b'] = e.target.value; desenharComparativo();
});
$('dlg2Body').addEventListener('click', e => {
  if (!e.target.closest('[data-cmp="olho"]')) return;
  cmp.oculto = !cmp.oculto; desenharComparativo();     // só esta janela; não muda o olho do app
});

/* ======================= ESCONDER VALORES ======================= */
// Botão "Esconder valores": troca os valores dos resumos e das listas por "R$ ••••". Fica guardado neste aparelho.
const MASCARA = 'R$ ••••', RX_DINHEIRO = /-?R\$\s?-?[\d.]+,\d{2}/g, RX_PCT = /[+−-]?\d+(?:,\d+)?\s?%/g;
const valoresOriginais = new Map();
let valoresOcultos = false;
try { valoresOcultos = localStorage.getItem('pof-ocultar') === '1'; } catch(e){}
// resumos e listas (lançamentos, categorias, contas, metas, investimentos); os campos de digitar ficam de fora
const areasValores = () => document.querySelectorAll('#viewApp .stats, #viewApp #budget, #rows, #cats, #billList, #metasGrid, #invList, #invDist, #kcFaturas, #kcCompras, #kcCats, #kcTodas, #kcTodasResumo');
function mascararValores(){
  areasValores().forEach(raiz => {
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())){
      // valores e porcentagens ("Sobrou 67% do que entrou" também entrega quanto a pessoa ganha)
      const t = n.nodeValue, novo = t.replace(RX_DINHEIRO, MASCARA).replace(RX_PCT, '••%');
      if (novo !== t){ valoresOriginais.set(n, [t, novo]); n.nodeValue = novo; }
    }
  });
}
function mostrarValores(){
  for (const [n, [t, novo]] of valoresOriginais) if (n.isConnected && n.nodeValue === novo) n.nodeValue = t;
  valoresOriginais.clear();
}
const vigiaValores = new MutationObserver(() => {
  if (!valoresOcultos) return;
  vigiaValores.disconnect(); mascararValores(); vigiar();
});
function vigiar(){ areasValores().forEach(el => vigiaValores.observe(el, { childList: true, subtree: true, characterData: true })); }
// um botão "Esconder valores" logo acima dos cartões de resumo de cada aba
document.querySelectorAll('#viewApp .stats').forEach(sec => {
  sec.before($('tplOlho').content.firstElementChild.cloneNode(true));
});
function aplicarOlho(){
  document.querySelectorAll('.olho-btn').forEach(b => {
    b.setAttribute('aria-pressed', String(valoresOcultos));
    b.querySelector('.olho-txt').textContent = valoresOcultos ? 'Mostrar valores' : 'Esconder valores';
  });
  document.documentElement.classList.toggle('valores-ocultos', valoresOcultos);
  vigiaValores.disconnect();
  if (valoresOcultos) mascararValores(); else mostrarValores();
  vigiar();
}
document.querySelectorAll('.olho-btn').forEach(b => b.addEventListener('click', () => {
  valoresOcultos = !valoresOcultos;
  try { localStorage.setItem('pof-ocultar', valoresOcultos ? '1' : '0'); } catch(e){}
  aplicarOlho();
}));
aplicarOlho();

$('export').onclick = async () => {
  if (!window.XLSX){ toast('Não foi possível gerar a planilha. Verifique a conexão e tente de novo.'); return; }
  const c = current(); if (!c) return;
  $('export').disabled = true;
  const entries = await fetchAllEntries();
  $('export').disabled = false;
  if (!entries) return toast('Não foi possível buscar os lançamentos.');
  const shared = !c.pessoal;
  const money = '"R$" #,##0.00;-"R$" #,##0.00';
  const wb = XLSX.utils.book_new();
  const dBR = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
  const mBR = mk => { if (!mk) return ''; const [y, m] = String(mk).split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
  // cada aba sempre existe: sem dados, fica só o cabeçalho
  const aba = (nome, cab, linhas, larg, colsDinheiro = [], colsPct = []) => {
    const ws = XLSX.utils.aoa_to_sheet([cab, ...linhas]);
    ws['!cols'] = larg.map(w => ({ wch: w }));
    for (let r = 1; r <= linhas.length; r++){
      colsDinheiro.forEach(col => { const cel = ws[XLSX.utils.encode_cell({ r, c: col })]; if (cel && cel.t === 'n') cel.z = money; });
      colsPct.forEach(col => { const cel = ws[XLSX.utils.encode_cell({ r, c: col })]; if (cel && cel.t === 'n') cel.z = '0%'; });
    }
    XLSX.utils.book_append_sheet(wb, ws, nome);
  };

  // 1) Lançamentos
  const cabL = ['Data', 'Tipo', 'Descrição', 'Categoria', 'Valor'].concat(shared ? ['Quem lançou'] : []);
  aba('Lançamentos', cabL, entries.map(e => [dBR(e.date), e.type === 'inc' ? 'Entrada' : 'Saída', e.desc, e.cat,
    e.type === 'inc' ? e.amount : -e.amount].concat(shared ? [nameOf(e.uid)] : [])), [12, 10, 34, 18, 14, 18], [4]);

  // 2) Resumo por mês
  const byMonth = {};
  entries.forEach(e => { const k = e.date.slice(0, 7); byMonth[k] = byMonth[k] || { inc: 0, exp: 0 }; byMonth[k][e.type] += e.amount; });
  aba('Resumo por mês', ['Mês', 'Entradas', 'Saídas', 'Saldo'],
    Object.keys(byMonth).sort().map(k => { const v = byMonth[k]; return [mBR(k), r2(v.inc), r2(v.exp), r2(v.inc - v.exp)]; }),
    [18, 14, 14, 14], [1, 2, 3]);

  // 3) Contas a pagar (situação do mês que está na tela)
  const mkTela = mkey(state.y, state.m), TIPO_CONTA = { fixa: 'Fixa (todo mês)', parcelada: 'Parcelada', unica: 'Uma vez só' };
  const linhasC = (state.contas || []).map(ct => {
    let sit = 'Não vence neste mês', valorMes = '', pago = '';
    if (ocorre(ct, mkTela)){
      const i = instancia(ct, mkTela);
      valorMes = r2(i.total); pago = r2(i.pago);
      sit = i.paid ? 'Paga' : i.pago > 0 ? 'Paga em parte' : i.days < 0 ? 'Vencida' : 'A pagar';
    }
    return [ct.nome, ct.categoria, TIPO_CONTA[ct.tipo] || ct.tipo, Number(ct.valor), ct.dia, mBR(String(ct.inicio).slice(0, 7)),
      ct.tipo === 'parcelada' ? ct.parcelas : '', valorMes, pago, sit];
  });
  aba('Contas', ['Conta', 'Categoria', 'Tipo', 'Valor', 'Vence dia', 'Começa em', 'Parcelas',
    `Valor em ${mBR(mkTela.slice(0, 7))}`, 'Já pago', 'Situação'], linhasC, [26, 16, 16, 14, 10, 16, 10, 18, 14, 18], [3, 7, 8]);

  // 4) Metas e seus movimentos
  const metas = state.metas || [];
  aba('Metas', ['Meta', 'Objetivo', 'Guardado', 'Falta', '% do objetivo', 'Prazo', 'Situação'],
    metas.map(m => { const i = infoMeta(m);
      const sit = m.encerrada_em ? `Concluída e usada (${dBR(m.encerrada_em)})` : i.done ? 'Concluída' : 'Em andamento';
      return [`${m.icone ? m.icone + ' ' : ''}${m.nome}`, Number(m.alvo), i.saldo, i.falta, i.pct / 100, m.prazo ? mBR(String(m.prazo).slice(0, 7)) : 'Sem prazo', sit]; }),
    [28, 14, 14, 14, 14, 16, 26], [1, 2, 3], [4]);
  const nomeMeta = Object.fromEntries(metas.map(m => [m.id, m.nome]));
  aba('Metas - movimentos', ['Data', 'Meta', 'Movimento', 'Valor'].concat(shared ? ['Quem'] : []),
    (state.metaMovs || []).map(x => [dBR(x.data), nomeMeta[x.meta_id] || '', x.tipo === 'guardar' ? 'Guardou' : 'Retirou',
      Number(x.valor) * (x.tipo === 'guardar' ? 1 : -1)].concat(shared ? [nameOf(x.user_id)] : [])), [12, 28, 12, 14, 18], [3]);

  // 5) Investimentos e seus movimentos
  const invs = state.invs || [], IDX = { cdi: 'CDI', pre: 'Prefixado', ipca: 'IPCA +', selic: 'Selic', poupanca: 'Poupança', cotacao: 'Cotação', manual: 'Valor informado' };
  aba('Investimentos', ['Investimento', 'Tipo', 'Rende por', 'Taxa (%)', 'Aplicado', 'Valor hoje (estimado)', 'Ganho', 'Vencimento', 'Isento de IR'],
    invs.map(inv => { const k = calcInv(inv), T = TIPOS_INV[inv.tipo] || TIPOS_INV.outro;
      return [inv.ticker ? `${inv.nome} (${inv.ticker})` : inv.nome, T.nome, IDX[inv.indexador] || inv.indexador || '',
        inv.taxa != null ? Number(inv.taxa) : '', k.aplicado, k.liquido, k.ganho, inv.vencimento ? dBR(inv.vencimento) : '', inv.isento ? 'Sim' : 'Não']; }),
    [28, 16, 14, 8, 14, 20, 14, 12, 12], [4, 5, 6]);
  const nomeInv = Object.fromEntries(invs.map(x => [x.id, x.nome])), MOV = { aporte: 'Aplicou', resgate: 'Resgatou', saldo: 'Atualizou o valor' };
  aba('Investimentos - movimentos', ['Data', 'Investimento', 'Movimento', 'Valor', 'Quantidade'].concat(shared ? ['Quem'] : []),
    (state.invMovs || []).map(x => [dBR(x.data), nomeInv[x.investimento_id] || '', MOV[x.tipo] || x.tipo, Number(x.valor),
      x.quantidade != null ? Number(x.quantidade) : ''].concat(shared ? [nameOf(x.user_id)] : [])), [12, 28, 16, 14, 12, 18], [3]);

  // 6) Cartões: cada parcela na fatura em que cai
  const linhasK = [];
  (state.compras || []).forEach(x => {
    const k = findCartao(x.cartao_id);
    for (let n = iniDe(x) - 1; n < x.parcelas; n++){
      const f = faturaDaParcela(x, n + 1);
      linhasK.push([mBR(f.slice(0, 7)), k ? k.nome : '', x.ajuste ? '' : dBR(x.data), x.descricao, x.ajuste ? 'Saldo anterior' : x.categoria,
        x.ajuste ? '' : x.parcelas > 1 ? `${n + 1}/${x.parcelas}` : 'À vista',
        -valorParcela(x, n), Number(x.valor)].concat(shared ? [nameOf(x.user_id)] : []).concat([f]));
    }
  });
  linhasK.sort((a, b) => a[a.length - 1].localeCompare(b[b.length - 1]) || a[1].localeCompare(b[1]));
  aba('Cartões', ['Fatura', 'Cartão', 'Data da compra', 'Descrição', 'Categoria', 'Parcela', 'Valor na fatura', 'Valor total da compra'].concat(shared ? ['Quem'] : []),
    linhasK.map(l => l.slice(0, -1)), [16, 18, 14, 30, 18, 10, 16, 20, 18], [6, 7]);

  const slug = c.nome.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'controle';
  XLSX.writeFile(wb, `pra-onde-foi-${slug}.xlsx`);
};

/* ======================= ADMINISTRAÇÃO ======================= */
let users = [], adminFilter = 'pendente', adminBusca = '';
const semAcento = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const STATUS_TAG = {
  pendente: '<span class="tag tag-accent">Aguardando</span>',
  aprovado: '<span class="tag tag-neutral">Com acesso</span>',
  bloqueado: '<span class="tag tag-red">Bloqueado</span>'
};

async function loadUsers(){
  // lista pela função segura (só usuário, nome e situação); plano B enquanto o banco não tiver a função
  let { data, error } = await sb.rpc('admin_listar');
  if (error) ({ data, error } = await sb.from('perfis').select('id,email,status,is_admin,criado_em').order('criado_em', { ascending: false }));
  if (error){ toast('Não foi possível carregar as contas.'); return; }
  users = data;
  const n = users.filter(u => u.status === 'pendente').length;
  if (!$('viewAdmin').hidden) renderAdmin();
  if (dlg2.tipo === 'admconta') openConta(dlg2.id);
}

function renderAdmin(){
  setTimeout(renderUso, 0);
  const count = s => users.filter(u => u.status === s).length;
  $('cntPend').textContent = count('pendente');
  $('cntOk').textContent = count('aprovado');
  $('cntBlock').textContent = count('bloqueado');
  document.querySelectorAll('#adminSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === adminFilter)));

  const q = semAcento(adminBusca.trim());
  const acha = u => !q || semAcento(`${u.email} ${displayName(u.email)} ${u.nome || ''}`).includes(q);
  const daAba = u => adminFilter === 'todos' || (adminFilter === 'fundador' ? u.fundador : adminFilter === 'ia' ? u.ia_liberada : adminFilter === 'bot' ? u.bot_liberado : u.status === adminFilter);
  const list = users.filter(u => daAba(u) && acha(u));
  $('usersEmpty').hidden = list.length > 0;
  $('usersTable').hidden = list.length === 0;
  const fora = q && !list.length ? users.filter(acha).length : 0;
  $('usersEmpty').innerHTML = q
    ? (fora ? `Nenhuma conta com "${esc(adminBusca.trim())}" nesta aba. <button class="btn btn-secondary btn-sm" type="button" id="adminVerTodos">Ver em Todos (${fora})</button>`
            : `Nenhuma conta encontrada com "${esc(adminBusca.trim())}".`)
    : (adminFilter === 'pendente' ? 'Ninguém aguardando aprovação.' : 'Ninguém por aqui.');
  $('userRows').innerHTML = list.map(u => {
    const me = currentUser && u.id === currentUser.id;
    let actions = '';
    if (me) actions = '<span style="font-size:13px;color:var(--muted);">Você · conta master</span>';
    else {
      if (u.status === 'pendente'){
        actions += `<button class="btn btn-primary btn-sm" data-act="aprovado" data-id="${esc(u.id)}">Aprovar</button>`;
        actions += `<button class="btn btn-secondary btn-sm" data-act="bloqueado" data-id="${esc(u.id)}">Recusar</button>`;
      }
      actions += `<button class="btn btn-ghost btn-icon adm-mais" data-act="menu" data-id="${esc(u.id)}" aria-label="Mais opções de ${esc(displayName(u.email))}" title="Mais opções"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></button>`;
    }
    return `<tr>
      <td style="word-break:break-all;">${esc(displayName(u.email))}${u.nome ? `<div class="by">${esc(u.nome)}</div>` : ''}</td>
      <td style="color:var(--muted);">${new Date(u.criado_em).toLocaleDateString('pt-BR')}</td>
      <td>${me ? '<span class="tag tag-accent">Admin</span>' : STATUS_TAG[u.status]}${u.fundador ? ' <span class="tag tag-accent" title="Fundador: não paga mensalidade">⭐ Fundador</span>' : ''}${u.ia_liberada ? ' <span class="tag tag-neutral" title="Leitura por IA liberada">📷 IA</span>' : ''}${u.bot_liberado ? ` <span class="tag tag-neutral" title="Detetive liberado${u.canais ? ' · ligado: ' + esc(u.canais) : ''}">🕵️ Detetive${u.canais ? ' ✓' : ''}</span>` : ''}</td>
      <td><div style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;">${actions}</div></td>
    </tr>`;
  }).join('');
}

/* ---------- painel de uso (só datas e quantidades) ---------- */
let usoDados = null, usoFiltro = 'todos';
const DIA = 86400000;
function situacaoUso(u){
  if (!u.lanc_total) return 'nunca';
  const ult = Math.max(...[u.ultimo_acesso, u.ultimo_login, u.ultimo_lanc].filter(Boolean).map(d => new Date(d).getTime()));
  const dias = (Date.now() - ult) / DIA;
  return dias <= 7 ? 'ativo' : dias <= 30 ? 'esfriando' : 'parado';
}
function haQuanto(d){
  if (!d) return 'nunca';
  const t = new Date(d).getTime(), dias = Math.floor((Date.now() - t) / DIA);
  if (dias <= 0){ const h = Math.floor((Date.now() - t) / 3600000); return h <= 0 ? 'agora há pouco' : `há ${h} h`; }
  return dias === 1 ? 'ontem' : dias < 60 ? `há ${dias} dias` : new Date(d).toLocaleDateString('pt-BR');
}
const USO_ROT = { ativo: 'Ativo', esfriando: 'Esfriando', parado: 'Parado', nunca: 'Nunca usou', pendente: 'Aguardando', bloqueado: 'Bloqueado' };
async function loadUso(){
  const { data, error } = await sb.rpc('admin_uso');
  if (error){
    usoDados = null;
    $('usoAviso').hidden = false;
    $('usoAviso').textContent = 'O painel de uso ainda não está ligado neste banco. Rode o arquivo supabase-uso.sql no Supabase.';
    $('usoResumo').innerHTML = ''; $('usoLista').innerHTML = '';
    return;
  }
  $('usoAviso').hidden = true;
  usoDados = data;
  renderUso();
}
function renderUso(){
  if (!usoDados) return;
  const porId = Object.fromEntries(users.map(u => [u.id, u]));
  // admin não usa o controle financeiro; quem está aguardando ou bloqueado aparece à parte
  const lista = usoDados.map(d => ({ ...d, perfil: porId[d.id] })).filter(d => d.perfil && !d.perfil.is_admin)
    .map(d => ({ ...d, sit: d.perfil.status === 'aprovado' ? situacaoUso(d) : d.perfil.status }));
  const conta = s => lista.filter(d => d.sit === s).length;
  const CARDS = [['ativo', 'Ativos', 'usaram nos últimos 7 dias'], ['esfriando', 'Esfriando', 'sem usar há 8 a 30 dias'],
                 ['parado', 'Parados', 'sem usar há mais de 30 dias'], ['nunca', 'Nunca usaram', 'criaram a conta e não lançaram nada']];
  $('usoResumo').innerHTML = CARDS.map(([k, t, n]) => `<button class="uso-num" type="button" data-uso="${k}" aria-pressed="${usoFiltro === k}"><b>${conta(k)}</b><span><strong>${t}</strong> · ${n}</span></button>`).join('');
  document.querySelectorAll('#usoSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.uso === usoFiltro)));
  const q = semAcento(adminBusca.trim());
  const ultimo = d => Math.max(0, ...[d.ultimo_acesso, d.ultimo_login, d.ultimo_lanc].filter(Boolean).map(x => new Date(x).getTime()));
  const vis = lista
    .filter(d => usoFiltro === 'todos' || d.sit === usoFiltro)
    .filter(d => !q || semAcento(`${d.perfil.email} ${displayName(d.perfil.email)} ${d.perfil.nome || ''}`).includes(q))
    .sort((a, b) => ultimo(b) - ultimo(a));
  $('usoLista').innerHTML = vis.length ? vis.map(d => {
    const acesso = [d.ultimo_acesso, d.ultimo_login].filter(Boolean).sort().pop();
    const voltou = acesso && (new Date(acesso) - new Date(d.criado_em)) > 3600000;
    return `<div class="uso-item">
      <span class="quem">${esc(displayName(d.perfil.email))}${d.perfil.nome ? `<small>${esc(d.perfil.nome)}</small>` : ''}</span>
      <span class="tag tag-uso-${d.sit}">${USO_ROT[d.sit]}</span>
      <span class="dado">Último acesso: <b>${voltou || d.lanc_total ? haQuanto(acesso || d.ultimo_lanc) : 'só no cadastro'}</b><br>Conta criada ${haQuanto(d.criado_em)}</span>
      <span class="dado">Lançamentos: <b>${d.lanc_total}</b>${d.lanc_total ? ` · ${d.lanc_30d} em 30 dias` : ''}<br>${d.controles_comp ? `Divide ${d.controles_comp} controle${d.controles_comp > 1 ? 's' : ''}` : 'Só o controle pessoal'}</span>
    </div>`;
  }).join('') : '<p class="hint" style="margin:8px 0 0;">Ninguém nesta situação.</p>';
}
document.querySelectorAll('#usoSeg button').forEach(b => b.addEventListener('click', () => { usoFiltro = b.dataset.uso; renderUso(); }));
$('usoResumo').addEventListener('click', e => { const b = e.target.closest('[data-uso]'); if (!b) return; usoFiltro = usoFiltro === b.dataset.uso ? 'todos' : b.dataset.uso; renderUso(); });

$('adminRefresh').onclick = () => { loadUsers(); loadUso(); };
$('adminFundadores').onclick = async () => {
  if (!await confirmar('Marcar como fundadoras todas as contas que têm acesso hoje?\n\nElas ficam sem mensalidade quando a cobrança começar. Dá para desmarcar uma a uma depois.')) return;
  const { data, error } = await sb.rpc('admin_marcar_fundadores');
  if (error) return toast(rpcMsg(error));
  toast(`⭐ ${data} conta${data === 1 ? '' : 's'} marcada${data === 1 ? '' : 's'} como fundadora${data === 1 ? '' : 's'}.`, true);
  loadUsers();
};
document.querySelectorAll('#adminSeg button').forEach(b => b.addEventListener('click', () => { adminFilter = b.dataset.filter; renderAdmin(); }));
$('adminBusca').addEventListener('input', e => { adminBusca = e.target.value; renderAdmin(); });
$('adminBusca').addEventListener('keydown', e => { if (e.key === 'Escape'){ e.target.value = ''; adminBusca = ''; renderAdmin(); } });
$('usersEmpty').addEventListener('click', e => { if (e.target.id === 'adminVerTodos'){ adminFilter = 'todos'; renderAdmin(); } });

// ⋮ de cada conta: recursos liberados, limites e ações da conta
function openConta(id){
  const u = users.find(x => x.id === id); if (!u) return closeDlg2();
  const nome = displayName(u.email), d = `data-uid="${esc(u.id)}" data-email="${esc(nome)}"`;
  const tem = u.ia_padrao != null;   // banco já tem IA e limites
  const chave = (act, on, titulo, sub, extra = '') => `<button type="button" class="adm-chave" role="switch" aria-checked="${on}" data-adm="${act}" data-sim="${on ? '0' : '1'}" ${d} ${extra}>
      <span><b>${titulo}</b><small>${sub}</small></span><i aria-hidden="true"></i></button>`;
  const iaLim = u.ia_limite ?? u.ia_padrao, waLim = u.ia_padrao != null ? (u.wa_limite ?? u.wa_padrao) : null;
  openDlg2('Conta', nome, `
    ${u.nome ? `<p class="hint" style="margin:-6px 0 0;">${esc(u.nome)} · desde ${new Date(u.criado_em).toLocaleDateString('pt-BR')}</p>` : ''}
    <div class="adm-sec"><h4>Liberar recursos</h4>
      ${u.ia_liberada !== undefined ? chave('lib-ia', !!u.ia_liberada, '📷 Leitura por IA', 'Foto, PDF e áudio no app e no Detetive') : ''}
      ${u.bot_liberado !== undefined ? chave('lib-bot', !!u.bot_liberado, '🕵️ Detetive Grana', u.canais ? `Ligado: ${esc(u.canais.replace('telegram', 'Telegram').replace('whatsapp', 'WhatsApp'))}. Desligar desconecta.` : 'Lançar pelo Telegram (e WhatsApp quando liberar)') : ''}
      ${u.status === 'aprovado' ? chave('fundador', !!u.fundador, '⭐ Fundador', 'Não paga mensalidade quando a cobrança começar') : ''}
      ${u.ia_liberada === undefined ? '<p class="hint" style="margin:0;">Para liberar IA e Detetive por conta, rode o supabase-liberacoes.sql neste banco.</p>' : ''}
    </div>
    ${tem && u.status === 'aprovado' ? `<div class="adm-sec"><h4>Limites do mês</h4>
      <button type="button" class="adm-linha" data-adm="ialimite" ${d} data-lim="${u.ia_limite ?? ''}" data-padrao="${u.ia_padrao}"><span>📷 Leituras de IA</span><b>${u.ia_usadas || 0} de ${iaLim}</b><em>Mudar</em></button>
      <button type="button" class="adm-linha" data-adm="walimite" ${d} data-lim="${u.wa_limite ?? ''}" data-padrao="${u.wa_padrao}"><span>💬 Respostas no WhatsApp</span><b>${u.wa_usadas || 0} de ${waLim}</b><em>Mudar</em></button>
    </div>` : ''}
    <div class="adm-sec"><h4>Conta</h4>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${u.status !== 'aprovado' ? `<button class="btn btn-primary btn-sm" data-adm="aprovado" ${d}>${u.status === 'bloqueado' ? 'Desbloquear' : 'Aprovar'}</button>` : ''}
        ${u.status !== 'bloqueado' ? `<button class="btn btn-secondary btn-sm" data-adm="bloqueado" ${d}>${u.status === 'pendente' ? 'Recusar' : 'Bloquear'}</button>` : ''}
        <button class="btn btn-secondary btn-sm" data-adm="senha" ${d}>Nova senha</button>
        <button class="btn btn-danger btn-sm" data-adm="excluir" ${d}>Excluir conta</button>
      </div>
    </div>`, { tipo: 'admconta', id });
}
$('dlg2Body').addEventListener('click', e => { if (dlg2.tipo === 'admconta' && e.target.closest('[data-adm]')) acaoAdmin(e); });
$('userRows').addEventListener('click', acaoAdmin);
async function acaoAdmin(e){
  const b = e.target.closest('[data-adm], [data-act]');
  if (!b) return;
  if (b.dataset.act === 'menu') return openConta(b.dataset.id);
  const id = b.dataset.uid || b.dataset.id, act = b.dataset.adm || b.dataset.act;
  let error;
  if (act === 'senha'){
    const nova = await pedirTexto('Senha temporária', `Para ${b.dataset.email}. Passe para a pessoa e peça para trocar depois.`, { rotulo: 'Senha (mínimo de 8 caracteres)', tipo: 'text', okTxt: 'Definir senha' });
    if (nova === null) return;
    if (nova.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres.');
    b.disabled = true;
    ({ error } = await sb.rpc('admin_definir_senha', { alvo: id, nova }));
    b.disabled = false;
    if (error) return toast(rpcMsg(error));
    toast(`Senha de ${b.dataset.email} redefinida. Peça para a pessoa trocar em "Trocar senha" ao entrar.`, true);
    return;
  }
  if (act === 'ialimite'){
    const padrao = Number(b.dataset.padrao);
    const v = await pedirTexto('Leituras de IA por mês', `Quantas fotos, PDFs e áudios ${b.dataset.email} pode mandar para a IA ler por mês. Cada leitura custa menos de 1 centavo. Deixe vazio para usar o padrão (${padrao}).`,
      { rotulo: 'Leituras por mês', tipo: 'number', modo: 'numeric', valor: b.dataset.lim, placeholder: String(padrao), okTxt: 'Salvar', vazioOk: true });
    if (v === null) return;
    const n = String(v).trim() === '' ? null : Math.round(Number(v));
    if (n !== null && !(n >= 0 && n <= 2000)) return toast('Use um número de 0 a 2000.');
    b.disabled = true;
    ({ error } = await sb.rpc('admin_definir_ia_limite', { alvo: id, p_limite: n }));
    if (error){ b.disabled = false; return toast(rpcMsg(error)); }
    toast(n === null ? `Voltou para o padrão (${padrao} por mês).` : `${b.dataset.email}: ${n} leituras de IA por mês.`, true);
    return loadUsers();
  }
  if (act === 'walimite'){
    const padrao = Number(b.dataset.padrao);
    const v = await pedirTexto('Mensagens no WhatsApp por mês', `Quantas respostas do Detetive no WhatsApp ${b.dataset.email} pode receber por mês. Cada uma custa cerca de R$ 0,035. Deixe vazio para usar o padrão (${padrao}: ${padrao === 150 ? 'fundador' : 'assinante'}).`,
      { rotulo: 'Respostas por mês', tipo: 'number', modo: 'numeric', valor: b.dataset.lim, placeholder: String(padrao), okTxt: 'Salvar', vazioOk: true });
    if (v === null) return;
    const n = String(v).trim() === '' ? null : Math.round(Number(v));
    if (n !== null && !(n >= 0 && n <= 3000)) return toast('Use um número de 0 a 3000.');
    b.disabled = true;
    ({ error } = await sb.rpc('admin_definir_wa_limite', { alvo: id, p_limite: n }));
    if (error){ b.disabled = false; return toast(rpcMsg(error)); }
    toast(n === null ? `Voltou para o padrão (${padrao} por mês).` : `${b.dataset.email}: ${n} respostas por mês no WhatsApp.`, true);
    return loadUsers();
  }
  if (act === 'lib-ia' || act === 'lib-bot'){
    const sim = b.dataset.sim === '1', bot = act === 'lib-bot';
    if (bot && !sim && /,|telegram|whatsapp/.test((users.find(x => x.id === id) || {}).canais || '') && !await confirmar(`Tirar o Detetive de ${b.dataset.email}?\n\nOs canais ligados (Telegram/WhatsApp) são desconectados.`, 'Tirar')) return;
    b.disabled = true;
    ({ error } = await sb.rpc('admin_liberar', { alvo: id, p_recurso: bot ? 'bot' : 'ia', sim }));
    if (error){ b.disabled = false; return toast(rpcMsg(error)); }
    toast(`${bot ? '🕵️ Detetive' : '📷 Leitura por IA'} ${sim ? 'liberado' : 'desligado'} para ${b.dataset.email}.`, true);
    return loadUsers();
  }
  if (act === 'fundador'){
    b.disabled = true;
    ({ error } = await sb.rpc('admin_definir_fundador', { alvo: id, sim: b.dataset.sim === '1' }));
    if (error){ b.disabled = false; return toast(rpcMsg(error)); }
    toast(b.dataset.sim === '1' ? '⭐ Marcado como fundador.' : 'Não é mais fundador.', true);
    return loadUsers();
  }
  if (act === 'excluir'){
    if (!await confirmar(`Excluir a conta ${b.dataset.email}?\n\nA pessoa perde o acesso e o "Meu controle" dela é apagado. Nos controles compartilhados, os lançamentos que ela fez continuam lá. Não dá para desfazer.`)) return;
    b.disabled = true;
    ({ error } = await sb.rpc('admin_excluir_usuario', { alvo: id }));
  } else {
    b.disabled = true;
    ({ error } = await sb.rpc('admin_mudar_status', { alvo: id, novo: act }));
  }
  if (error){ b.disabled = false; return toast(rpcMsg(error)); }
  if (act === 'excluir') closeDlg2();
  await loadUsers();
}

/* ======================= APP INSTALÁVEL ======================= */
if (false && 'serviceWorker' in navigator && location.protocol === 'https:'){   // HMG: sem app instalável
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/* ======================= INÍCIO ======================= */
fillCats();
if (!sb){
  show('viewSetup');
} else {
  checarProvedores();
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY'){ recovering = true; show('viewAuth'); setAuthMode('nova'); return; }
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
    if (recovering){ if (session){ show('viewAuth'); setAuthMode('nova'); } return; }
    // setTimeout evita travar o Supabase ao fazer consultas dentro deste aviso
    setTimeout(() => handleSession(session, event === 'SIGNED_OUT'), 0);
  });
}

// ícones desenhados são só enfeite: o leitor de tela lê o texto do botão
document.querySelectorAll('svg:not([aria-hidden])').forEach(s => s.setAttribute('aria-hidden', 'true'));

// robozinho: no computador o aviso aparece ao passar o mouse; no celular, ao tocar
document.addEventListener('click', e => {
  const b = e.target.closest('.lorig');
  document.querySelectorAll('.lorig.on').forEach(x => { if (x !== b) x.classList.remove('on'); });
  if (b) b.classList.toggle('on');
});

$('drPainel').addEventListener('click', () => irPara('admin'));
$('adminMinhaConta').addEventListener('click', () => irPara(''));
