// o app não pode ser aberto dentro de outro site (proteção contra clique disfarçado)
if (window.top !== window.self){ document.documentElement.style.display = 'none'; try { window.top.location = window.self.location.href; } catch(e){} }
// Pra Onde Foi? — código do app
/* =====================================================================
   CONFIGURAÇÃO — cole aqui os dados do seu projeto Supabase
   (Project Settings → API). A chave "anon public" pode ficar no código.
   NUNCA coloque aqui a chave "service_role".
   ===================================================================== */
const SUPABASE_URL = 'https://syffvgczgukoickcprni.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_r8xTsMwtJbJ64IVZP5-RBw_S53BVlkr';

const KEY = 'cf-lancamentos-v1';        // dados antigos, salvos só neste aparelho
const IMPORTED_KEY = 'cf-importado-v1';
const BKEY = 'cf-orcamento-v1';
const CATS = {
  exp: ['Mercado','Moradia','Contas','Transporte','Saúde','Lazer','Educação','Outros'],
  inc: ['Salário','Renda extra','Outros']
};
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const brl = v => v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pad = n => String(n).padStart(2,'0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plural = (n,w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const $ = id => document.getElementById(id);
const REDIRECT = location.origin + location.pathname;

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

function parseAmount(s){
  s = String(s || '').replace(/[^\d.,]/g,'');
  if (s.includes(',')) s = s.replace(/\./g,'').replace(',','.');
  const n = parseFloat(s);
  return isFinite(n) ? Math.round(n*100)/100 : NaN;
}
const fromRow = r => ({id:r.id, type:r.tipo, desc:r.descricao, cat:r.categoria, amount:Number(r.valor), date:r.data, uid:r.user_id});
const toRow = e => ({tipo:e.type, descricao:e.desc, categoria:e.cat, valor:e.amount, data:e.date});
const COLS = 'id,tipo,descricao,categoria,valor,data,user_id';

// ---------- telas ----------
const VIEWS = ['viewSetup','viewLoading','viewAuth','viewWait','viewApp','viewAdmin'];
function show(v){ VIEWS.forEach(id => { $(id).hidden = id !== v; }); window.scrollTo(0,0); }
let toastTimer;
function toast(msg, ok){
  $('toast').textContent = msg; $('toast').hidden = false;
  $('toast').classList.toggle('ok', !!ok);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

const configured = !SUPABASE_URL.startsWith('COLE') && !SUPABASE_ANON_KEY.startsWith('COLE');
const sb = configured && window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

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
let authMode = 'entrar', recovering = false;
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
$('backLogin').onclick = () => setAuthMode('entrar');

function translateError(err){
  const msg = (err && (err.message || err.error_description)) || String(err);
  if (/invalid login credentials/i.test(msg)) return 'Usuário ou senha incorretos.';
  if (/not confirmed/i.test(msg)) return 'Confirme seu e-mail pelo link que enviamos antes de entrar.';
  if (/already registered|already been registered|already exists/i.test(msg)) return 'Esse usuário já existe. Use "Entrar" ou escolha outro nome.';
  if (/email address .* invalid|invalid email/i.test(msg)) return 'Esse nome de usuário não foi aceito. Tente só letras e números.';
  if (/email rate limit/i.test(msg)) return 'O Supabase atingiu o limite de envio de e-mails. Desligue "Confirm email" em Authentication → Sign In / Providers → Email e tente de novo em alguns minutos.';
  if (/rate limit|security purposes|too many/i.test(msg)) return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo. (' + msg + ')';
  if (/should contain|weak|pwned|leaked|compromised/i.test(msg)) return 'O Supabase recusou essa senha pelas regras dele: ' + msg;
  if (/at least \d+ characters|password should be at least/i.test(msg)) return 'A senha é curta demais para as regras do Supabase: ' + msg;
  if (/same password|different from the old/i.test(msg)) return 'A nova senha precisa ser diferente da anterior.';
  if (/already linked|identity_already_exists|already exists for another user/i.test(msg)) return 'Essa conta Google já está ligada a outro usuário do app.';
  if (/manual linking/i.test(msg)) return 'Falta ativar "Allow manual linking" no Supabase (Authentication → Sign In / Providers).';
  if (/provider is not enabled|unsupported provider/i.test(msg)) return 'O login com Google ainda não foi ativado no Supabase.';
  if (/access_denied|cancel/i.test(msg)) return 'O login com Google foi cancelado.';
  if (/failed to fetch|network/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet.';
  return 'Algo deu errado: ' + msg;
}

$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const typed = $('authEmail').value.trim(), pass = $('authPass').value;
  const email = toLoginEmail(typed);
  if (authMode !== 'nova' && !email)
    return authMsg(typed.includes('@') ? 'Digite um e-mail válido.' : 'O usuário precisa ter de 3 a 30 caracteres, só letras, números, ponto, hífen ou _ (sem espaço nem acento).', 'err');
  if (authMode === 'esqueci' && isUsernameLogin(email))
    return authMsg('Contas com nome de usuário não recebem e-mail. Peça ao administrador uma senha temporária e depois troque em "Trocar senha".', 'err');
  // senha nova: mínimo 8. Para entrar, aceita as senhas antigas de 6 ou 7.
  if ((authMode === 'criar' || authMode === 'nova') && pass.length < 8) return authMsg('A senha precisa ter pelo menos 8 caracteres.', 'err');
  if (authMode === 'entrar' && !pass) return authMsg('Digite a sua senha.', 'err');
  const btn = $('authSubmit'); btn.disabled = true; authMsg('');
  try {
    if (authMode === 'entrar'){
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    } else if (authMode === 'criar'){
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: REDIRECT } });
      if (error) throw error;
      if (!data.session){
        setAuthMode('entrar');
        authMsg(`Conta criada! Enviamos um link de confirmação para ${typed}. Confirme e depois entre aqui.`, 'ok');
      }
    } else if (authMode === 'esqueci'){
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: REDIRECT });
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
    btn.disabled = false;
  }
});

