// Pra Onde Foi? — tema (claro ou escuro). Roda antes da página aparecer, para não piscar.
// aberto por http:// (sem cadeado)? vai para o https:// antes de mostrar qualquer coisa
if (location.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)){
  document.documentElement.style.visibility = 'hidden';
  location.replace('https://' + location.host + location.pathname + location.search + location.hash);
}
// o app não pode ser aberto dentro de outro site (proteção contra clique disfarçado)
if (window.top !== window.self){
  document.documentElement.style.visibility = 'hidden';
  try { window.top.location.replace(window.self.location.href); } catch(e){}
}
(function(){
  var KEY = 'pof-tema', mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function escolha(){ try { return localStorage.getItem(KEY) === 'escuro' ? 'escuro' : 'claro'; } catch(e){ return 'claro'; } }
  function aplicar(){
    var e = escolha(), t = e === 'auto' ? (mq && mq.matches ? 'escuro' : 'claro') : e;
    document.documentElement.setAttribute('data-tema', t);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'escuro' ? '#141414' : '#f5f6f8');
  }
  window.temaEscolhido = escolha;
  window.definirTema = function(e){ try { localStorage.setItem(KEY, e); } catch(err){} aplicar(); };
  if (mq && mq.addEventListener) mq.addEventListener('change', function(){ if (escolha() === 'auto') aplicar(); });
  aplicar();
})();
