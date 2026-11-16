// =====================================================================
//  Pra Onde Foi? · AVISO DE ACESSO (função do Supabase "aviso-login")
//  Quando a conta é aberta num aparelho novo, o app chama esta função e
//  ela manda um e-mail para a pessoa: "Novo acesso à sua conta".
//  Quem decide se o aparelho é novo é o banco (supabase-aparelhos.sql):
//  o e-mail só sai uma vez por aparelho, e só se o banco marcou "avisar".
//
//  Segredos (Supabase → Edge Functions → Secrets), colados por você:
//    RESEND_KEY        chave da Resend (resend.com → API Keys)
//    AVISO_REMETENTE   opcional (padrão "Pra Onde Foi? <avisos@praondefoiapp.com.br>")
//    APP_URL           opcional: endereço do app (padrão https://praondefoiapp.com.br/)
//                      no HMG: https://praondefoiapp.com.br/hmgbase/
//    APP_ORIGENS       opcional: endereços que podem chamar (padrão https://praondefoiapp.com.br)
//  Deixe "Verify JWT" LIGADO nesta função (só quem está logado chama).
// =====================================================================

const env = (k: string) => Deno.env.get(k) || '';
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
const esc = (t: string) => String(t || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

// quem está chamando (pelo login do app)
async function usuario(req: Request): Promise<string | null> {
  const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!tok) return null;
  const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${tok}` } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u?.id || null;
}

function emailHtml(d: { nome?: string; aparelho: string; quando: string }, app: string) {
  const oi = d.nome ? `Oi, ${esc(d.nome.split(' ')[0])}!` : 'Oi!';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Novo acesso à sua conta</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e3e5e9;border-radius:6px;">
      <tr><td style="padding:28px 28px 8px 28px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td><img src="https://praondefoiapp.com.br/icons/icon-192.png" width="44" height="44" alt="" style="display:block;border-radius:10px;"></td>
          <td style="padding-left:12px;font-size:17px;font-weight:bold;color:#16181d;line-height:1.1;">Pra onde<br>foi<span style="color:#b07a06;">?</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:16px 28px 0 28px;">
        <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.25;color:#16181d;">Novo acesso à sua conta</h1>
        <p style="margin:0 0 16px 0;font-size:15px;line-height:1.55;color:#3d424c;">${oi} Sua conta do Pra Onde Foi? foi aberta num aparelho que ainda não conhecíamos.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;border:1px solid #e3e5e9;border-radius:6px;">
          <tr><td style="padding:12px 16px;font-size:14px;color:#5e6470;width:90px;">Aparelho</td><td style="padding:12px 16px;font-size:14px;color:#16181d;font-weight:bold;">${esc(d.aparelho)}</td></tr>
          <tr><td style="padding:0 16px 12px 16px;font-size:14px;color:#5e6470;">Quando</td><td style="padding:0 16px 12px 16px;font-size:14px;color:#16181d;font-weight:bold;">${esc(d.quando)} (horário de Brasília)</td></tr>
        </table>
        <p style="margin:18px 0 6px 0;font-size:15px;line-height:1.55;color:#3d424c;"><b>Foi você?</b> Então está tudo certo, não precisa fazer nada.</p>
        <p style="margin:0 0 20px 0;font-size:15px;line-height:1.55;color:#3d424c;"><b>Não foi você?</b> Troque sua senha agora: abra o app, toque em <b>Esqueci a senha</b> na tela de entrar e crie uma nova.</p>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#ffc83d;border-radius:4px;">
          <a href="${esc(app)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:bold;color:#16181d;text-decoration:none;">Abrir o Pra Onde Foi?</a>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:22px 28px 26px 28px;">
        <p style="margin:0;padding-top:16px;border-top:1px solid #e3e5e9;font-size:12px;line-height:1.5;color:#8a8f99;">Mandamos este aviso uma vez por aparelho novo (ou navegador com os dados apagados).<br>O Pra Onde Foi? nunca pede senha do banco, CPF ou dados do cartão por e-mail.</p>
      </td></tr>
    </table>
    <p style="margin:14px 0 0 0;font-size:11px;color:#a0a5ae;font-family:Arial,Helvetica,sans-serif;">Pra Onde Foi? · praondefoiapp.com.br</p>
  </td></tr>
</table>
</body></html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return resposta(req, { erro: 'metodo' }, 405);
  const uid = await usuario(req);
  if (!uid) return resposta(req, { erro: 'login' }, 401);
  const corpo = await req.json().catch(() => ({}));
  const id = String(corpo?.aparelho || '');
  if (!/^[A-Za-z0-9-]{16,64}$/.test(id)) return resposta(req, { erro: 'aparelho' }, 400);

  // o banco confere se é mesmo um aparelho novo (e marca como avisado: só sai uma vez)
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/aparelho_aviso`, {
    method: 'POST',
    headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_uid: uid, p_id: id }),
  });
  if (!r.ok) { console.error('aparelho_aviso', r.status, (await r.text()).slice(0, 300)); return resposta(req, { erro: 'banco' }, 500); }
  const d = await r.json().catch(() => null);
  if (!d || !d.email) return resposta(req, { ok: true, enviado: false });
  if (!env('RESEND_KEY')) { console.error('falta o segredo RESEND_KEY'); return resposta(req, { ok: false, erro: 'sem_resend' }); }

  const app = env('APP_URL') || 'https://praondefoiapp.com.br/';
  const envio = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('AVISO_REMETENTE') || 'Pra Onde Foi? <avisos@praondefoiapp.com.br>',
      to: [d.email],
      subject: 'Novo acesso à sua conta · Pra Onde Foi?',
      html: emailHtml(d, app),
      text: `Sua conta do Pra Onde Foi? foi aberta num aparelho novo.\nAparelho: ${d.aparelho}\nQuando: ${d.quando} (horário de Brasília)\n\nFoi você? Não precisa fazer nada.\nNão foi você? Abra o app (${app}), toque em "Esqueci a senha" e crie uma nova.`,
    }),
  });
  if (!envio.ok) { console.error('resend', envio.status, (await envio.text()).slice(0, 300)); return resposta(req, { ok: false, erro: 'envio' }); }
  return resposta(req, { ok: true, enviado: true });
});