document.querySelectorAll('[data-changepass]').forEach(b => b.addEventListener('click', async () => {
  const nova = prompt('Digite a nova senha (mínimo de 8 caracteres):');
  if (nova === null) return;
  if (nova.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres.');
  const confirma = prompt('Digite a nova senha de novo para confirmar:');
  if (confirma === null) return;
  if (confirma !== nova) return toast('As senhas não conferem. Tente de novo.');
  const { error } = await sb.auth.updateUser({ password: nova });
  if (error) return toast(translateError(error));
  alert('Senha alterada com sucesso.');
}));

document.querySelectorAll('[data-logout]').forEach(b => b.addEventListener('click', async () => {
  await sb.auth.signOut();
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

async function handleSession(session, force){
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

  let { data, error } = await sb.from('perfis').select('id,email,status,is_admin,nome,foto,email_aviso,whatsapp,avisos').eq('id', currentUser.id).maybeSingle();
  perfilNovo = !error;
  if (error && (error.code === '42703' || /column/i.test(error.message || ''))){
    ({ data, error } = await sb.from('perfis').select('id,email,status,is_admin').eq('id', currentUser.id).maybeSingle());
  }
  if (error || !data){
    profile = null;
    return waitScreen('Algo não<br>carregou', error
      ? 'Não foi possível carregar sua conta. Verifique a internet e tente de novo.'
      : 'Seu perfil ainda não existe. Confira se o script do banco (supabase-setup.sql) foi executado.');
  }
  profile = data;
  if (profile.status === 'pendente')
    return waitScreen('Cadastro<br>em análise', 'Sua conta foi criada e está aguardando a liberação do administrador. Assim que for aprovada, é só tocar em "Verificar de novo".');
  if (profile.status === 'bloqueado')
    return waitScreen('Acesso<br>bloqueado', 'Seu acesso foi suspenso pelo administrador.');

  renderMe();
  $('adminEmail').textContent = displayName(profile.email);
  if (profile.is_admin){
    // conta master: só administração, sem controle financeiro
    show('viewAdmin');
    renderAdmin();
    loadUsers();
    return;
  }
  if (!(await loadControles())) return;
  await Promise.all([loadMembers(), loadEntries(), loadInvites(), loadContas(), loadMetas(), loadInvest()]);
  show('viewApp');
  render();
  startRealtime();
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
function rpcMsg(error){
  const msg = (error && error.message) || '';
  if (/failed to fetch|network/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet.';
  return msg || 'Algo deu errado.';
}

async function loadControles(){
  const g = await sb.rpc('garantir_controle_pessoal');
  if (g.error){
    if (g.error.code === 'PGRST202' || /could not find the function|does not exist/i.test(g.error.message || '')){
      waitScreen('Falta<br>atualizar', 'O banco ainda não tem os controles compartilhados. Rode o arquivo supabase-controles.sql no SQL Editor do Supabase e toque em "Verificar de novo".');
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
  const { y, m } = state;
  const start = `${y}-${pad(m+1)}-01`;
  const nd = new Date(y, m + 1, 1);
  const end = `${nd.getFullYear()}-${pad(nd.getMonth()+1)}-01`;
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE){
    const { data, error } = await sb.from('lancamentos').select(COLS)
      .eq('controle_id', state.cid).gte('data', start).lt('data', end)
      .order('data', { ascending: false }).order('criado_em', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error){ toast('Não foi possível carregar os lançamentos.'); return false; }
    all.push(...data);
    if (data.length < PAGE) break;
  }
  if (seq !== loadSeq) return false;           // o usuário já trocou de mês/controle
  state.entries = all.map(fromRow);
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
async function refresh(){ const [ok] = await Promise.all([loadEntries(), loadContas(), loadMetas(), loadInvest()]); if (ok) render(); }

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
function confirmar(msg, okTxt){
  const [titulo, ...resto] = String(msg).split('\n\n');
  const verbo = okTxt || (titulo.match(/^[A-Za-zÀ-ú]+/) || ['Confirmar'])[0];
  return new Promise(res => {
    $('confTitle').textContent = titulo.replace(/\?$/, '') + '?';
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

/* ======================= FORMULÁRIO ======================= */
function fillCats(){
  $('cat').innerHTML = CATS[state.type].map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  document.querySelectorAll('#typeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === state.type)));
}
document.querySelectorAll('#typeSeg button').forEach(b => b.addEventListener('click', () => { state.type = b.dataset.type; fillCats(); vincOpcoes(); }));

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
  } else {
    const ms = metas.filter(x => x.i.saldo > 0);
    if (ms.length){ n += ms.length; html += `<optgroup label="Retirar da meta">${ms.map(x => `<option value="r:${esc(x.m.id)}">${esc(x.m.icone)} ${esc(x.m.nome)} · tem ${brl(x.i.saldo)}</option>`).join('')}</optgroup>`; }
  }
  sel.innerHTML = html;
  $('vincWrap').hidden = n === 0;
  sel.value = [...sel.options].some(o => o.value === atual) ? atual : '';
  aplicarVinc(false);
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
    return refresh();
  }
  const entry = { type: state.type, desc, cat: $('cat').value, amount, date: $('date').value || todayISO() };
  $('addBtn').disabled = true;
  const { data, error } = await sb.from('lancamentos').insert({ ...toRow(entry), controle_id: state.cid }).select(COLS).single();
  $('addBtn').disabled = false;
  if (error) return showError('Não foi possível salvar. Verifique a conexão e tente de novo.');
  const [y,m] = entry.date.split('-').map(Number);
  $('desc').value = ''; $('amount').value = '';
  if (y === state.y && m - 1 === state.m){ state.entries.push(fromRow(data)); render(); }
  else { state.y = y; state.m = m - 1; await refresh(); }
  $('desc').focus();
});

/* ======================= FILTRO ENTRADAS / SAÍDAS ======================= */
state.filtro = null;
function toggleFiltro(f){ state.filtro = state.filtro === f ? null : f; render(); }
document.querySelectorAll('.stat-filtro').forEach(el => {
  el.addEventListener('click', () => toggleFiltro(el.dataset.filtro));
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggleFiltro(el.dataset.filtro); } });
});
$('filtroLimpar').onclick = () => { state.filtro = null; render(); };

/* ======================= NAVEGAÇÃO ======================= */
function shift(n){ const d = new Date(state.y, state.m + n, 1); state.y = d.getFullYear(); state.m = d.getMonth(); render(); refresh(); }
$('prev').onclick = () => shift(-1);
$('next').onclick = () => shift(1);
$('today').onclick = () => { const d = new Date(); state.y = d.getFullYear(); state.m = d.getMonth(); render(); refresh(); };
$('rows').addEventListener('click', async e => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  const id = b.dataset.del;
  const ent = state.entries.find(x => x.id === id);
  if (ent && !await confirmar(`Excluir este lançamento?

${ent.desc} · ${ent.type === 'inc' ? '+' : '−'} ${brl(ent.amount)}`)) return;
  const before = state.entries;
  state.entries = state.entries.filter(x => x.id !== id);
  render();
  const { error, count } = await sb.from('lancamentos').delete({ count: 'exact' }).eq('id', id);
  if (error || count === 0){ state.entries = before; render(); toast('Não foi possível excluir. Tente de novo.'); return; }
  if (state.contas.length && await loadContas()) renderContas();   // se era o pagamento de uma conta, ela volta a ficar em aberto
});

$('ctrlSelect').addEventListener('change', async e => {
  selectControle(e.target.value);
  state.entries = []; state.members = []; state.contas = []; state.pags = []; state.partes = {}; state.cmeses = {}; state.metas = []; state.metaMovs = []; state.invs = []; state.invMovs = [];
  render();
  await loadMembers(); await refresh();
});
$('ctrlNew').onclick = async () => {
  const nome = prompt('Nome do novo controle (ex.: Casa, Família, Viagem):');
  if (nome === null || !nome.trim()) return;
  const { data, error } = await sb.rpc('criar_controle', { p_nome: nome.trim() });
  if (error) return toast(rpcMsg(error));
  await loadControles(); selectControle(data); await loadMembers(); await refresh();
  openManage();
};
$('ctrlJoin').onclick = async () => {
  const cod = prompt('Digite o código que você recebeu (ex.: K7P4-QX9M):');
  if (cod === null || !cod.trim()) return;
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
    .subscribe(status => { rtOk = status === 'SUBSCRIBED'; });
}
let rtContasTimer = null;
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
        <span class="kicker" style="color:var(--accent);">Convite</span>
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
  const {entries, y, m} = state;
  const ym = `${y}-${pad(m+1)}`;
  const month = entries.filter(e => e.date.startsWith(ym)).sort((a,b) => b.date.localeCompare(a.date));
  const expList = month.filter(e => e.type === 'exp');
  const inc = month.filter(e => e.type === 'inc').reduce((s,e) => s + e.amount, 0);
  const exp = expList.reduce((s,e) => s + e.amount, 0);
  const bal = inc - exp;
  const shared = isShared();

  renderCtrlBar();
  $('monthTitle').textContent = `${MONTHS[m]} ${y}`;
  { const d = new Date(); $('today').hidden = (y === d.getFullYear() && m === d.getMonth()); }
  document.title = `${MONTHS[m]} ${y} · Pra Onde Foi?`;
  $('incVal').textContent = brl(inc); $('incVal').classList.toggle('zero', !inc); $('incNote').textContent = plural(month.length - expList.length,'lançamento');
  $('expVal').textContent = brl(exp); $('expVal').classList.toggle('zero', !exp); $('expNote').textContent = plural(expList.length,'lançamento');
  $('balVal').textContent = brl(bal); $('balVal').classList.toggle('zero', !bal);
  $('balNote').textContent = !month.length ? 'Sem lançamentos'
    : bal >= 0 ? `Sobrou ${inc ? Math.round(bal/inc*100) : 0}% do que entrou` : 'Gastou mais do que entrou';
  $('balCard').classList.toggle('neg', bal < 0);

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
  $('filtroInfo').hidden = !f;
  $('filtroNome').textContent = f === 'inc' ? 'entradas' : 'saídas';
  const shown = f ? month.filter(e => e.type === f) : month;
  $('tableWrap').hidden = shown.length === 0;
  $('empty').hidden = shown.length > 0;
  $('empty').textContent = !f ? 'Nenhum lançamento neste mês. Use o formulário acima para adicionar o primeiro.'
    : f === 'inc' ? 'Nenhuma entrada neste mês.' : 'Nenhuma saída neste mês.';
  $('rows').innerHTML = shown.map(e => {
    const mine = currentUser && e.uid === currentUser.id;
    return `
    <tr>
      <td style="color:var(--muted);">${e.date.slice(8,10)}/${e.date.slice(5,7)}</td>
      <td>${esc(e.desc)}${shared ? `<div class="by">por ${esc(nameOf(e.uid))}</div>` : ''}<span class="tag cat-inline ${e.type === 'inc' ? 'tag-green' : 'tag-neutral'}">${esc(e.cat)}</span></td>
      <td><span class="tag ${e.type === 'inc' ? 'tag-green' : 'tag-neutral'}">${esc(e.cat)}</span></td>
      <td style="text-align:right;white-space:nowrap;font-weight:500;color:${e.type === 'inc' ? 'var(--green)' : 'var(--out)'};">${e.type === 'inc' ? '+ ' : '− '}${brl(e.amount)}</td>
      <td style="text-align:right;">${mine ? `<button class="btn btn-ghost btn-icon" data-del="${esc(e.id)}" style="color:var(--muted);" aria-label="Excluir ${esc(e.desc)}"><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>` : ''}</td>
    </tr>`;
  }).join('');

  const byCat = {};
  expList.forEach(e => { byCat[e.cat] = (byCat[e.cat] || 0) + e.amount; });
  const list = Object.entries(byCat).sort((a,b) => b[1] - a[1]);
  const max = list.length ? list[0][1] : 0;
  renderTabs();
  renderContas();
  renderMetas();
  renderInvest();
  vincOpcoes();
  $('cats').innerHTML = list.length ? list.map(([name,v]) => `
    <div style="display:flex;flex-direction:column;gap:5px;">
      <div style="display:flex;justify-content:space-between;gap:var(--space-3);font-size:14px;">
        <span>${esc(name)}</span>
        <span style="font-variant-numeric:tabular-nums;color:var(--muted);">${brl(v)} · ${Math.round(exp ? v/exp*100 : 0)}%</span>
      </div>
      <div style="height:6px;background:var(--track);border-radius:999px;overflow:hidden;"><div style="height:100%;width:${max ? v/max*100 : 0}%;background:var(--accent);border-radius:999px;"></div></div>
    </div>`).join('') : '<span style="font-size:14px;color:var(--muted);">Sem saídas neste mês.</span>';
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
try { const t = localStorage.getItem('pof-aba'); if (['lanc','contas','metas','invest'].includes(t)) state.tab = t; } catch(e){}
try { const t = new URLSearchParams(location.search).get('aba'); if (['lanc','contas','metas','invest'].includes(t)) state.tab = t; } catch(e){}

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
  return { late, hoje, primeiro };
}

const TITULOS = { metas: 'Metas', invest: 'Investimentos' };
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
  $('tabContas').hidden = desligada || state.tab !== 'contas';
  $('tabMetas').hidden = desligada || state.tab !== 'metas';
  $('tabInvest').hidden = desligada || state.tab !== 'invest';
  $('export').hidden = state.tab !== 'lanc';
  syncAlerta();
  const porMes = state.tab === 'lanc' || state.tab === 'contas';
  $('monthNav').style.display = porMes ? 'flex' : 'none';
  if (!porMes){ $('monthTitle').textContent = TITULOS[state.tab]; document.title = `${TITULOS[state.tab]} · Pra Onde Foi?`; }
  else { $('monthTitle').textContent = `${MONTHS[state.m]} ${state.y}`; document.title = `${MONTHS[state.m]} ${state.y} · Pra Onde Foi?`; }
}
function setTab(t){
  state.tab = t;
  try { localStorage.setItem('pof-aba', t); } catch(e){}
  try { const u = new URL(location.href); u.searchParams.set('aba', t); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch(e){}
  renderTabs();
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
$('navMenu').addEventListener('click', () => openMenu());
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
    $('billEmpty').textContent = 'As contas a pagar ainda não foram ativadas no banco. Rode o arquivo supabase-contas.sql no SQL Editor do Supabase e recarregue a página.';
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
  const total = r2(list.reduce((s, i) => s + i.total, 0));
  const pago = r2(list.reduce((s, i) => s + i.pago, 0));
  const falta = r2(list.reduce((s, i) => s + i.falta, 0));
  const pagas = list.filter(i => i.paid).length;
  const minhas = list.filter(i => i.parts.some(p => p.uid === me));
  const minhaFalta = r2(minhas.reduce((s, i) => s + i.parts.filter(p => p.uid === me).reduce((a, p) => a + Math.min(p.falta, i.falta), 0), 0));

  $('billTotal').textContent = brl(total);
  $('billTotalNote').textContent = plural(list.length, 'conta');
  $('billPaid').textContent = brl(pago); $('billPaid').classList.toggle('zero', !pago);
  const parciais = list.filter(i => !i.paid && i.pago > 0).length;
  $('billPaidNote').textContent = !list.length ? '' : `${pagas} de ${list.length} ${list.length === 1 ? 'paga' : 'pagas'}` + (parciais ? ` · ${parciais} em parte` : '');
  $('billLeft').textContent = brl(falta);
  $('billLeftNote').textContent = !list.length ? 'Nenhuma conta neste mês'
    : falta <= 0 ? 'Tudo pago ✓'
    : minhas.length ? `Minha parte: falta ${brl(minhaFalta)}`
    : `${plural(list.length - pagas, 'conta')} em aberto`;

  $('billEmpty').hidden = list.length > 0;
  $('billEmpty').textContent = 'Nenhuma conta neste mês. Toque em "Nova conta" para cadastrar aluguel, luz, cartão…';
  $('billList').innerHTML = list.map(i => {
    const c = i.c;
    const tag = i.paid ? '<span class="tag tag-neutral">Paga ✓</span>'
      : i.st === 'late' ? `<span class="tag tag-red">Vencida</span>`
      : i.antes ? ''
      : i.days === 0 ? '<span class="tag tag-accent">Vence hoje</span>'
      : i.st === 'soon' ? `<span class="tag tag-accent">Vence em ${plural(i.days, 'dia')}</span>`
      : i.pago > 0 ? '<span class="tag tag-neutral">Parcial</span>' : '';
    const linha2 = [esc(c.categoria), `vence ${ddmm(i.due)}`, (!i.paid && i.pago > 0) ? `pago ${brl(i.pago)} de ${brl(i.total)}` : ''].filter(Boolean).join(' · ');
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
  }).join('');
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
  if (!await confirmar('O "Meu controle" é só seu.\n\nPara dividir com alguém, crie um controle compartilhado (ex.: Casa, Apê) e convide a pessoa. Seus lançamentos pessoais continuam só seus.\n\nCriar agora?')) return;
  $('ctrlNew').click();
};

/* ---------- janela ---------- */
let dlg2 = {};   // o que está aberto na janela: { tipo, id, mk }
function openDlg2(kicker, title, html, ctx){
  $('dlg2Kicker').textContent = kicker;
  $('dlg2Title').textContent = title;
  $('dlg2Body').innerHTML = html;
  $('dlg2').hidden = false;
  dlg2 = ctx || {};
}
function closeDlg2(){ $('dlg2').hidden = true; dlg2 = {}; }
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
      <div class="kv"><span>Falta pagar</span><b style="color:var(--accent);">${brl(i.falta)}</b></div>
      ${i.parts.length ? `<div class="kv"><span>Divisão</span><b style="text-align:right;font-weight:500;">${partsLine(i)}</b></div>` : ''}
    </div>
    <div class="dlg-sec" style="gap:var(--space-3);">
      <div class="field">
        <label for="payVal">Quanto você está pagando (R$)</label>
        <input class="input" id="payVal" inputmode="decimal" value="${num(sugere)}" style="font-variant-numeric:tabular-nums;">
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
  const status = i.paid ? 'Paga ✓' : i.st === 'late' ? '<span style="color:#ff8a8d;">Vencida</span>'
    : i.antes ? (i.pago > 0 ? `Parcial · falta ${brl(i.falta)}` : 'Em aberto')
    : i.days === 0 ? '<span style="color:var(--accent);">Vence hoje</span>'
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
  const cats = CATS.exp.includes(c && c.categoria) || !c ? CATS.exp : [c.categoria, ...CATS.exp];
  const parcAtual = c && c.tipo === 'parcelada' ? Math.max(1, Math.min(c.parcelas, mdiff(c.inicio, mk) + 1)) : 1;
  const membros = state.members.length ? state.members : [{ user_id: myId(), login: currentUser.email }];
  const peso = uid => { const p = partes.find(x => x.user_id === uid); return p ? Number(p.peso) : 0; };
  openDlg2(c ? 'Editar conta' : `A partir de ${mlabel(mk)}`, c ? c.nome : 'Nova conta', `
    <form id="billForm" novalidate style="display:flex;flex-direction:column;gap:var(--space-4);">
      <div class="field">
        <label for="bfNome">Nome</label>
        <input class="input" id="bfNome" maxlength="60" placeholder="Ex.: Aluguel, Luz, Cartão" value="${c ? esc(c.nome) : ''}" autocomplete="off">
      </div>
      <div class="grid2">
        <div class="field">
          <label for="bfValor" id="bfValorLbl">Valor (R$)</label>
          <input class="input" id="bfValor" inputmode="decimal" placeholder="0,00" value="${c ? num(Number(c.valor)) : ''}">
        </div>
        <div class="field">
          <label for="bfDia">Vence todo dia</label>
          <input class="input" id="bfDia" type="number" inputmode="numeric" min="1" max="31" placeholder="Ex.: 10" value="${c ? c.dia : ''}">
        </div>
      </div>
      <div class="field">
        <label for="bfCat">Categoria</label>
        <select class="input" id="bfCat">${cats.map(x => `<option${c && c.categoria === x ? ' selected' : (!c && x === 'Contas' ? ' selected' : '')}>${esc(x)}</option>`).join('')}</select>
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
          <input class="input" id="bfParcTot" type="number" inputmode="numeric" min="2" max="240" placeholder="Ex.: 10" value="${c && c.parcelas ? c.parcelas : ''}">
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
            <input class="input" data-pv="${esc(p.user_id)}" inputmode="decimal" placeholder="0,00" value="${peso(p.user_id) && bf.modo === 'valores' ? num(peso(p.user_id)) : ''}" style="width:120px;flex:none;">
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
    hint.style.color = ok ? '' : '#ff8a8d';
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
  if (a.startsWith('pf') || a.startsWith('mm') || a.startsWith('iv')) return;   // perfil e metas têm o próprio tratamento
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
    const v = prompt(`Valor de "${c.nome}" só em ${mlabel(mk)} (R$).\nDeixe em branco para voltar ao valor normal (${brl(Number(c.valor))}).`, num(i.total));
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
  return { movs, saldo, alvo, falta, pct, meses, porMes, ritmo, chegaEm, porPessoa, done: falta <= 0 };
}

function renderMetas(){
  $('metaModelos').innerHTML = MODELOS_META.map((x, k) => `<button class="chip" type="button" data-modelo="${k}">${x.icone} ${esc(x.nome)}</button>`).join('');
  if (!state.metasOk){
    $('metasGrid').innerHTML = '';
    $('metasVazio').hidden = false;
    $('metasVazio').textContent = 'As metas ainda não foram ativadas no banco. Rode o arquivo supabase-metas.sql no SQL Editor do Supabase e recarregue a página.';
    $('metaNova').disabled = true;
    return;
  }
  $('metaNova').disabled = false;
  const lista = state.metas.map(m => ({ m, i: infoMeta(m) }))
    .sort((a, b) => (a.i.done - b.i.done) || ((a.m.prazo || '9999') .localeCompare(b.m.prazo || '9999')) || a.m.criado_em.localeCompare(b.m.criado_em));
  const abertas = lista.filter(x => !x.i.done), feitas = lista.filter(x => x.i.done);
  const guardado = r2(lista.reduce((s, x) => s + x.i.saldo, 0));
  const falta = r2(abertas.reduce((s, x) => s + x.i.falta, 0));
  $('mtGuardado').textContent = brl(guardado);
  $('mtGuardadoNote').textContent = lista.length ? `em ${plural(lista.length, 'meta')}` : 'Crie sua primeira meta';
  $('mtFalta').textContent = brl(falta);
  const porMesTotal = r2(abertas.reduce((s, x) => s + (x.i.porMes || 0), 0));
  $('mtFaltaNote').textContent = !abertas.length ? (lista.length ? 'Tudo alcançado' : '') : porMesTotal ? `Guarde ${brl(porMesTotal)}/mês para chegar nos prazos` : `${plural(abertas.length, 'meta')} em andamento`;
  $('mtConcl').textContent = feitas.length;
  $('mtConclNote').textContent = feitas.length ? 'Parabéns!' : 'Nenhuma ainda';
  $('metasVazio').hidden = lista.length > 0;
  $('metasVazio').textContent = 'Nenhuma meta ainda. Toque num modelo acima (Viagem, Reserva de emergência…) ou em "Nova meta".';
  const shared = isShared();
  $('metasGrid').innerHTML = lista.map(({ m, i }) => {
    const sub = [m.prazo ? `até ${mesCurto(m.prazo)}` : 'sem prazo', shared && m.criado_por ? `criada por ${esc(quem(m.criado_por))}` : ''].filter(Boolean).join(' · ');
    const dica = i.done ? '<b>Concluída ✓</b>'
      : i.meses !== null && i.meses <= 0 ? '<span style="color:#ff8a8d">Prazo passou</span>'
      : i.porMes ? `Guarde <b>${brl(i.porMes)}/mês</b>`
      : i.chegaEm ? `No ritmo atual: ${mesCurto(i.chegaEm)}` : 'Comece guardando';
    return `
    <div class="meta${i.done ? ' done' : ''}" data-meta="${esc(m.id)}">
      <div class="meta-top">
        <span class="meta-ic">${esc(m.icone)}</span>
        <div style="min-width:0;"><div style="font-weight:700;" class="ellip">${esc(m.nome)}</div><div class="by" style="margin:0;">${sub}</div></div>
      </div>
      <div class="meta-vals"><b>${brl(i.saldo)}</b> <span style="color:var(--muted);font-size:13px;white-space:nowrap;">de ${brl(i.alvo)}</span></div>
      <div class="prog big"><div style="width:${i.pct}%"></div></div>
      <div class="meta-foot"><span class="meta-pct">${Math.floor(i.pct)}%</span><span>${i.done ? '<b class="ok">Concluída ✓</b>' : `Faltam <b>${brl(i.falta)}</b>`}</span></div>
      ${i.done ? '' : `<div class="meta-dica">${dica}</div>`}
      <div class="meta-acts">
        ${i.done ? '' : `<button class="btn btn-primary btn-sm" type="button" data-mguardar="${esc(m.id)}">Guardar</button>`}
        ${i.saldo > 0 ? `<button class="btn btn-secondary btn-sm" type="button" data-mretirar="${esc(m.id)}">Retirar</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

$('metaNova').onclick = () => openMetaForm(null, null);
$('metaModelos').addEventListener('click', e => {
  const b = e.target.closest('[data-modelo]'); if (!b) return;
  if (!state.metasOk) return toast('Rode o arquivo supabase-metas.sql no Supabase para ativar as metas.');
  openMetaForm(null, MODELOS_META[Number(b.dataset.modelo)]);
});
$('metasGrid').addEventListener('click', e => {
  const g = e.target.closest('[data-mguardar]'); if (g) return openMetaMov(g.dataset.mguardar, 'guardar');
  const r = e.target.closest('[data-mretirar]'); if (r) return openMetaMov(r.dataset.mretirar, 'retirar');
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
        <input class="input" id="mfNome" maxlength="60" autocomplete="off" placeholder="Ex.: Viagem pra Gramado" value="${esc(m ? m.nome : (modelo ? modelo.nome : ''))}">
      </div>
      <div class="grid2">
        <div class="field">
          <label for="mfAlvo">Objetivo (R$)</label>
          <input class="input" id="mfAlvo" inputmode="decimal" placeholder="0,00" value="${m ? num(Number(m.alvo)) : ''}">
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
      ${g ? `<div class="kv"><span>Falta</span><b style="color:var(--accent);">${brl(i.falta)}</b></div>` : ''}
    </div>
    <div class="field">
      <label for="mmValor">${g ? 'Quanto você está guardando (R$)' : 'Quanto vai retirar (R$)'}</label>
      <input class="input" id="mmValor" inputmode="decimal" value="${sugere > 0 ? num(sugere) : ''}" placeholder="0,00">
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

function openMeta(id){
  const m = findMeta(id); if (!m) return closeDlg2();
  const i = infoMeta(m);
  const mine = m.criado_por === myId();
  const pessoas = Object.entries(i.porPessoa).filter(([, v]) => v !== 0);
  openDlg2(`Meta · ${m.icone}`, m.nome, `
    <div class="dlg-sec">
      <div class="meta-vals"><b>${brl(i.saldo)}</b> <span style="color:var(--muted);">de ${brl(i.alvo)} · ${Math.floor(i.pct)}%</span></div>
      <div class="prog big"><div style="width:${i.pct}%"></div></div>
      ${i.done ? '<div class="kv"><span>Situação</span><b style="color:var(--accent);">Concluída ✓</b></div>' : `<div class="kv"><span>Falta</span><b>${brl(i.falta)}</b></div>`}
      <div class="kv"><span>Prazo</span><b>${m.prazo ? MONTHS[Number(m.prazo.slice(5,7)) - 1] + ' ' + m.prazo.slice(0, 4) : 'Sem prazo'}</b></div>
      ${!i.done && i.porMes ? `<div class="kv"><span>Para chegar no prazo</span><b>${brl(i.porMes)}/mês</b></div>` : ''}
      ${!i.done && i.ritmo > 0 ? `<div class="kv"><span>Seu ritmo</span><b>${brl(i.ritmo)}/mês${i.chegaEm ? ` · chega em ${mesCurto(i.chegaEm)}` : ''}</b></div>` : ''}
    </div>
    ${isShared() && pessoas.length ? `<div class="dlg-sec"><h3>Quem guardou</h3>${pessoas.map(([u, v]) => `<div class="person"><span>${esc(quem(u))}</span><b>${brl(v)}</b></div>`).join('')}</div>` : ''}
    <div class="dlg-sec">
      <h3>Histórico</h3>
      ${i.movs.length ? i.movs.slice().reverse().map(x => {
        const d = x.data.split('-');
        return `<div class="person"><span>${d[2]}/${d[1]} · ${esc(quem(x.user_id))} · <b style="color:${x.tipo === 'guardar' ? 'var(--accent)' : '#ff8a8d'};">${x.tipo === 'guardar' ? '+' : '−'} ${brl(Number(x.valor))}</b></span>
          ${x.user_id === myId() ? `<button class="btn btn-secondary btn-sm" type="button" data-act="mmDesfazer" data-id="${esc(x.id)}">Desfazer</button>` : ''}</div>`;
      }).join('') : '<p class="hint">Nada guardado ainda.</p>'}
    </div>
    <div class="row" style="flex-wrap:wrap;">
      ${i.done ? '' : '<button class="btn btn-primary" type="button" data-act="mmGuardar">Guardar</button>'}
      ${i.saldo > 0 ? '<button class="btn btn-secondary" type="button" data-act="mmRetirar">Retirar</button>' : ''}
      ${mine ? '<button class="btn btn-secondary" type="button" data-act="mmEditar">Editar</button>' : ''}
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
    toast(!antes && depois ? `Meta "${m.nome}" alcançada!` : mov === 'retirar' ? 'Retirada registrada.' : `${brl(v)} guardados.`, true);
    return;
  }
  if (!m) return closeDlg2();
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
    $('invVazio').textContent = 'Os investimentos ainda não foram ativados no banco. Rode o arquivo supabase-investimentos.sql no SQL Editor do Supabase e recarregue a página.';
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
  const PH = { poupanca: 'Ex.: Poupança Caixa', cdb: 'Ex.: CDB Banco X', lci: 'Ex.: LCI Banco Y', lca: 'Ex.: LCA Banco Z', tesouro_selic: 'Ex.: Tesouro Selic 2029', tesouro_ipca: 'Ex.: Tesouro IPCA+ 2035', tesouro_pre: 'Ex.: Tesouro Prefixado 2031', outro: 'Ex.: Previdência, cripto…' };
  openDlg2(T ? 'Novo investimento' : 'Investimentos', T ? `${T.ic} ${T.nome}` : 'Qual o tipo?', `
    <div class="tipo-grid" id="ifTipos">${Object.entries(TIPOS_INV).map(([k, t]) => `<button type="button" data-tipo="${k}" aria-pressed="${k === tipo}"><span>${t.ic}</span>${t.nome}</button>`).join('')}</div>
    ${!T ? '<p class="hint">Escolha o tipo para continuar.</p>' : `
    <form id="invForm" novalidate style="display:flex;flex-direction:column;gap:var(--space-4);">
      ${ix === 'cotacao' ? `
      <div class="grid2">
        <div class="field"><label for="ifTicker">Código</label><input class="input" id="ifTicker" maxlength="7" autocapitalize="characters" placeholder="${tipo === 'fii' ? 'Ex.: MXRF11' : 'Ex.: PETR4'}"></div>
        <div class="field"><label for="ifNome">Nome</label><input class="input" id="ifNome" maxlength="60" placeholder="${tipo === 'fii' ? 'Ex.: Maxi Renda' : 'Ex.: Petrobras'}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="ifQtd">Quantidade</label><input class="input" id="ifQtd" inputmode="decimal" placeholder="Ex.: 10"></div>
        <div class="field"><label for="ifPreco">Preço pago (R$ por unidade)</label><input class="input" id="ifPreco" inputmode="decimal" placeholder="0,00"></div>
      </div>
      <div class="field"><label for="ifCot">Cotação de hoje (R$) <span style="color:var(--muted);font-weight:400;">(opcional)</span></label><input class="input" id="ifCot" inputmode="decimal" placeholder="0,00"></div>
      <p class="hint" style="margin:-6px 0 0;">Por enquanto a cotação é informada por você. A atualização automática pela bolsa vem numa próxima versão.</p>` : `
      <div class="field"><label for="ifNome">Nome</label><input class="input" id="ifNome" maxlength="60" placeholder="${PH[tipo] || ''}" value="${tipo === 'poupanca' ? 'Poupança' : ''}"></div>`}
      ${idxs.length > 1 ? `
      <div class="field"><label for="ifIdx">Como rende</label>
        <select class="input" id="ifIdx">${idxs.map(x => `<option value="${x}">${IDX_LABEL[x]}</option>`).join('')}</select></div>` : ''}
      ${rf && ix !== 'poupanca' ? `
      <div class="grid2">
        <div class="field"><label for="ifTaxa" id="ifTaxaLbl">${ix === 'selic' ? 'Extra além da Selic (% a.a.)' : IDX_LABEL[ix]}</label>
          <input class="input" id="ifTaxa" inputmode="decimal" placeholder="${ix === 'cdi' ? 'Ex.: 110' : ix === 'selic' ? 'Ex.: 0,05' : 'Ex.: 12'}" value="${ix === 'selic' ? '0' : ''}"></div>
        <div class="field"><label for="ifVenc">Vencimento <span style="color:var(--muted);font-weight:400;">(opcional)</span></label><input class="input" id="ifVenc" type="date"></div>
      </div>
      ${ix === 'selic' ? '<p class="hint" style="margin:-6px 0 0;">A Selic o app já busca sozinho no Banco Central. Aqui vai só o extra que aparece na compra (ex.: Selic + 0,05%). Se não souber, deixe 0.</p>' : ''}` : ''}
      ${ix !== 'cotacao' ? `
      <div class="grid2">
        <div class="field"><label for="ifValor">Valor aplicado (R$)</label><input class="input" id="ifValor" inputmode="decimal" placeholder="0,00"></div>
        <div class="field"><label for="ifData">Data da aplicação</label><input class="input" id="ifData" type="date" value="${todayISO()}"></div>
      </div>` : `
      <div class="field"><label for="ifData">Data da compra</label><input class="input" id="ifData" type="date" value="${todayISO()}"></div>`}
      ${ix === 'manual' ? `<div class="field"><label for="ifAtual">Quanto vale hoje (R$) <span style="color:var(--muted);font-weight:400;">(opcional)</span></label><input class="input" id="ifAtual" inputmode="decimal" placeholder="0,00"></div>` : ''}
      <label class="chk"><input type="checkbox" id="ifLancar"> Lançar também como saída em Lançamentos</label>
      <button class="btn btn-primary" type="submit" id="ifSalvar" style="min-height:44px;">Adicionar investimento</button>
    </form>`}`, { tipo: 'invForm', invTipo: tipo });
  if ($('ifIdx')) $('ifIdx').onchange = () => { const v = $('ifIdx').value; $('ifTaxaLbl').textContent = IDX_LABEL[v]; $('ifTaxa').placeholder = v === 'cdi' ? 'Ex.: 110' : 'Ex.: 12'; };
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
      <div class="field"><label for="imQtd">Quantidade</label><input class="input" id="imQtd" inputmode="decimal" placeholder="Ex.: 10"></div>
      <div class="field"><label for="imPreco">Preço por unidade (R$)</label><input class="input" id="imPreco" inputmode="decimal" placeholder="0,00" value="${inv.cotacao ? num(Number(inv.cotacao)) : ''}"></div>
    </div>` : `
    <div class="field"><label for="imValor">${tipo === 'saldo' ? 'Quanto vale hoje (R$)' : 'Valor (R$)'}</label><input class="input" id="imValor" inputmode="decimal" placeholder="0,00"></div>`}
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
    const v = prompt(`Cotação de hoje de ${inv.ticker || inv.nome} (R$ por unidade):`, inv.cotacao ? num(Number(inv.cotacao)) : '');
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

/* ======================= O QUE O CONTROLE COMPARTILHA ======================= */
const MODULOS = [
  { k: 'lanc', nome: 'Gastos (lançamentos)' },
  { k: 'contas', nome: 'Contas a pagar' },
  { k: 'metas', nome: 'Metas' },
  { k: 'invest', nome: 'Investimentos' },
];
const modulosDe = c => !c || c.pessoal || !Array.isArray(c.modulos) ? ['lanc', 'contas', 'metas', 'invest'] : c.modulos;
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
function openMenu(){ renderMe(); $('drawer').hidden = false; }
function closeMenu(){ $('drawer').hidden = true; }
$('menuBtn').onclick = openMenu;
$('drClose').onclick = closeMenu;
$('drawer').addEventListener('click', e => { if (e.target.id === 'drawer' || e.target.closest('.drawer-item')) closeMenu(); });
$('drPerfil').addEventListener('click', () => openPerfil());

function lerFoto(file){
  return new Promise((resolve, reject) => {
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
    return openDlg2('Minha conta', 'Meu perfil', `<p class="hint">Para usar o perfil, rode o arquivo <b>supabase-perfil.sql</b> no SQL Editor do Supabase e recarregue a página.</p>`, { tipo: 'perfil' });
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
    </div>`, { tipo: 'perfil' });
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
  const b = e.target.closest('[data-act^="pf"]');
  if (!b) return;
  if (b.dataset.act === 'pfRemover'){
    const { error } = await sb.rpc('salvar_foto', { p_foto: null });
    if (error) return toast(rpcMsg(error));
    profile.foto = null; renderMe(); await loadMembers(); render(); openPerfil();
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
      <div class="row"><input class="input" id="dlgInvite" placeholder="Ex.: maria ou maria@gmail.com" autocapitalize="none" autocorrect="off" spellcheck="false"><button class="btn btn-primary" data-a="convidar">Convidar</button></div>
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
    <div class="dlg-sec" style="border-top:1px solid var(--divider);padding-top:14px;">
      <div class="row" style="flex-wrap:wrap;">
        <button class="btn btn-secondary" data-a="sair">Sair do controle</button>
        ${dono ? '<button class="btn btn-danger" data-a="excluir">Excluir controle</button>' : ''}
      </div>
      <p class="hint">Ao sair, os lançamentos que você fez continuam no controle.</p>
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
    if (res.error){ b.disabled = false; return toast(/function|schema cache/i.test(res.error.message || '') ? 'Rode o arquivo supabase-modulos.sql no Supabase para ativar essa opção.' : rpcMsg(res.error)); }
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
    if (c.codigo && !await confirmar('Gerar outro código? O código atual deixa de funcionar.')) return;
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
    catch(err){ prompt('Copie a mensagem abaixo:', texto); }
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
$('export').onclick = async () => {
  if (!window.XLSX){ alert('Não foi possível gerar a planilha. Verifique a conexão e tente de novo.'); return; }
  const c = current(); if (!c) return;
  $('export').disabled = true;
  const entries = await fetchAllEntries();
  $('export').disabled = false;
  if (!entries) return toast('Não foi possível buscar os lançamentos.');
  const shared = !c.pessoal;
  const money = '"R$" #,##0.00;-"R$" #,##0.00';
  const wb = XLSX.utils.book_new();
  const fmtCol = (ws, cols) => {
    const r = XLSX.utils.decode_range(ws['!ref']);
    for (let row = 1; row <= r.e.r; row++) cols.forEach(col => { const cell = ws[XLSX.utils.encode_cell({r:row,c:col})]; if (cell && cell.t === 'n') cell.z = money; });
  };
  const all = entries.map(e => {
    const row = {
      'Data': e.date.split('-').reverse().join('/'),
      'Tipo': e.type === 'inc' ? 'Entrada' : 'Saída',
      'Descrição': e.desc, 'Categoria': e.cat,
      'Valor': e.type === 'inc' ? e.amount : -e.amount
    };
    if (shared) row['Quem lançou'] = nameOf(e.uid);
    return row;
  });
  const ws1 = XLSX.utils.json_to_sheet(all.length ? all : [{Data:'',Tipo:'',Descrição:'',Categoria:'',Valor:''}]);
  ws1['!cols'] = [{wch:12},{wch:10},{wch:34},{wch:16},{wch:14},{wch:18}];
  fmtCol(ws1,[4]);
  XLSX.utils.book_append_sheet(wb, ws1, 'Lançamentos');

  const byMonth = {};
  entries.forEach(e => { const k = e.date.slice(0,7); byMonth[k] = byMonth[k] || {inc:0,exp:0}; byMonth[k][e.type] += e.amount; });
  const months = Object.keys(byMonth).sort().map(k => {
    const [y,m] = k.split('-').map(Number), v = byMonth[k];
    return {'Mês': `${MONTHS[m-1]} ${y}`, 'Entradas': v.inc, 'Saídas': v.exp, 'Saldo': v.inc - v.exp};
  });
  if (months.length){
    const ws2 = XLSX.utils.json_to_sheet(months);
    ws2['!cols'] = [{wch:18},{wch:14},{wch:14},{wch:14}];
    fmtCol(ws2,[1,2,3]);
    XLSX.utils.book_append_sheet(wb, ws2, 'Resumo por mês');
  }
  const slug = c.nome.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'controle';
  XLSX.writeFile(wb, `pra-onde-foi-${slug}.xlsx`);
};

/* ======================= ADMINISTRAÇÃO ======================= */
let users = [], adminFilter = 'pendente';
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
}

function renderAdmin(){
  const count = s => users.filter(u => u.status === s).length;
  $('cntPend').textContent = count('pendente');
  $('cntOk').textContent = count('aprovado');
  $('cntBlock').textContent = count('bloqueado');
  document.querySelectorAll('#adminSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === adminFilter)));

  const list = adminFilter === 'todos' ? users : users.filter(u => u.status === adminFilter);
  $('usersEmpty').hidden = list.length > 0;
  $('usersTable').hidden = list.length === 0;
  $('usersEmpty').textContent = adminFilter === 'pendente' ? 'Ninguém aguardando aprovação.' : 'Ninguém por aqui.';
  $('userRows').innerHTML = list.map(u => {
    const me = currentUser && u.id === currentUser.id;
    let actions = '';
    if (me) actions = '<span style="font-size:13px;color:var(--muted);">Você · conta master</span>';
    else {
      if (u.status !== 'aprovado') actions += `<button class="btn btn-primary btn-sm" data-act="aprovado" data-id="${esc(u.id)}">${u.status === 'bloqueado' ? 'Desbloquear' : 'Aprovar'}</button>`;
      if (u.status !== 'bloqueado') actions += `<button class="btn btn-secondary btn-sm" data-act="bloqueado" data-id="${esc(u.id)}">${u.status === 'pendente' ? 'Recusar' : 'Bloquear'}</button>`;
      actions += `<button class="btn btn-secondary btn-sm" data-act="senha" data-id="${esc(u.id)}" data-email="${esc(displayName(u.email))}">Nova senha</button>`;
      actions += `<button class="btn btn-danger btn-sm" data-act="excluir" data-id="${esc(u.id)}" data-email="${esc(displayName(u.email))}">Excluir</button>`;
    }
    return `<tr>
      <td style="word-break:break-all;">${esc(displayName(u.email))}${u.nome ? `<div class="by">${esc(u.nome)}</div>` : ''}</td>
      <td style="color:var(--muted);">${new Date(u.criado_em).toLocaleDateString('pt-BR')}</td>
      <td>${me ? '<span class="tag tag-accent">Admin</span>' : STATUS_TAG[u.status]}</td>
      <td><div style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;">${actions}</div></td>
    </tr>`;
  }).join('');
}

$('adminRefresh').onclick = () => loadUsers();
document.querySelectorAll('#adminSeg button').forEach(b => b.addEventListener('click', () => { adminFilter = b.dataset.filter; renderAdmin(); }));

$('userRows').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.dataset.id, act = b.dataset.act;
  let error;
  if (act === 'senha'){
    const nova = prompt(`Senha temporária para ${b.dataset.email} (mínimo de 8 caracteres):`);
    if (nova === null) return;
    if (nova.length < 8) return toast('A senha precisa ter pelo menos 8 caracteres.');
    b.disabled = true;
    ({ error } = await sb.rpc('admin_definir_senha', { alvo: id, nova }));
    b.disabled = false;
    if (error) return toast('Não foi possível concluir: ' + error.message);
    alert(`Senha de ${b.dataset.email} redefinida.\n\nPasse a senha temporária para a pessoa e peça que ela troque em "Trocar senha" assim que entrar.`);
    return;
  }
  if (act === 'excluir'){
    if (!await confirmar(`Excluir a conta ${b.dataset.email}?\n\nA pessoa perde o acesso e o "Meu controle" dela é apagado. Nos controles compartilhados, os lançamentos que ela fez continuam lá. Não dá para desfazer.`)) return;
    b.disabled = true;
    ({ error } = await sb.rpc('admin_excluir_usuario', { alvo: id }));
  } else {
    b.disabled = true;
    ({ error } = await sb.rpc('admin_mudar_status', { alvo: id, novo: act }));
  }
  if (error){ b.disabled = false; return toast('Não foi possível concluir: ' + error.message); }
  await loadUsers();
});

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
    if (recovering || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
    // setTimeout evita travar o Supabase ao fazer consultas dentro deste aviso
    setTimeout(() => handleSession(session, event === 'SIGNED_OUT'), 0);
  });
}

// ícones desenhados são só enfeite: o leitor de tela lê o texto do botão
document.querySelectorAll('svg:not([aria-hidden])').forEach(s => s.setAttribute('aria-hidden', 'true'));
