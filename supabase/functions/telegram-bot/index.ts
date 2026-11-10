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

// ------------------------------------------------------------------ texto

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const brl = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;

// palavras → categoria (as categorias padrão do app)
const REGRAS_SAIDA: [string, string[]][] = [
  ['Mercado', ['mercado', 'supermercado', 'feira', 'atacadao', 'assai', 'padaria', 'acougue', 'hortifruti', 'sacolao', 'quitanda', 'mercearia', 'compras do mes']],
  ['Moradia', ['aluguel', 'condominio', 'iptu', 'reforma', 'movel', 'moveis', 'diarista', 'faxina', 'material de construcao']],
  ['Contas', ['luz', 'energia', 'agua', 'internet', 'telefone', 'celular', 'gas', 'boleto', 'netflix', 'spotify', 'assinatura', 'streaming', 'fatura', 'tv a cabo', 'conta de']],
  ['Transporte', ['uber', '99', 'gasolina', 'combustivel', 'etanol', 'alcool', 'posto', 'onibus', 'metro', 'estacionamento', 'pedagio', 'oficina', 'mecanico', 'ipva', 'taxi', 'passagem', 'moto', 'pneu', 'lava jato', 'seguro do carro']],
  ['Saúde', ['farmacia', 'remedio', 'medico', 'consulta', 'dentista', 'exame', 'plano de saude', 'hospital', 'academia', 'drogaria', 'psicologo', 'terapia']],
  ['Lazer', ['cinema', 'bar', 'cerveja', 'restaurante', 'lanche', 'ifood', 'pizza', 'hamburguer', 'show', 'viagem', 'passeio', 'jogo', 'balada', 'churrasco', 'sorvete', 'acai', 'cafe', 'delivery', 'role', 'presente']],
  ['Educação', ['escola', 'faculdade', 'curso', 'livro', 'material escolar', 'mensalidade', 'apostila', 'aula']],
];
const REGRAS_ENTRADA: [string, string[]][] = [
  ['Salário', ['salario', 'holerite', 'pagamento do mes', 'adiantamento', '13o', 'decimo terceiro', 'ferias']],
  ['Renda extra', ['freela', 'extra', 'vendi', 'venda', 'bico', 'comissao', 'reembolso', 'pix recebido', 'rendimento']],
];
const PALAVRAS_ENTRADA = ['recebi', 'ganhei', 'entrou', 'entrada', 'caiu', 'salario', 'vendi', 'freela', 'reembolso', 'renda', 'comissao', 'holerite', 'pix recebido'];
const PALAVRAS_SOLTAS = new Set(['gastei', 'paguei', 'comprei', 'compra', 'gasto', 'pagamento', 'recebi', 'ganhei', 'entrou', 'caiu', 'de', 'do', 'da', 'no', 'na', 'em', 'com', 'o', 'a', 'os', 'as', 'um', 'uma', 'pra', 'para', 'reais', 'real', 'conto', 'contos', 'pila', 'r$', 'hoje', 'ontem', 'anteontem', 'dia', 'foi', 'e']);

const temPalavra = (t: string, w: string) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(t);

// "1.234,56" / "23,90" / "23.90" / "1.500" / "50" / "2k" / "1,5 mil" → número
export function lerValor(s: string): number | null {
  let m = s.trim().toLowerCase().replace(/^r\$\s*/, '');
  let mult = 1;
  if (/\s*(mil|k)$/.test(m)) { mult = 1000; m = m.replace(/\s*(mil|k)$/, ''); }
  let n: number;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(m)) n = Number(m.replace(/\./g, '').replace(',', '.'));
  else if (/^\d+,\d{1,2}$/.test(m)) n = Number(m.replace(',', '.'));
  else if (/^\d+\.\d{1,2}$/.test(m)) n = Number(m);
  else if (/^\d+$/.test(m)) n = Number(m);
  else return null;
  n = Math.round(n * mult * 100) / 100;
  return n > 0 && n <= 9999999 ? n : null;
}

