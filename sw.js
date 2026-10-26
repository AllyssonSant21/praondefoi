// Pra Onde Foi? — service worker
// Guarda a "casca" do app para abrir rápido e com internet ruim.
// Os dados financeiros (Supabase) NUNCA ficam em cache: sempre vêm do servidor.
const VERSAO = 'pof-v7';
const ARQUIVOS = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k !== VERSAO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return;   // dados e login: sempre direto do servidor

  // Páginas e arquivos do app: tenta a internet primeiro (pega atualizações), cai no cache se estiver offline
  if (url.origin === location.origin){
    e.respondWith(
      fetch(req).then(res => {
        const copia = res.clone();
        caches.open(VERSAO).then(c => c.put(req, copia));
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Fontes e bibliotecas externas: usa o cache e atualiza em segundo plano
  e.respondWith(
    caches.match(req).then(emCache => {
      const rede = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')){
          const copia = res.clone();
          caches.open(VERSAO).then(c => c.put(req, copia));
        }
        return res;
      }).catch(() => emCache);
      return emCache || rede;
    })
  );
});
