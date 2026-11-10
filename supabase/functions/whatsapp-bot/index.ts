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

// ------------------------------------------------------------------ texto

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const brl = (v: number) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const temPalavra = (t: string, w: string) => new RegExp(`(^|[^a-z0-9])${esc(w)}([^a-z0-9]|$)`).test(t);

// palavras → categoria (as categorias padrão do app). Tudo sem acento e minúsculo.
const REGRAS_SAIDA: [string, string[]][] = [
  ['Mercado', ['mercado', 'supermercado', 'mercadinho', 'super', 'hiper', 'feira', 'feirinha', 'atacadao', 'atacado', 'assai', 'carrefour',
    'extra', 'pao de acucar', 'big', 'comper', 'fort', 'atacadista', 'tenda', 'sams', 'makro', 'padaria', 'pao', 'paes', 'acougue',
    'carne', 'frango', 'peixe', 'peixaria', 'hortifruti', 'sacolao', 'quitanda', 'mercearia', 'verdura', 'verduras', 'fruta', 'frutas',
    'legume', 'legumes', 'leite', 'ovo', 'ovos', 'arroz', 'feijao', 'cafe em po', 'compras do mes', 'compra do mes', 'rancho', 'mantimento',
    'mantimentos', 'agua mineral', 'galao', 'produtos de limpeza', 'limpeza', 'higiene', 'papel higienico', 'detergente', 'sabao']],
  ['Moradia', ['aluguel', 'condominio', 'iptu', 'reforma', 'obra', 'pedreiro', 'pintor', 'pintura', 'encanador', 'eletricista', 'conserto',
    'manutencao', 'movel', 'moveis', 'sofa', 'cama', 'colchao', 'geladeira', 'fogao', 'microondas', 'maquina de lavar', 'eletrodomestico',
    'decoracao', 'diarista', 'faxina', 'faxineira', 'empregada', 'jardineiro', 'material de construcao', 'leroy', 'casa', 'apartamento',
    'financiamento', 'prestacao da casa', 'seguro residencial', 'mudanca', 'chaveiro', 'dedetizacao']],
  ['Contas', ['luz', 'energia', 'energisa', 'enel', 'cemig', 'copel', 'cpfl', 'light', 'celpe', 'coelba', 'equatorial', 'agua', 'esgoto',
    'saneamento', 'sanear', 'sabesp', 'internet', 'wifi', 'wi fi', 'fibra', 'telefone', 'celular', 'plano de celular', 'recarga', 'credito do celular',
    'vivo', 'claro', 'tim', 'oi', 'gas', 'botijao', 'gas de cozinha', 'boleto', 'netflix', 'spotify', 'deezer', 'disney', 'hbo', 'max',
    'prime video', 'amazon prime', 'globoplay', 'youtube premium', 'paramount', 'star', 'apple tv', 'icloud', 'google one', 'chatgpt',
    'assinatura', 'streaming', 'tv a cabo', 'sky', 'conta de', 'fatura', 'seguro', 'tarifa', 'anuidade', 'taxa', 'imposto', 'darf', 'das',
    'mei', 'inss', 'imposto de renda', 'cartorio', 'contador', 'contabilidade']],
  ['Transporte', ['uber', 'uberx', 'uber moto', '99', '99pop', '99 pop', 'indrive', 'cabify', 'taxi', 'mototaxi', 'gasolina', 'combustivel',
    'etanol', 'alcool', 'diesel', 'gnv', 'abasteci', 'abastecer', 'abastecimento', 'posto', 'shell', 'ipiranga', 'petrobras', 'onibus',
    'metro', 'trem', 'brt', 'vlt', 'passagem', 'bilhete', 'vale transporte', 'estacionamento', 'zona azul', 'flanelinha', 'pedagio',
    'sem parar', 'conectcar', 'oficina', 'mecanico', 'revisao', 'pneu', 'pneus', 'oleo', 'troca de oleo', 'alinhamento', 'balanceamento',
    'bateria do carro', 'lava jato', 'lavagem', 'lava rapido', 'ipva', 'licenciamento', 'multa', 'detran', 'seguro do carro', 'seguro auto',
    'moto', 'carro', 'bicicleta', 'bike', 'patinete', 'aviao', 'passagem aerea', 'rodoviaria', 'parcela do carro', 'financiamento do carro']],
  ['Saúde', ['farmacia', 'drogaria', 'droga raia', 'drogasil', 'pague menos', 'panvel', 'remedio', 'remedios', 'medicamento', 'medicamentos',
    'medico', 'medica', 'consulta', 'dentista', 'odonto', 'ortodontia', 'aparelho', 'exame', 'exames', 'laboratorio', 'plano de saude',
    'unimed', 'amil', 'hapvida', 'bradesco saude', 'sulamerica', 'hospital', 'clinica', 'psicologo', 'psicologa', 'psiquiatra', 'terapia',
    'fisioterapia', 'fisio', 'nutricionista', 'academia', 'smartfit', 'smart fit', 'bluefit', 'crossfit', 'pilates', 'personal',
    'suplemento', 'whey', 'creatina', 'vitamina', 'vacina', 'oculos', 'otica', 'lente', 'veterinario', 'vet', 'petshop', 'pet shop', 'racao']],
  ['Lazer', ['cinema', 'filme', 'bar', 'boteco', 'cerveja', 'chopp', 'bebida', 'drink', 'balada', 'show', 'ingresso', 'festa', 'aniversario',
    'restaurante', 'almoco', 'janta', 'jantar', 'lanche', 'lanchonete', 'ifood', 'i food', 'rappi', 'ze delivery', 'delivery', 'pizza',
    'pizzaria', 'hamburguer', 'hamburgueria', 'burger', 'x tudo', 'mcdonalds', 'mc donalds', 'mequi', 'bk', 'burger king', 'subway',
    'habibs', 'outback', 'sushi', 'japones', 'temaki', 'acai', 'sorvete', 'sorveteria', 'cafe', 'cafeteria', 'starbucks', 'doce', 'doces',
    'bolo', 'salgado', 'pastel', 'espetinho', 'churrasco', 'churrascaria', 'rodizio', 'marmita', 'quentinha', 'self service', 'viagem',
    'hotel', 'pousada', 'airbnb', 'passeio', 'praia', 'parque', 'clube', 'jogo', 'game', 'games', 'steam', 'playstation', 'psn', 'xbox',
    'nintendo', 'presente', 'presentes', 'roupa', 'roupas', 'camisa', 'calca', 'sapato', 'tenis', 'shopping', 'shein', 'shopee', 'amazon',
    'mercado livre', 'magalu', 'renner', 'riachuelo', 'cea', 'salao', 'cabelo', 'cabeleireiro', 'barbearia', 'barbeiro', 'unha', 'manicure',
    'estetica', 'maquiagem', 'perfume', 'role', 'happy hour', 'happy']],
  ['Educação', ['escola', 'colegio', 'faculdade', 'universidade', 'curso', 'cursinho', 'livro', 'livros', 'apostila', 'material escolar',
    'mensalidade da escola', 'mensalidade da faculdade', 'mensalidade', 'matricula', 'aula', 'aulas', 'professor', 'professora', 'ingles',
    'idioma', 'udemy', 'alura', 'creche', 'uniforme', 'caderno', 'xerox', 'impressao', 'formatura']],
];
const REGRAS_ENTRADA: [string, string[]][] = [
  ['Salário', ['salario', 'holerite', 'pagamento do mes', 'adiantamento', 'vale', '13o', '13', 'decimo terceiro', 'ferias', 'plr', 'ppr',
    'pro labore', 'prolabore', 'bolsa']],
  ['Renda extra', ['freela', 'freelance', 'extra', 'vendi', 'venda', 'vendas', 'bico', 'comissao', 'reembolso', 'pix recebido', 'rendimento',
    'rendimentos', 'dividendo', 'dividendos', 'juros', 'cashback', 'premio', 'bonus', 'gorjeta', 'aluguel recebido', 'mesada', 'presente',
    'restituicao', 'transferencia recebida']],
];
// palavras que indicam ENTRADA de dinheiro
const PALAVRAS_ENTRADA = ['recebi', 'recebido', 'recebida', 'recebimento', 'ganhei', 'entrou', 'entrada', 'caiu', 'salario', 'vendi', 'freela',
  'freelance', 'reembolso', 'renda', 'comissao', 'holerite', 'pix recebido', 'me pagou', 'me pagaram', 'me deu', 'me deram', 'rendimento',
  'dividendo', 'dividendos', 'cashback', 'restituicao', 'adiantamento', 'plr', 'bonus', 'premio', 'mesada', 'gorjeta'];