// fuso pelo DDD (Mato Grosso, MS, Rondônia, Amazonas, Roraima: -4; Acre: -5; resto: Brasília)
export function fusoDoNumero(wa: string): string {
  const ddd = wa.startsWith('55') ? wa.slice(2, 4) : '';
  if (['65', '66', '67', '69', '92', '95', '97'].includes(ddd)) return 'America/Cuiaba';
  if (ddd === '68') return 'America/Rio_Branco';
  return 'America/Sao_Paulo';
}
export function hojeEm(fuso: string, agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}
const somaDias = (iso: string, d: number) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
export const dataBonita = (iso: string, hoje: string) =>
  iso === hoje ? 'hoje' : iso === somaDias(hoje, -1) ? 'ontem' : `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export type Lanc = { tipo: 'exp' | 'inc'; valor: number; data: string; categoria: string; descricao: string };
export type Comando =
  | { tipo: 'ajuda' } | { tipo: 'desfazer' } | { tipo: 'desligar' }
  | { tipo: 'codigo'; codigo: string }
  | { tipo: 'resumo'; periodo: 'hoje' | 'ontem' | 'semana' | 'mes'; de: string; ate: string }
  | { tipo: 'lancar'; lanc: Lanc }
  | { tipo: 'nao_entendi' };

// entende a mensagem. cats = categorias próprias do controle (têm prioridade)
export function entender(texto: string, hoje: string, cats: { nome: string; tipo: string }[] = []): Comando {
  const t = norm(texto);
  if (!t) return { tipo: 'nao_entendi' };
  const cod = t.replace(/[\s.-]/g, '').match(/^(?:pof)?(\d{6})$/);
  if (cod) return { tipo: 'codigo', codigo: cod[1] };
  if (/^(ajuda|menu|oi|ola|opa|eai|e ai|bom dia|boa tarde|boa noite|comandos|help|\?|como funciona|como usa)[!?. ]*$/.test(t)) return { tipo: 'ajuda' };
  if (/^(desfazer|desfaz|apagar|apaga|cancelar|cancela|excluir|exclui|errei|apaga o ultimo|apagar o ultimo|desfazer o ultimo)[!. ]*$/.test(t)) return { tipo: 'desfazer' };
  if (/^(desligar|desconectar|sair|parar)[!. ]*$/.test(t)) return { tipo: 'desligar' };

  // perguntas de resumo (sem valor na frase)
  if (/(quanto|resumo|saldo|gastos?|total|extrato|como (estou|to|ta|esta))/.test(t) && !/\d/.test(t)) {
    const periodo = /ontem/.test(t) ? 'ontem' : /hoje|dia/.test(t) ? 'hoje' : /semana/.test(t) ? 'semana' : 'mes';
    if (periodo === 'hoje') return { tipo: 'resumo', periodo, de: hoje, ate: hoje };
    if (periodo === 'ontem') { const o = somaDias(hoje, -1); return { tipo: 'resumo', periodo, de: o, ate: o }; }
    if (periodo === 'semana') {
      const dow = (new Date(hoje + 'T12:00:00Z').getUTCDay() + 6) % 7;   // segunda = 0
      return { tipo: 'resumo', periodo, de: somaDias(hoje, -dow), ate: hoje };
    }
    return { tipo: 'resumo', periodo: 'mes', de: hoje.slice(0, 8) + '01', ate: hoje };
  }

  // data
  let resto = ' ' + t + ' ';
  let data = hoje;
  const dm = resto.match(/\s(?:dia\s)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s/);
  if (dm) {
    const ano = dm[3] ? (dm[3].length === 2 ? '20' + dm[3] : dm[3]) : hoje.slice(0, 4);
    const iso = `${ano}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
    const ok = !isNaN(new Date(iso + 'T12:00:00Z').getTime()) && new Date(iso + 'T12:00:00Z').toISOString().slice(0, 10) === iso;
    if (ok) { data = (!dm[3] && iso > hoje) ? `${Number(ano) - 1}${iso.slice(4)}` : iso; resto = resto.replace(dm[0], ' '); }
  } else if (/\santeontem\s/.test(resto)) { data = somaDias(hoje, -2); resto = resto.replace(/\santeontem\s/, ' '); }
  else if (/\sontem\s/.test(resto)) { data = somaDias(hoje, -1); resto = resto.replace(/\sontem\s/, ' '); }
  else {
    const dd = resto.match(/\sdia\s(\d{1,2})\s/);
    if (dd && Number(dd[1]) >= 1 && Number(dd[1]) <= 31) {
      let iso = hoje.slice(0, 8) + dd[1].padStart(2, '0');
      if (iso > hoje) { const m = new Date(hoje.slice(0, 8) + '01T12:00:00Z'); m.setUTCMonth(m.getUTCMonth() - 1); iso = m.toISOString().slice(0, 8) + dd[1].padStart(2, '0'); }
      if (new Date(iso + 'T12:00:00Z').toISOString().slice(0, 10) === iso) { data = iso; resto = resto.replace(dd[0], ' '); }
    }
  }

  // valor: prefere o que tem R$/reais/vírgula; senão o último número
  const rxNum = /(r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*(?:mil|k)(?![a-z]))?(\s*(?:reais|real|conto|contos|pila)(?![a-z]))?/g;
  const achados: { txt: string; valor: number; forte: boolean }[] = [];
  for (const m of resto.matchAll(rxNum)) {
    const v = lerValor((m[2] || '') + (m[3] || ''));
    if (v == null) continue;
    achados.push({ txt: m[0], valor: v, forte: !!(m[1] || m[4] || /,/.test(m[2]) || m[3]) });
  }
  if (!achados.length) return { tipo: 'nao_entendi' };
  const escolhido = achados.filter(a => a.forte).pop() || achados[achados.length - 1];
  resto = resto.replace(escolhido.txt, ' ');

  // entrada ou saída (olhando o texto sem o valor e sem a data)
  const base = resto.trim();
  const sinal = t.match(/^([+-])/);
  const tipo: 'exp' | 'inc' = sinal ? (sinal[1] === '+' ? 'inc' : 'exp') : PALAVRAS_ENTRADA.some(w => temPalavra(base, w)) ? 'inc' : 'exp';

  // categoria: as do controle primeiro, depois as regras
  let categoria = '';
  for (const c of cats) {
    if ((c.tipo === tipo || c.tipo === 'ambos') && temPalavra(base, norm(c.nome))) { categoria = c.nome; break; }
  }
  if (!categoria) {
    for (const [cat, ws] of (tipo === 'inc' ? REGRAS_ENTRADA : REGRAS_SAIDA)) {
      if (ws.some(w => temPalavra(base, w))) { categoria = cat; break; }
    }
  }
  if (!categoria) categoria = 'Outros';

  // descrição: o que sobrou, sem as palavras soltas
  const desc = resto.replace(/^[\s+-]+/, ' ').replace(/[,.;:!?]+/g, ' ').split(' ')
    .filter(w => w && !PALAVRAS_SOLTAS.has(w)).join(' ').trim();
  const original = descricaoOriginal(texto, desc);
  return { tipo: 'lancar', lanc: { tipo, valor: escolhido.valor, data, categoria, descricao: cap(original || categoria).slice(0, 60) } };
}

