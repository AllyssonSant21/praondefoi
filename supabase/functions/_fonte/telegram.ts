// =====================================================================
//  Pra Onde Foi? · BOT DO TELEGRAM (função do Supabase · gerada por _fonte/montar.py)
//  Recebe as mensagens do Telegram, entende o texto e lança no app.
//
//  Segredos (Supabase → Edge Functions → Secrets), colados por você:
//    TG_TOKEN    token que o @BotFather te deu
//    TG_SECRET   uma senha que você inventa (só letras, números, _ e -; mínimo 20)
//    BOT_FUSO    opcional: fuso do "hoje" (padrão America/Sao_Paulo; Cuiabá: America/Cuiaba)
//  SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY o Supabase já coloca sozinho.
//  Importante: desligue "Verify JWT" nesta função (o Telegram não manda login).
//
//  Para ligar o Telegram a esta função, abra UMA vez no navegador:
//    https://SEU-PROJETO.supabase.co/functions/v1/telegram-bot?configurar=SEU_TG_SECRET
// =====================================================================

%%NUCLEO%%
// ------------------------------------------------------------------ Telegram

const TG_API = () => `${env('TG_API') || 'https://api.telegram.org'}/bot${env('TG_TOKEN')}`;

// o texto do bot usa *negrito* (estilo WhatsApp); no Telegram vira HTML, que não quebra com _ ou * soltos
export const paraHtml = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
   .replace(/(^|\n)_([^_\n]+)_(?=\n|$)/g, '$1<i>$2</i>');   // linha inteira em _itálico_

async function enviarTg(chat: number, texto: string) {
  const r = await fetch(`${TG_API()}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: paraHtml(texto), parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!r.ok) console.error('envio falhou', r.status, (await r.text()).slice(0, 300));
}

// foto, PDF, áudio de voz ou arquivo de áudio: o bot baixa só quando for ler
function arquivoTg(m: any): Canal['arquivo'] {
  let f: any = null, mime = '';
  if (Array.isArray(m.photo) && m.photo.length) {
    const fotos = m.photo.filter((p: any) => !p.file_size || p.file_size <= IA_MAX_BYTES);
    f = fotos[fotos.length - 1] || m.photo[0]; mime = 'image/jpeg';
  } else if (m.document) { f = m.document; mime = String(m.document.mime_type || '').toLowerCase(); }
  else if (m.voice) { f = m.voice; mime = String(m.voice.mime_type || 'audio/ogg').toLowerCase(); }
  else if (m.audio) { f = m.audio; mime = String(m.audio.mime_type || 'audio/mpeg').toLowerCase(); }
  if (!f?.file_id) return undefined;
  return {
    mime, tamanho: Number(f.file_size || 0),
    baixar: async () => {
      const r = await fetch(`${TG_API()}/getFile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: f.file_id }) });
      const j = await r.json();
      if (!j?.ok || !j.result?.file_path) throw new Error('getFile falhou');
      const arq = await fetch(`${env('TG_API') || 'https://api.telegram.org'}/file/bot${env('TG_TOKEN')}/${j.result.file_path}`);
      if (!arq.ok) throw new Error('download falhou ' + arq.status);
      const b = new Uint8Array(await arq.arrayBuffer());
      if (b.length > IA_MAX_BYTES) throw new Error('grande demais');
      return b;
    },
  };
}

const igual = (a: string, b: string) => {
  if (!a || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

// ------------------------------------------------------------------ servidor

const Deno_ = (globalThis as any).Deno;
if (Deno_?.serve) Deno_.serve(async (req: Request) => {
  const url = new URL(req.url);
  const segredo = env('TG_SECRET');

  // 1) configuração (uma vez): avisa o Telegram para mandar as mensagens para esta função
  if (req.method === 'GET') {
    if (!segredo || !igual(url.searchParams.get('configurar') || '', segredo)) return new Response('forbidden', { status: 403 });
    const base = env('TG_PUBLIC_URL') || `${env('SUPABASE_URL')}/functions/v1/telegram-bot`;
    const r = await fetch(`${TG_API()}/setWebhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: base, secret_token: segredo, allowed_updates: ['message'], drop_pending_updates: true }),
    });
    const j = await r.json().catch(() => ({}));
    await fetch(`${TG_API()}/setMyCommands`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: [
        { command: 'ajuda', description: 'Como usar o bot' },
        { command: 'resumo', description: 'Resumo do mês' },
        { command: 'desfazer', description: 'Apagar o último lançamento' },
      ] }),
    }).catch(() => {});
    return new Response(j.ok ? '✅ Telegram ligado a esta função. Pode mandar mensagem para o bot.' : `❌ Não deu: ${j.description || r.status}`,
      { status: j.ok ? 200 : 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
  if (req.method !== 'POST') return new Response('ok');

  // 2) mensagens: só aceita o que veio do Telegram (ele manda o segredo no cabeçalho)
  if (!segredo || !igual(req.headers.get('x-telegram-bot-api-secret-token') || '', segredo)) return new Response('forbidden', { status: 401 });

  try {
    const u = await req.json();
    const m = u.message;
    if (m && m.chat?.type === 'private' && m.from && !m.from.is_bot) {
      const chat = Number(m.chat.id);
      await tratar({ nome: 'Telegram', id: 'tg' + String(m.from.id), msgId: 'tg' + String(u.update_id),
                     fuso: env('BOT_FUSO') || 'America/Sao_Paulo', enviadaEm: Number(m.date),
                     texto: typeof m.text === 'string' ? m.text : null,
                     arquivo: typeof m.text === 'string' ? undefined : arquivoTg(m),
                     enviar: (t: string) => enviarTg(chat, t) });
    }
  } catch (err) { console.error('webhook', err); }
  return new Response('ok');   // sempre 200, senão o Telegram fica reenviando
});