// palavras que somem de qualquer lugar da descrição (verbos de lançar, dinheiro, forma de pagamento)
const SOMEM = ['add', 'adiciona', 'adicionar', 'adicione', 'lanca', 'lancar', 'lance', 'lancamento', 'anota', 'anotar', 'anote', 'registra',
  'registrar', 'registre', 'coloca', 'colocar', 'coloque', 'bota', 'botar', 'poe', 'por favor', 'pfv', 'pf', 'favor', 'gastei', 'gasto',
  'gastos', 'paguei', 'pagando', 'comprei', 'compra', 'recebi', 'ganhei', 'entrou', 'caiu', 'saida', 'saidas', 'despesa', 'entrada', 'custou',
  'deu', 'saiu', 'foi', 'tive', 'hoje', 'hj', 'agora', 'ontem', 'anteontem', 'reais', 'real', 'conto', 'contos', 'pila', 'pilas', 'mangos',
  'pratas', 'r$', 'valor', 'total', 'ai', 'aqui', 'cedo', 'noite', 'tarde', 'manha', 'vence', 'vencimento', 'vencer', 'vai vencer',
  'todo mes', 'mensal', 'fixa', 'fixo', 'so esse mes', 'so este mes', 'unica', 'avulsa', 'me pagou', 'me pagaram', 'me deu', 'me deram'];
// conectores que só caem do começo/fim ("gastei 50 no mercado" → "mercado"; "lanche no shopping" fica)
const PONTAS = new Set(['de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'com', 'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  'pra', 'pro', 'para', 'por', 'e', 'todo', 'toda', 'vai', 'ira', 'meu', 'minha', 'meus', 'minhas', 'que', 'ja', 'mais', 'de novo', 'dia', 'mes', 'conta']);
const FORMA_PAGTO = /(^| )(no|na|com|pelo|pela|via|em|de)? ?(cartao( de credito| de debito)?|credito|debito|pix|dinheiro|especie|vale refeicao|vale alimentacao|vr|va)( |$)/g;