// devolve a descrição com os acentos do texto original ("acai" → "açaí")
function descricaoOriginal(texto: string, descNorm: string): string {
  if (!descNorm) return '';
  const palavras = texto.replace(/[,.;:!?]+/g, ' ').split(/\s+/).filter(Boolean);
  const alvo = descNorm.split(' ');
  const out: string[] = [];
  let i = 0;
  for (const p of palavras) { if (i < alvo.length && norm(p) === alvo[i]) { out.push(p.toLowerCase()); i++; } }
  return i === alvo.length ? out.join(' ') : descNorm;
}

// ------------------------------------------------------------------ respostas

const ICONES: Record<string, string> = { Mercado: '🛒', Moradia: '🏠', Contas: '💡', Transporte: '🚗', 'Saúde': '💊', Lazer: '🎉', 'Educação': '📚', 'Salário': '💰', 'Renda extra': '💸', Outros: '📌' };
export const AJUDA = [
  '👋 Oi! Eu sou o bot do *Pra Onde Foi?*',
  '',
  '*Para lançar um gasto*, é só escrever:',
  '• mercado 50',
  '• uber 23,90 ontem',
  '• farmácia 32,50 dia 05/11',
  '',
  '*Para lançar uma entrada:*',
  '• recebi salário 3500',
  '• + 200 freela',
  '',
  '*Para consultar:*',
  '• quanto gastei hoje',
  '• resumo da semana',
  '• saldo do mês',
  '',
  'Errou? Mande *desfazer* e eu apago o último lançamento.',
].join('\n');
const semVinculo = (canal: string) => [
  '👋 Oi! Este é o bot do *Pra Onde Foi?*',
  '',
  `Para eu lançar no seu app, ligue este ${canal} à sua conta:`,
  '1. Abra o app → *Menu* → *Meu perfil*',
  '2. Em *Bot*, toque em *Ligar bot*',
  '3. Mande aqui o código de 6 números que aparecer',
].join('\n');
const NAO_ENTENDI = [
  'Hmm, não entendi 🤔',
  '',
  'Tente assim: *mercado 50* ou *uber 23,90 ontem*.',
  'Mande *ajuda* para ver tudo que eu sei fazer.',
].join('\n');

