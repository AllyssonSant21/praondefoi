// Pra Onde Foi? — service worker
// Guarda a "casca" do app para abrir rápido e com internet ruim.
// Os dados financeiros (Supabase) NUNCA ficam em cache: sempre vêm do servidor.
//
// Como cada arquivo é buscado:
//  · página (HTML): internet primeiro (pega a versão nova), cache se estiver sem internet;
//  · arquivos com versão no nome ou no endereço (app.js?v=N, vendor/supabase-2.117.3.js,
//    ícones, logo): do cache, sem baixar de novo — quando mudam, mudam de endereço;
//  · fontes do Google: do cache, atualizando em segundo plano.
// prod (/) e HMG (/hmgbase/) ficam no mesmo site: cada um com o seu cache, sem apagar o do outro
const ESCOPO = new URL(self.registration.scope).pathname;
const PREFIXO = 'pof' + ESCOPO;
const VERSAO = PREFIXO + 'v70';
const ARQUIVOS = ['./'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k !== VERSAO && (k.startsWith(PREFIXO) || (ESCOPO === '/' && /^pof-v\d+$/.test(k)))).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const guardar = (req, res) => {
  if (res && (res.ok || res.type === 'opaque')){
    const copia = res.clone();
    caches.open(VERSAO).then(c => c.put(req, copia));
  }
  return res;
};
const fixo = url => url.searchParams.has('v') || /\/(vendor|icons|logo)\//.test(url.pathname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return;   // dados e login: sempre direto do servidor

  if (url.origin === location.origin){
    if (fixo(url)){
      // arquivo com versão: o do cache serve (abre na hora)
      e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => guardar(req, res))));
      return;
    }
    // páginas e o resto: internet primeiro, cache se estiver sem internet
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).then(res => guardar(req, res))
        .catch(() => caches.match(req).then(r => r || caches.match('./')))
    );
    return;
  }

  // fontes e bibliotecas externas: usa o cache e atualiza em segundo plano
  e.respondWith(
    caches.match(req).then(emCache => {
      const rede = fetch(req).then(res => guardar(req, res)).catch(() => emCache);
      return emCache || rede;
    })
  );
});