// números por extenso: "cinquenta" → 50, "cento e vinte" → 120, "dois mil e quinhentos" → 2500
const NUM: Record<string, number> = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8,
  nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
  dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100,
  cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600,
  setecentos: 700, oitocentos: 800, novecentos: 900 };
export function extensoParaNumero(t: string): string {
  const w = t.split(' '), out: string[] = [];
  for (let i = 0; i < w.length; i++) {
    const ehNum = (x?: string) => x != null && (x in NUM || x === 'mil');
    // "um/uma" sozinho é artigo ("um lanche"); só vira número junto de outro número ou de "mil/real/reais"
    const comeca = ehNum(w[i]) && !((w[i] === 'um' || w[i] === 'uma') && !(w[i + 1] === 'mil' || w[i + 1] === 'real' || w[i + 1] === 'reais'));
    if (comeca && w[i] === 'mil' && /\d$/.test(out[out.length - 1] || '')) { out.push(w[i]); continue; }   // "1,5 mil" fica como está
    if (!comeca) { out.push(w[i]); continue; }
    let total = 0, atual = 0, j = i;
    while (j < w.length) {
      if (w[j] === 'mil') { total += (atual || 1) * 1000; atual = 0; j++; }
      else if (w[j] in NUM) { atual += NUM[w[j]]; j++; }
      else if (w[j] === 'e' && ehNum(w[j + 1]) && j > i) { j++; }
      else break;
    }
    out.push(String(total + atual)); i = j - 1;
  }
  return out.join(' ')
    .replace(/(\d+) (?:reais|real|conto|contos) e (\d{1,2}) centavos?/g, (_m, r, c) => `${r},${c.padStart(2, '0')} reais`)
    .replace(/(^| )(\d{1,2}) centavos?/g, (_m, a, c) => `${a}0,${c.padStart(2, '0')}`)
    .replace(/(\d+) e meio (mil|k)/g, (_m, n, k) => `${n},5 ${k}`);
}

// "1.234,56" / "23,90" / "23.90" / "1.500" / "50" / "2k" / "1,5 mil" → número
export function lerValor(s: string): number | null {
  let m = s.trim().toLowerCase().replace(/^r\$\s*/, '').replace(/\$$/, '');
  let mult = 1;
  if (/\s*(mil|k)$/.test(m)) { mult = 1000; m = m.replace(/\s*(mil|k)$/, ''); }
  let n: number;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(m)) n = Number(m.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(m)) n = Number(m.replace(/,/g, ''));
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
const OFFSETS: Record<string, number> = { 'America/Sao_Paulo': -3, 'America/Cuiaba': -4, 'America/Rio_Branco': -5 };
export function hojeEm(fuso: string, agora = new Date()): string {
  const f = (fuso || '').trim() || 'America/Sao_Paulo';
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: f, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
  } catch {
    // fuso que o servidor não reconhece: usa a diferença fixa (o Brasil não tem horário de verão)
    return new Date(agora.getTime() + (OFFSETS[f] ?? -3) * 3600e3).toISOString().slice(0, 10);
  }
}
const somaDias = (iso: string, d: number) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const isoValida = (iso: string) => !isNaN(new Date(iso + 'T12:00:00Z').getTime()) && new Date(iso + 'T12:00:00Z').toISOString().slice(0, 10) === iso;
export const dataBonita = (iso: string, hoje: string) =>
  iso === hoje ? 'hoje' : iso === somaDias(hoje, -1) ? 'ontem' : `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const nomeMes = (iso: string) => MESES[Number(iso.slice(5, 7)) - 1];
const DIAS_SEMANA: [RegExp, number][] = [[/domingo/, 0], [/segunda/, 1], [/terca/, 2], [/quarta/, 3], [/quinta/, 4], [/sexta/, 5], [/sabado/, 6]];

export type Lanc = { tipo: 'exp' | 'inc'; valor: number; data: string; categoria: string; descricao: string };
export type Conta = { nome: string; categoria: string; valor: number; dia: number; tipo: 'fixa' | 'unica' | 'parcelada'; parcelas: number | null };
export type Comando =
  | { tipo: 'ajuda' } | { tipo: 'desfazer' } | { tipo: 'desligar' } | { tipo: 'cancelar' }
  | { tipo: 'codigo'; codigo: string }
  | { tipo: 'resumo'; periodo: 'hoje' | 'ontem' | 'semana' | 'mes'; de: string; ate: string }
  | { tipo: 'lancar'; lancs: Lanc[] }
  | { tipo: 'conta'; conta: Conta }
  | { tipo: 'pagar'; busca: string; rotulo: string; valor: number | null; data: string; lanc: Lanc | null }
  | { tipo: 'perguntar'; falta: 'valor' | 'dia'; texto: string; rotulo: string }
  | { tipo: 'nao_entendi' };

// tira data do texto e devolve [texto sem a data, data iso]
function tirarData(resto: string, hoje: string): [string, string, number | null] {
  let data = hoje; let diaSolto: number | null = null;
  const dm = resto.match(/ (?:dia )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))? /);
  if (dm) {
    const ano = dm[3] ? (dm[3].length === 2 ? '20' + dm[3] : dm[3]) : hoje.slice(0, 4);
    let iso = `${ano}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
    if (isoValida(iso)) {
      if (!dm[3] && iso > hoje) iso = `${Number(ano) - 1}${iso.slice(4)}`;
      return [resto.replace(dm[0], ' '), iso, Number(dm[1])];
    }
  }
  if (/ anteontem /.test(resto)) return [resto.replace(/ anteontem /, ' '), somaDias(hoje, -2), null];
  if (/ ontem /.test(resto)) return [resto.replace(/ ontem /, ' '), somaDias(hoje, -1), null];
  if (/ (hoje|hj|agora) /.test(resto)) resto = resto.replace(/ (hoje|hj|agora) /, ' ');
  const dd = resto.match(/ dia (\d{1,2}) /);
  if (dd && Number(dd[1]) >= 1 && Number(dd[1]) <= 31) {
    diaSolto = Number(dd[1]);
    let iso = hoje.slice(0, 8) + dd[1].padStart(2, '0');
    if (iso > hoje || !isoValida(iso)) { const m = new Date(hoje.slice(0, 8) + '01T12:00:00Z'); m.setUTCMonth(m.getUTCMonth() - 1); iso = m.toISOString().slice(0, 8) + dd[1].padStart(2, '0'); }
    if (isoValida(iso)) data = iso;
    return [resto.replace(dd[0], ' '), data, diaSolto];
  }
  for (const [rx, dow] of DIAS_SEMANA) {
    const m = resto.match(new RegExp(` (?:na |no |de |nessa |nesta |essa |esta |ultima |ultimo |passada )?${rx.source}(?:[ -]feira)?(?: passad[ao])? `));
    if (m) {
      const hojeDow = new Date(hoje + 'T12:00:00Z').getUTCDay();
      const volta = (hojeDow - dow + 7) % 7;
      return [resto.replace(m[0], ' '), somaDias(hoje, -volta), null];
    }
  }
  return [resto, data, diaSolto];
}