export function textoLancado(l: Lanc, controle: string, hoje: string): string {
  const ic = ICONES[l.categoria] || (l.tipo === 'inc' ? '💸' : '📌');
  return [
    `✅ ${l.tipo === 'inc' ? 'Entrada lançada' : 'Lançado'} em *${controle}*`,
    `${ic} ${l.descricao} · *${brl(l.valor)}*`,
    (l.descricao === l.categoria ? '' : `🏷️ ${l.categoria} · `) + `📅 ${dataBonita(l.data, hoje)}`,
    '',
    'Errou? Mande *desfazer*.',
  ].join('\n');
}

function textoResumo(r: any, periodo: string): string {
  const nome = { hoje: 'hoje', ontem: 'ontem', semana: 'nesta semana', mes: 'neste mês' }[periodo] || periodo;
  if (!r.qtd) return `📊 Nada lançado ${nome} em *${r.controle_nome}*.`;
  const linhas = [`📊 *${cap(nome)}* em *${r.controle_nome}*`, '', `💸 Saídas: *${brl(Number(r.saidas))}*`];
  if (Number(r.entradas) > 0) linhas.push(`💰 Entradas: *${brl(Number(r.entradas))}*`);
  if (periodo === 'mes' && Number(r.entradas) > 0) linhas.push(`🧮 Sobrou: *${brl(Number(r.entradas) - Number(r.saidas))}*`);
  if (r.top && r.top.length) {
    linhas.push('', 'Onde mais gastou:');
    for (const c of r.top) linhas.push(`${ICONES[c.categoria] || '•'} ${c.categoria}: ${brl(Number(c.total))}`);
  }
  return linhas.join('\n');
}

// ------------------------------------------------------------------ Supabase

const env = (k: string) => (globalThis as any).Deno?.env.get(k) ?? '';

async function rpc(nome: string, args: Record<string, unknown>) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${nome}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const corpo = await r.text();
  if (!r.ok) throw new Error(`${nome}: ${r.status} ${corpo.slice(0, 300)}`);
  return corpo ? JSON.parse(corpo) : null;
}

// ------------------------------------------------------------------ uma mensagem (qualquer canal)

export type Canal = {
  nome: string;                          // 'WhatsApp' ou 'Telegram' (aparece nas respostas)
  id: string;                            // quem mandou: número do WhatsApp ou 'tg' + id do Telegram
  msgId: string;                         // id único da mensagem (evita lançar 2x)
  texto: string | null;                  // null = não é texto (áudio, foto…)
  fuso: string;
  enviar: (texto: string) => Promise<void>;
};

