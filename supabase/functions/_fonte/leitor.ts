// =====================================================================
//  Pra Onde Foi? · LEITOR (função do Supabase · gerada por _fonte/montar.py)
//  O app manda uma foto, print, PDF ou áudio; a IA (Gemini) lê e devolve os
//  lançamentos para a pessoa CONFERIR no app. Nada é salvo aqui e o arquivo
//  não é guardado.
//
//  Segredos (Supabase → Edge Functions → Secrets), colados por você:
//    GEMINI_KEY      chave do Google AI Studio (com faturamento ativo)
//    GEMINI_MODELO   opcional (padrão gemini-2.5-flash-lite)
//    GEMINI_RESERVA  opcional (padrão gemini-2.5-flash)
//    APP_ORIGENS     opcional: endereços do app separados por vírgula
//                    (padrão https://praondefoiapp.com.br)
//  Deixe "Verify JWT" LIGADO nesta função (só quem está logado usa).
// =====================================================================

%%NUCLEO%%
// ------------------------------------------------------------------ servidor do leitor

const origens = () => (env('APP_ORIGENS') || 'https://praondefoiapp.com.br').split(',').map(x => x.trim()).filter(Boolean);
function cors(req: Request) {
  const o = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': origens().includes(o) ? o : origens()[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
const resposta = (req: Request, corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

// quem está chamando (pelo login do app)
async function usuario(req: Request): Promise<string | null> {
  const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tok) return null;
  const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${tok}` } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u?.id || null;
}

const lista = (x: unknown, padrao: string[]) => {
  const l = Array.isArray(x) ? x.filter(v => typeof v === 'string').map(v => v.trim().slice(0, 40)).filter(Boolean).slice(0, 60) : [];
  return [...new Set([...padrao, ...l])];
};

const Deno_ = (globalThis as any).Deno;
if (Deno_?.serve) Deno_.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return resposta(req, { erro: 'metodo' }, 405);
  if (origens().length && req.headers.get('origin') && !origens().includes(req.headers.get('origin')!)) return resposta(req, { erro: 'origem' }, 403);

  const uid = await usuario(req);
  if (!uid) return resposta(req, { erro: 'login' }, 401);
  if (!env('GEMINI_KEY')) return resposta(req, { erro: 'sem_ia' }, 503);

  let corpo: any;
  try { corpo = await req.json(); } catch { return resposta(req, { erro: 'dados' }, 400); }
  const mime = String(corpo?.mime || '').toLowerCase().split(';')[0];
  const dados = String(corpo?.dados || '');
  if (!IA_TIPOS[mime]) return resposta(req, { erro: 'tipo' }, 400);
  if (!dados || dados.length > Math.ceil(IA_MAX_BYTES * 4 / 3) + 8) return resposta(req, { erro: 'tamanho' }, 413);
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(dados), ch => ch.charCodeAt(0)); } catch { return resposta(req, { erro: 'dados' }, 400); }
  const hoje = /^\d{4}-\d{2}-\d{2}$/.test(String(corpo?.hoje)) ? String(corpo.hoje) : hojeEm('America/Sao_Paulo');
  const cats = { exp: lista(corpo?.cats?.exp, CATS_PADRAO.exp), inc: lista(corpo?.cats?.inc, CATS_PADRAO.inc) };

  const s = await rpc('ia_consumir', { p_uid: uid }).catch(() => null);
  if (!s) return resposta(req, { erro: 'falhou' }, 500);
  if (s.erro) return resposta(req, s, s.erro === 'sem_saldo' ? 429 : 403);

  try {
    const { itens, modelo } = await lerComIA(bytes, mime, hoje, cats);
    if (!itens.length) await rpc('ia_devolver', { p_uid: uid }).catch(() => {});   // não leu nada: não gasta o saldo
    return resposta(req, { itens, restam: itens.length ? s.restam : s.restam + 1, limite: s.limite, modelo });
  } catch (err) {
    console.error('leitor', String(err));
    await rpc('ia_devolver', { p_uid: uid }).catch(() => {});
    return resposta(req, { erro: 'falhou' }, 502);
  }
});