// o que sobra vira a descrição
function limparDescricao(s: string): string {
  let t = ' ' + s.replace(/[,.;:!?()"']+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  t = t.replace(FORMA_PAGTO, ' ');
  for (const w of SOMEM) t = t.replace(new RegExp(` ${esc(w)}(?= )`, 'g'), ' ');
  let p = t.trim().split(' ').filter(w => w && /[a-z0-9]/.test(w));
  while (p.length && PONTAS.has(p[0])) p.shift();
  while (p.length && PONTAS.has(p[p.length - 1])) p.pop();
  return p.join(' ');
}

// devolve a descrição com os acentos do texto original ("acai" → "açaí")
function descricaoOriginal(texto: string, descNorm: string): string {
  if (!descNorm) return '';
  const palavras = texto.replace(/[,.;:!?()"']+/g, ' ').split(/\s+/).filter(Boolean);
  const alvo = descNorm.split(' ');
  const out: string[] = [];
  let i = 0;
  for (const p of palavras) { if (i < alvo.length && norm(p) === alvo[i]) { out.push(p.toLowerCase()); i++; } }
  return i === alvo.length ? out.join(' ') : descNorm;
}

function acharCategoria(base: string, tipo: 'exp' | 'inc', cats: { nome: string; tipo: string }[]): string {
  for (const c of cats) if ((c.tipo === tipo || c.tipo === 'ambos') && temPalavra(base, norm(c.nome))) return c.nome;
  // a regra com a palavra mais longa ganha ("conta de luz" > "conta de"; "seguro do carro" > "seguro")
  let melhor = '', tam = 0;
  for (const [cat, ws] of (tipo === 'inc' ? REGRAS_ENTRADA : REGRAS_SAIDA)) {
    for (const w of ws) if (w.length > tam && temPalavra(base, w)) { melhor = cat; tam = w.length; }
  }
  return melhor || 'Outros';
}

// entende UMA frase
const juntarData = (t: string) => t.replace(/(\d)\s*\/\s*(\d)/g, '$1/$2');

function entenderUma(texto: string, hoje: string, cats: { nome: string; tipo: string }[]): Comando {
  const t = juntarData(extensoParaNumero(norm(texto)));
  if (!t) return { tipo: 'nao_entendi' };

  // conta a pagar? ("conta de luz 180 vence dia 20", "aluguel 1500 todo dia 5")
  const ehConta = /(^| )(vence|vencimento|venc|vencer|vai vencer|pra vencer|todo dia \d|todo mes|conta fixa|boleto pra dia)( |$)/.test(t);
  // pagamento de conta? ("paguei a luz", "paguei o aluguel 1500")
  const ehPagamento = !ehConta && /^(eu )?(paguei|pago|quitei|acabei de pagar|ja paguei|paga a|paga o)( |$)/.test(t);

  let resto = ' ' + t + ' ';
  // dia do vencimento: "todo dia 5", "vence dia 20", "vence 15", "vencimento 15/11"
  let diaVenc: number | null = null;
  const tv = resto.match(/ (?:todo dia|(?:que )?(?:vence|vencimento|venc|vencer)(?: (?:no |todo )?dia| em| no| dia)?) (\d{1,2})(?:\/\d{1,2}(?:\/\d{2,4})?)? /);
  if (tv && Number(tv[1]) >= 1 && Number(tv[1]) <= 31) { diaVenc = Number(tv[1]); resto = resto.replace(tv[0], ' '); }
  const [semData, data, diaSolto] = tirarData(resto, hoje);
  resto = semData;
  if (diaVenc == null) diaVenc = diaSolto;
  // parcelas: "em 10x", "10 parcelas"
  let parcelas: number | null = null;
  const px = resto.match(/ (?:em )?(\d{1,3}) ?(?:x|vezes|parcelas) /);
  if (px) { parcelas = Number(px[1]); resto = resto.replace(px[0], ' '); }

  // valor: prefere o que tem R$/reais/vírgula; senão o último número
  const rxNum = /(r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*(?:mil|k)(?![a-z]))?(\s*(?:reais|real|conto|contos|pila|pilas|mangos|pratas|\$)(?![a-z]))?/g;
  const achados: { txt: string; valor: number; forte: boolean }[] = [];
  for (const m of resto.matchAll(rxNum)) {
    const v = lerValor((m[2] || '') + (m[3] || ''));
    if (v == null) continue;
    achados.push({ txt: m[0], valor: v, forte: !!(m[1] || m[4] || /,/.test(m[2]) || m[3]) });
  }
  const escolhido = achados.filter(a => a.forte).pop() || achados[achados.length - 1] || null;
  if (escolhido) resto = resto.replace(escolhido.txt, ' ');

  const base = resto.trim();
  const sinal = t.match(/^([+-])/);
  const tipo: 'exp' | 'inc' = sinal ? (sinal[1] === '+' ? 'inc' : 'exp')
    : /(^| )(saida|despesa|gastei|paguei|comprei)( |$)/.test(t) ? 'exp'
    : PALAVRAS_ENTRADA.some(w => temPalavra(t, w)) ? 'inc' : 'exp';
  const categoria = acharCategoria(base, tipo, cats);
  const descNorm = limparDescricao(base.replace(/^[+-]/, ''));
  const descricao = cap(descricaoOriginal(texto, descNorm) || '').slice(0, 60);

  if (ehConta) {
    if (!descNorm) return { tipo: 'nao_entendi' };
    const nome = descricao || categoria;
    if (!escolhido) return { tipo: 'perguntar', falta: 'valor', texto, rotulo: nome };
    if (!diaVenc) return { tipo: 'perguntar', falta: 'dia', texto, rotulo: nome };
    const tipoConta = parcelas && parcelas >= 2 ? 'parcelada' : /(^| )(so esse mes|so este mes|unica|uma vez|avulsa)( |$)/.test(t) ? 'unica' : 'fixa';
    return { tipo: 'conta', conta: { nome, categoria: categoria === 'Outros' ? 'Contas' : categoria, valor: escolhido.valor,
      dia: diaVenc, tipo: tipoConta, parcelas: tipoConta === 'parcelada' ? parcelas : null } };
  }

  const lanc: Lanc | null = escolhido ? { tipo, valor: escolhido.valor, data, categoria, descricao: descricao || categoria } : null;
  if (ehPagamento && descNorm) return { tipo: 'pagar', busca: descNorm, rotulo: descricao || descNorm, valor: escolhido?.valor ?? null, data, lanc };
  if (lanc) return { tipo: 'lancar', lancs: [lanc] };
  // sem valor: se deu para entender do que se trata, pergunta quanto foi
  const temVerbo = /(^| )(add|adiciona\w*|lanc\w*|anot\w*|registr\w*|coloc\w*|gastei|paguei|comprei|recebi|ganhei|conta)( |$)/.test(t);
  if (descNorm && descNorm.length >= 3 && !/^\d+$/.test(descNorm) && (categoria !== 'Outros' || temVerbo))
    return { tipo: 'perguntar', falta: 'valor', texto, rotulo: descricao || categoria };
  return { tipo: 'nao_entendi' };
}

// entende a mensagem toda. cats = categorias próprias do controle (têm prioridade)
export function entender(texto: string, hoje: string, cats: { nome: string; tipo: string }[] = []): Comando {
  const t = norm(texto);
  if (!t) return { tipo: 'nao_entendi' };
  const cod = t.replace(/[\s.-]/g, '').match(/^(?:pof)?(\d{6})$/);
  if (cod) return { tipo: 'codigo', codigo: cod[1] };
  if (/^(ajuda|menu|oi+|ola|opa|eai|e ai|eae|salve|bom dia|boa tarde|boa noite|comandos|help|\?|como funciona|como usa|o que voce faz|start|inicio)[!?. ]*$/.test(t)) return { tipo: 'ajuda' };
  if (/^(desfazer|desfaz|desfaca|apagar|apaga|apague|excluir|exclui|exclua|deletar|deleta|remover|remove|errei|errado|corrigir|apaga o ultimo|apagar o ultimo|desfazer o ultimo|apaga esse|apaga isso|nao era isso)[!. ]*$/.test(t)) return { tipo: 'desfazer' };
  if (/^(cancelar|cancela|deixa|deixa pra la|esquece|esqueca|nada|nao)[!. ]*$/.test(t)) return { tipo: 'cancelar' };
  if (/^(desligar|desconectar|sair|parar)[!. ]*$/.test(t)) return { tipo: 'desligar' };

  // perguntas de resumo (sem valor na frase)
  if (/(quanto|resumo|saldo|gastos?|total|extrato|balanco|como (estou|to|ta|esta)|sobrou|relatorio)/.test(t) && !/\d/.test(extensoParaNumero(t))) {
    const periodo = /ontem/.test(t) ? 'ontem' : /(hoje|hj|do dia|no dia)/.test(t) ? 'hoje' : /semana/.test(t) ? 'semana' : 'mes';
    if (periodo === 'hoje') return { tipo: 'resumo', periodo, de: hoje, ate: hoje };
    if (periodo === 'ontem') { const o = somaDias(hoje, -1); return { tipo: 'resumo', periodo, de: o, ate: o }; }
    if (periodo === 'semana') {
      const dow = (new Date(hoje + 'T12:00:00Z').getUTCDay() + 6) % 7;   // segunda = 0
      return { tipo: 'resumo', periodo, de: somaDias(hoje, -dow), ate: hoje };
    }
    return { tipo: 'resumo', periodo: 'mes', de: hoje.slice(0, 8) + '01', ate: hoje };
  }

  // várias coisas numa mensagem: uma por linha, ou "mercado 50 e uber 20", "pão 8, leite 6"
  let partes = texto.split(/\n|;/).map(s => s.trim()).filter(Boolean);
  partes = partes.flatMap(p => {
    const crus = p.split(/(\s+e\s+|,\s+(?=\D))/i);
    // junta de volta o "e" que faz parte do número: "cento e vinte", "dois mil e quinhentos", "10 reais e 50 centavos"
    const pedacos: string[] = [];
    for (let i = 0; i < crus.length; i += 2) {
      const sep = crus[i - 1] || '', ant = pedacos[pedacos.length - 1];
      const fimAnt = ant ? norm(ant).split(' ').pop() || '' : '', iniAtual = norm(crus[i]).split(' ')[0] || '';
      const numerico = (w: string) => w in NUM || w === 'mil' || /^\d/.test(w);
      if (ant != null && /\se\s/i.test(sep) && (numerico(fimAnt) || ['reais', 'real', 'conto', 'contos'].includes(fimAnt)) && numerico(iniAtual))
        pedacos[pedacos.length - 1] = ant + sep + crus[i];
      else pedacos.push(crus[i]);
    }
    for (let i = 0; i < pedacos.length; i++) pedacos[i] = pedacos[i].trim();
    const temValor = (s: string) => /\d/.test(juntarData(extensoParaNumero(norm(s))).replace(/(dia )?\d{1,2}\/\d{1,2}(\/\d{2,4})?|dia \d{1,2}/g, ''));
    return pedacos.length > 1 && pedacos.every(temValor) ? pedacos : [p];
  });
  if (partes.length > 1) {
    const cmds = partes.map(p => entenderUma(p, hoje, cats));
    if (cmds.every(c => c.tipo === 'lancar')) return { tipo: 'lancar', lancs: cmds.flatMap(c => (c as { lancs: Lanc[] }).lancs) };
  }
  return entenderUma(texto, hoje, cats);
}

// resposta de um número solto à pergunta "quanto foi?" / "que dia vence?"
// a resposta não fala de outra coisa? (só valor, data, vencimento…) → completa a pergunta
function semAssunto(resposta: string): boolean {
  let t = ' ' + juntarData(extensoParaNumero(norm(resposta))).replace(/[,.;:!?()"']+/g, ' ') + ' ';
  t = t.replace(/(r\$\s*)?\d[\d.,]*(\/\d{1,2}(\/\d{2,4})?)?\s*(mil|k|x)?/g, ' ');
  return limparDescricao(t).replace(/(^| )(dia|de|do|em|no)( |$)/g, ' ').trim() === '';
}

export function completarPendente(p: { texto: string; falta: string }, resposta: string): string | null {
  if (/\d/.test(extensoParaNumero(norm(resposta))) && semAssunto(resposta) && !/^\d{6}$/.test(norm(resposta).replace(/\D/g, ''))) {
    const r0 = extensoParaNumero(norm(resposta)).trim();
    if (p.falta === 'dia' && /^(dia\s*)?\d{1,2}$/.test(r0)) return `${p.texto} dia ${r0.replace(/\D/g, '')}`;
    return `${p.texto} ${resposta}`;
  }
  const r = extensoParaNumero(norm(resposta)).replace(/^(foi|deu|e|sao|custou|vence|dia|no dia|todo dia)\s+/, '').trim();
  if (p.falta === 'valor' && /^(r\$\s*)?[\d.,]+\s*(k|mil|reais|real|conto|contos|pila|pilas)?$/.test(r)) return `${p.texto} ${r}`;
  if (p.falta === 'dia' && /^(dia\s*)?\d{1,2}$/.test(r)) { const d = Number(r.replace(/\D/g, '')); if (d >= 1 && d <= 31) return `${p.texto} dia ${d}`; }
  return null;
}

// ------------------------------------------------------------------ respostas

const ICONES: Record<string, string> = { Mercado: '🛒', Moradia: '🏠', Contas: '💡', Transporte: '🚗', 'Saúde': '💊', Lazer: '🎉', 'Educação': '📚', 'Salário': '💰', 'Renda extra': '💸', Outros: '📌' };
export const AJUDA = [
  '👋 Oi! Eu sou o bot do *Pra Onde Foi?*',
  '',
  '*Para lançar um gasto*, é só escrever do seu jeito:',
  '• mercado 50',
  '• uber 23,90 ontem',
  '• gastei 32,50 na farmácia sexta',
  '• pão 8, leite 6 e café 15',
  '',
  '*Para lançar uma entrada:*',
  '• recebi salário 3500',
  '• + 200 freela',
  '',
  '*Contas a pagar:*',
  '• conta de luz 180 vence dia 20',
  '• paguei a luz',
  '',
  '*Para consultar:*',
  '• quanto gastei hoje',
  '• resumo da semana',
  '• saldo do mês',
  '',
  'Errou? Mande *desfazer* e eu desfaço o último.',
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

export function textoLancado(ls: Lanc[], controle: string, hoje: string): string {
  if (ls.length === 1) {
    const l = ls[0], ic = ICONES[l.categoria] || (l.tipo === 'inc' ? '💸' : '📌');
    return [
      `✅ ${l.tipo === 'inc' ? 'Entrada lançada' : 'Lançado'} em *${controle}*`,
      `${ic} ${l.descricao} · *${brl(l.valor)}*`,
      (l.descricao === l.categoria ? '' : `🏷️ ${l.categoria} · `) + `📅 ${dataBonita(l.data, hoje)}`,
      '',
      'Errou? Mande *desfazer*.',
    ].join('\n');
  }
  const linhas = [`✅ Lancei ${ls.length} em *${controle}*`, ''];
  for (const l of ls) linhas.push(`${ICONES[l.categoria] || '📌'} ${l.descricao} · *${brl(l.valor)}*${l.tipo === 'inc' ? ' (entrada)' : ''} · ${dataBonita(l.data, hoje)}`);
  linhas.push('', `Total: *${brl(ls.reduce((s, l) => s + (l.tipo === 'inc' ? -l.valor : l.valor), 0))}*`, '', 'Errou? Mande *desfazer* (apaga o último).');
  return linhas.join('\n');
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

// escolhe a conta a pagar pelo nome ("luz" acha "Conta de luz" e "Energisa" se a categoria bater)
export function acharConta(busca: string, contas: { id: string; nome: string; mes: string; falta: number }[]) {
  const palavras = busca.split(' ').filter(w => w.length >= 3 && !['conta', 'boleto', 'fatura', 'mes', 'parcela'].includes(w));
  if (!palavras.length) return [];
  const pontos = contas.map(c => ({ c, p: palavras.filter(w => temPalavra(norm(c.nome), w) || norm(c.nome).includes(w)).length }));
  const max = Math.max(0, ...pontos.map(x => x.p));
  if (!max) return [];
  // mesma conta em dois meses (atrasada + atual): fica a mais antiga
  const melhores = pontos.filter(x => x.p === max).map(x => x.c).sort((a, b) => a.mes.localeCompare(b.mes));
  const vistos = new Set<string>();
  return melhores.filter(c => !vistos.has(c.id) && vistos.add(c.id));
}

// ------------------------------------------------------------------ Supabase

const env = (k: string) => String((globalThis as any).Deno?.env.get(k) ?? '').trim();   // trim: evita Enter/espaço colado no segredo

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
  let texto = c.texto.slice(0, 1000).trim().replace(/^\/(\w+)(@\w+)?/, (_m, cmd) => cmd.toLowerCase() === 'start' ? '' : cmd).trim();
  if (!texto) texto = 'ajuda';

  const hoje = hojeEm(c.fuso);
  const ctx = await rpc('bot_contexto', { p_wa: c.id });

  // resposta a uma pergunta do bot ("Quanto foi?" → "180")
  if (ctx?.pendente) {
    const junto = completarPendente(ctx.pendente, texto);
    await rpc('bot_pendente', { p_wa: c.id, p_pendente: null });
    if (junto) texto = junto;
    else if (entender(texto, hoje).tipo === 'cancelar') return c.enviar('Beleza, deixei pra lá 👍');
  }

  const cmd = entender(texto, hoje, ctx?.categorias || []);

  if (cmd.tipo === 'codigo') {
    const r = await rpc('bot_vincular', { p_wa: c.id, p_msg: c.msgId, p_codigo: cmd.codigo });
    if (r?.ok) return c.enviar(`🎉 Pronto${r.nome ? ', ' + r.nome.split(' ')[0] : ''}! Este ${c.nome} está ligado à sua conta.\nVou lançar em *${r.controle_nome}*.\n\n` + AJUDA.split('\n').slice(2).join('\n'));
    if (r?.erro === 'bloqueado') return c.enviar('⏳ Muitas tentativas com código errado. Espere 1 hora e gere um código novo no app.');
    return c.enviar('❌ Esse código não vale (errado ou passou dos 15 minutos). Gere outro no app: *Menu* → *Meu perfil* → *Ligar bot*.');
  }
  if (!ctx) return c.enviar(semVinculo(c.nome));
  if (!ctx.aprovado) return c.enviar('Sua conta ainda não está liberada no app. Assim que for aprovada, é só mandar de novo 🙂');

  const lancar = async (ls: Lanc[]) => {
    for (const l of ls) {
      const r = await rpc('bot_lancar', { p_wa: c.id, p_tipo: l.tipo, p_desc: l.descricao, p_cat: l.categoria, p_valor: l.valor, p_data: l.data });
      if (r?.erro) return c.enviar('Não consegui lançar agora 😕 Tente de novo daqui a pouco.');
    }
    return c.enviar(textoLancado(ls, ctx.controle_nome, hoje));
  };

  switch (cmd.tipo) {
    case 'ajuda': return c.enviar(AJUDA);
    case 'nao_entendi': return c.enviar(NAO_ENTENDI);
    case 'cancelar': return c.enviar('Beleza 👍 Se quiser desfazer o último lançamento, mande *desfazer*.');
    case 'desligar':
      return c.enviar(`Para desligar este ${c.nome} da sua conta, abra o app → *Menu* → *Meu perfil* → *Desligar bot*.`);
    case 'desfazer': {
      const r = await rpc('bot_desfazer', { p_wa: c.id });
      if (r?.erro === 'conta_com_pagamento') return c.enviar('Essa conta já tem pagamento. Para apagar, use o app em *Contas a pagar*.');
      if (r?.erro) return c.enviar('Não achei nada feito por aqui para desfazer.');
      const oque = r.tipo === 'conta' ? 'a conta a pagar' : r.tipo === 'pag' ? 'o pagamento de' : '';
      return c.enviar(`🗑️ Desfeito: ${oque ? oque + ' ' : ''}${r.descricao} · ${brl(Number(r.valor))}`);
    }
    case 'resumo': {
      const r = await rpc('bot_resumo', { p_wa: c.id, p_de: cmd.de, p_ate: cmd.ate });
      if (r?.erro) return c.enviar('Não consegui ver o resumo agora. Tente de novo daqui a pouco.');
      return c.enviar(textoResumo(r, cmd.periodo));
    }
    case 'perguntar': {
      await rpc('bot_pendente', { p_wa: c.id, p_pendente: { texto: cmd.texto, falta: cmd.falta } });
      return c.enviar(cmd.falta === 'valor'
        ? `💬 Quanto foi *${cmd.rotulo.toLowerCase()}*? Mande só o valor (ex.: 180,50).`
        : `📅 Que dia vence *${cmd.rotulo.toLowerCase()}*? Mande só o dia (ex.: 20).`);
    }
    case 'conta': {
      const k = cmd.conta;
      if (!ctx.tem_contas) return c.enviar(`O controle *${ctx.controle_nome}* não usa Contas a pagar. Se já pagou, mande sem "vence" que eu lanço como gasto.`);
      const r = await rpc('bot_criar_conta', { p_wa: c.id, p_nome: k.nome, p_cat: k.categoria, p_valor: k.valor, p_dia: k.dia, p_tipo: k.tipo, p_parcelas: k.parcelas });
      if (r?.erro) return c.enviar('Não consegui criar a conta agora 😕 Tente de novo daqui a pouco.');
      const quando = k.tipo === 'fixa' ? `todo dia *${k.dia}*` : k.tipo === 'parcelada' ? `dia *${k.dia}*, em ${k.parcelas}x` : `dia *${k.dia}* de ${nomeMes(r.inicio)}`;
      return c.enviar([`🗓️ Conta a pagar criada em *${r.controle_nome}*`, `${ICONES[k.categoria] || '💡'} ${k.nome} · *${brl(k.valor)}*`,
        `Vence ${quando}${k.tipo === 'fixa' ? ` (a partir de ${nomeMes(r.inicio)})` : ''}`, '', 'Quando pagar, mande *paguei ' + k.nome.toLowerCase() + '*.', 'Errou? Mande *desfazer*.'].join('\n'));
    }
    case 'pagar': {
      const abertas = ctx.tem_contas ? (await rpc('bot_contas_abertas', { p_wa: c.id })) || [] : [];
      const achou = acharConta(cmd.busca, abertas);
      if (achou.length === 1) {
        const k = achou[0];
        const r = await rpc('bot_pagar_conta', { p_wa: c.id, p_conta: k.id, p_mes: k.mes, p_valor: cmd.valor, p_data: cmd.data });
        if (r?.erro === 'maior') return c.enviar(`Esse valor é maior do que falta pagar de *${k.nome}* (${brl(Number(r.falta))}).`);
        if (r?.erro) return c.enviar('Não consegui marcar como paga agora 😕 Tente de novo daqui a pouco.');
        const resta = Number(r.falta) > 0 ? `\nAinda falta ${brl(Number(r.falta))} dessa conta.` : '';
        return c.enviar(`✅ Paguei *${r.nome}* de ${nomeMes(r.mes)} · *${brl(Number(r.valor))}*\nJá saiu em Lançamentos.${resta}\n\nErrou? Mande *desfazer*.`);
      }
      if (achou.length > 1) {
        return c.enviar(['Achei mais de uma conta parecida:', ...achou.slice(0, 5).map(k => `• ${k.nome} (${nomeMes(k.mes)}) · falta ${brl(Number(k.falta))}`),
          '', 'Mande de novo com o nome certinho, tipo *paguei ' + norm(achou[0].nome) + '*.'].join('\n'));
      }
      if (cmd.lanc) return lancar([cmd.lanc]);   // não é conta cadastrada: lança como gasto
      await rpc('bot_pendente', { p_wa: c.id, p_pendente: { texto, falta: 'valor' } });
      return c.enviar(`💬 Não achei *${cmd.rotulo.toLowerCase()}* em Contas a pagar. Quanto foi? Eu lanço como gasto.`);
    }
    case 'lancar': return lancar(cmd.lancs);
  }
}

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