export async function tratar(c: Canal) {
  const reg = await rpc('bot_registrar_msg', { p_id: c.msgId, p_wa: c.id });
  if (reg === 'repetida' || reg === 'limite') return;   // limite: não responde (evita conversa em loop)
  if (c.texto == null) return c.enviar('Por enquanto eu só entendo mensagens de texto ✍️\nEx.: *mercado 50*');

  // comandos com barra (Telegram): "/start 123456" vira o código; "/ajuda" vira "ajuda"
  let texto = c.texto.slice(0, 500).trim().replace(/^\/(\w+)(@\w+)?/, (_m, cmd) => cmd.toLowerCase() === 'start' ? '' : cmd).trim();
  if (!texto) texto = 'ajuda';

  const hoje = hojeEm(c.fuso);
  const ctx = await rpc('bot_contexto', { p_wa: c.id });
  const cmd = entender(texto, hoje, ctx?.categorias || []);

  if (cmd.tipo === 'codigo') {
    const r = await rpc('bot_vincular', { p_wa: c.id, p_msg: c.msgId, p_codigo: cmd.codigo });
    if (r?.ok) return c.enviar(`🎉 Pronto${r.nome ? ', ' + r.nome.split(' ')[0] : ''}! Este ${c.nome} está ligado à sua conta.\nVou lançar em *${r.controle_nome}*.\n\n` + AJUDA.split('\n').slice(2).join('\n'));
    if (r?.erro === 'bloqueado') return c.enviar('⏳ Muitas tentativas com código errado. Espere 1 hora e gere um código novo no app.');
    return c.enviar('❌ Esse código não vale (errado ou passou dos 15 minutos). Gere outro no app: *Menu* → *Meu perfil* → *Ligar bot*.');
  }
  if (!ctx) return c.enviar(semVinculo(c.nome));
  if (!ctx.aprovado) return c.enviar('Sua conta ainda não está liberada no app. Assim que for aprovada, é só mandar de novo 🙂');

  switch (cmd.tipo) {
    case 'ajuda': return c.enviar(AJUDA);
    case 'nao_entendi': return c.enviar(NAO_ENTENDI);
    case 'desligar':
      return c.enviar(`Para desligar este ${c.nome} da sua conta, abra o app → *Menu* → *Meu perfil* → *Desligar bot*.`);
    case 'desfazer': {
      const r = await rpc('bot_desfazer', { p_wa: c.id });
      if (r?.erro) return c.enviar('Não achei nada lançado por aqui para desfazer.');
      return c.enviar(`🗑️ Apaguei: ${r.descricao} · ${brl(Number(r.valor))}`);
    }
    case 'resumo': {
      const r = await rpc('bot_resumo', { p_wa: c.id, p_de: cmd.de, p_ate: cmd.ate });
      if (r?.erro) return c.enviar('Não consegui ver o resumo agora. Tente de novo daqui a pouco.');
      return c.enviar(textoResumo(r, cmd.periodo));
    }
    case 'lancar': {
      const l = cmd.lanc;
      const r = await rpc('bot_lancar', { p_wa: c.id, p_tipo: l.tipo, p_desc: l.descricao, p_cat: l.categoria, p_valor: l.valor, p_data: l.data });
      if (r?.erro) return c.enviar('Não consegui lançar agora 😕 Tente de novo daqui a pouco.');
      return c.enviar(textoLancado(l, r.controle_nome, hoje));
    }
  }
}

// ------------------------------------------------------------------ Telegram

const TG_API = () => `${env('TG_API') || 'https://api.telegram.org'}/bot${env('TG_TOKEN')}`;

// o texto do bot usa *negrito* (estilo WhatsApp); no Telegram vira HTML, que não quebra com _ ou * soltos
export const paraHtml = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\*([^*\n]+)\*/g, '<b>$1</b>');

async function enviarTg(chat: number, texto: string) {
  const r = await fetch(`${TG_API()}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: paraHtml(texto), parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!r.ok) console.error('envio falhou', r.status, (await r.text()).slice(0, 300));
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
                     fuso: env('BOT_FUSO') || 'America/Sao_Paulo',
                     texto: typeof m.text === 'string' ? m.text : null,
                     enviar: (t: string) => enviarTg(chat, t) });
    }
  } catch (err) { console.error('webhook', err); }
  return new Response('ok');   // sempre 200, senão o Telegram fica reenviando
});
