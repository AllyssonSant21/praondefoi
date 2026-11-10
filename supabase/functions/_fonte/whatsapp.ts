// =====================================================================
//  Pra Onde Foi? · BOT DO WHATSAPP (função do Supabase · gerada por _fonte/montar.py)
//  Recebe as mensagens da Meta, entende o texto e lança no app.
//
//  Segredos (Supabase → Edge Functions → Secrets), colados por você:
//    WA_TOKEN        token da Meta (WhatsApp → Configuração da API)
//    WA_PHONE_ID     ID do número de telefone (mesma tela)
//    WA_VERIFY       uma senha que você inventa (vai igual no webhook da Meta)
//    WA_APP_SECRET   chave secreta do app (Configurações do app → Básico)
//  SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY o Supabase já coloca sozinho.
//  Importante: desligue "Verify JWT" nesta função (a Meta não manda login).
// =====================================================================

const GRAPH_PADRAO = 'https://graph.facebook.com/v23.0';

%%NUCLEO%%
// ------------------------------------------------------------------ Meta

async function enviarWa(para: string, texto: string) {
  const mandar = (to: string) => fetch(`${env('WA_GRAPH') || GRAPH_PADRAO}/${env('WA_PHONE_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WA_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: texto, preview_url: false } }),
  });
  let r = await mandar(para);
  // número do Brasil às vezes chega sem o 9 (55 65 8xxx-xxxx); no modo de teste a Meta só aceita com o 9
  if (!r.ok && para.startsWith('55') && para.length === 12) {
    const corpo = await r.text();
    if (/131030|not in allowed list/i.test(corpo)) r = await mandar(para.slice(0, 4) + '9' + para.slice(4));
    else console.error('envio', corpo.slice(0, 300));
  }
  if (!r.ok) console.error('envio falhou', r.status, (await r.text()).slice(0, 300));
}

async function assinaturaOk(corpo: string, cabecalho: string | null): Promise<boolean> {
  const segredo = env('WA_APP_SECRET');
  if (!segredo || !cabecalho?.startsWith('sha256=')) return false;
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(corpo)));
  const hex = Array.from(sig, b => b.toString(16).padStart(2, '0')).join('');
  const recebido = cabecalho.slice(7);
  if (hex.length !== recebido.length) return false;
  let dif = 0; for (let i = 0; i < hex.length; i++) dif |= hex.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

// ------------------------------------------------------------------ servidor

const Deno_ = (globalThis as any).Deno;
if (Deno_?.serve) Deno_.serve(async (req: Request) => {
  const url = new URL(req.url);

  // 1) a Meta confere o endereço uma vez (botão "Verificar e salvar")
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && env('WA_VERIFY') &&
               url.searchParams.get('hub.verify_token') === env('WA_VERIFY');
    return ok ? new Response(url.searchParams.get('hub.challenge') || '', { status: 200 })
              : new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('ok');

  // 2) mensagens: só aceita o que veio assinado pela Meta
  const corpo = await req.text();
  if (!(await assinaturaOk(corpo, req.headers.get('x-hub-signature-256')))) return new Response('assinatura', { status: 401 });

  try {
    const dados = JSON.parse(corpo);
    for (const e of dados.entry || []) for (const c of e.changes || []) {
      if (c.field !== 'messages') continue;
      for (const m of c.value?.messages || []) {
        const wa = String(m.from || '');
        if (!/^\d{8,15}$/.test(wa)) continue;
        try {
          await tratar({ nome: 'WhatsApp', id: wa, msgId: String(m.id), fuso: fusoDoNumero(wa),
                         texto: m.type === 'text' ? String(m.text?.body || '') : null,
                         enviar: (t: string) => enviarWa(wa, t) });
        } catch (err) { console.error('mensagem', err); }
      }
    }
  } catch (err) { console.error('webhook', err); }
  return new Response('ok');   // sempre 200, senão a Meta fica reenviando
});
