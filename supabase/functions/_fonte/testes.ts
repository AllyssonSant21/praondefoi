// Testes do entendimento do bot. Rodar: node --experimental-strip-types _fonte/testes.ts
// Toda frase que já funcionou entra aqui, para nenhuma mudança quebrar o que dava certo.
import { entender, completarPendente, acharConta } from './nucleo.ts';

const H = '2026-11-10';   // terça
const cats = [{ nome: 'Pet', tipo: 'exp' }];
const dic = [{ termo: 'drogaria ze', tipo: 'exp', categoria: 'Saúde' }];

// [frase, resumo esperado]
const casos: [string, string][] = [
  ['mercado 50', 'lancar exp|Mercado|Mercado|50|2026-11-10'],
  ['gastei 50 no mercado', 'lancar exp|Mercado|Mercado|50|2026-11-10'],
  ['saida mercado 50', 'lancar exp|Mercado|Mercado|50|2026-11-10'],
  ['Uber 23,90 ontem', 'lancar exp|Uber|Transporte|23.9|2026-11-09'],
  ['farmácia 32,50 sexta', 'lancar exp|Farmácia|Saúde|32.5|2026-11-06'],
  ['farmacia 20 segunda passada', 'lancar exp|Farmacia|Saúde|20|2026-11-09'],
  ['cinquenta reais de pizza', 'lancar exp|Pizza|Lazer|50|2026-11-10'],
  ['cento e vinte no posto', 'lancar exp|Posto|Transporte|120|2026-11-10'],
  ['dois mil e quinhentos aluguel', 'lancar exp|Aluguel|Moradia|2500|2026-11-10'],
  ['dez reais e cinquenta centavos de café', 'lancar exp|Café|Lazer|10.5|2026-11-10'],
  ['1,5 mil reforma', 'lancar exp|Reforma|Moradia|1500|2026-11-10'],
  ['R$1.234,56 aluguel', 'lancar exp|Aluguel|Moradia|1234.56|2026-11-10'],
  ['recebi salário 3500', 'lancar inc|Salário|Salário|3500|2026-11-10'],
  ['me pagaram 200 do freela', 'lancar inc|Freela|Renda extra|200|2026-11-10'],
  ['+ 200 freela', 'lancar inc|Freela|Renda extra|200|2026-11-10'],
  ['- 30 lanche', 'lancar exp|Lanche|Lazer|30|2026-11-10'],
  ['pão 8, leite 6 e café 15', 'lancar exp|Pão|Mercado|8|2026-11-10 ; exp|Leite|Mercado|6|2026-11-10 ; exp|Café|Lazer|15|2026-11-10'],
  ['mercado 50\nuber 20', 'lancar exp|Mercado|Mercado|50|2026-11-10 ; exp|Uber|Transporte|20|2026-11-10'],
  ['lanche no shopping 25 no cartão', 'lancar exp|Lanche no shopping|Lazer|25|2026-11-10'],
  ['comprei tênis 299,90 no crédito', 'lancar exp|Tênis|Lazer|299.9|2026-11-10'],
  ['açaí 18', 'lancar exp|Açaí|Lazer|18|2026-11-10'],
  ['pet 120', 'lancar exp|Pet|Pet|120|2026-11-10'],
  ['netflix 55,90', 'lancar exp|Netflix|Contas|55.9|2026-11-10'],
  ['gasolina 200 hj', 'lancar exp|Gasolina|Transporte|200|2026-11-10'],
  ['ifood 63,40 ontem a noite', 'lancar exp|Ifood|Lazer|63.4|2026-11-09'],
  ['sorvete 12 dia 05/11', 'lancar exp|Sorvete|Lazer|12|2026-11-05'],
  ['drogaria ze 30', 'lancar exp|Drogaria ze|Saúde|30|2026-11-10'],
  ['pix 40 pro joão', 'lancar exp|João|Outros|40|2026-11-10 ?categoria'],
  ['conta de luz 180 vence dia 20', 'conta Luz|Contas|180|20|fixa'],
  ['aluguel 1500 todo dia 5', 'conta Aluguel|Moradia|1500|5|fixa'],
  ['internet 99,90 vence 15', 'conta Internet|Contas|99.9|15|fixa'],
  ['luz 200 vence 20/11', 'conta Luz|Contas|200|20|fixa'],
  ['celular novo 1200 em 10x vence dia 10', 'conta Celular novo|Contas|1200|10|parcelada'],
  ['add conta de luz', 'perguntar valor Luz'],
  ['luz 180 vence', 'perguntar dia Luz'],
  ['mercado', 'perguntar valor Mercado'],
  ['paguei a luz', 'pagar luz null'],
  ['paguei luz 182,30', 'pagar luz 182.3'],
  ['quanto gastei hoje', 'resumo hoje'],
  ['resumo da semana', 'resumo semana'],
  ['saldo do mês', 'resumo mes'],
  ['foi 200 , vai vencer dia 20 /11', 'nao_entendi'],
  ['blablabla', 'nao_entendi'],
  ['oi', 'ajuda'], ['bom dia', 'ajuda'], ['desfazer', 'desfazer'], ['cancela', 'cancelar'], ['sim', 'sim'], ['não', 'nao'],
  ['123456', 'codigo'],
  ['Oi, Detetive Grana! 🕵️ Quero ativar meu bot. Código: 482 913', 'codigo'],
  // edição
  ['o último era 45', 'editar_ultimo valor=45'],
  ['era 45', 'editar_ultimo valor=45'],
  ['na verdade era 30 reais', 'editar_ultimo valor=30'],
  ['era farmácia', 'editar_ultimo desc=Farmácia cat=Saúde'],
  ['era saúde', 'editar_ultimo cat=Saúde'],
  ['era ontem', 'editar_ultimo data=2026-11-09'],
  ['corrigir último para 45', 'editar_ultimo valor=45'],
  ['corrigir último: era farmácia', 'editar_ultimo desc=Farmácia cat=Saúde'],
  ['alterar nome da conta 200 vai para conta de agua', 'editar_conta alvo=200 nome=Conta de agua'],
  ['renomear a conta luz para energia', 'editar_conta alvo=luz nome=Energia'],
  ['mudar valor da luz para 210', 'editar_conta alvo=luz valor=210'],
  ['mudar vencimento da luz para dia 15', 'editar_conta alvo=luz dia=15'],
  ['mudar a luz pra 230', 'editar_conta alvo=luz valor=230'],
  ['alterar alguma coisa', 'editar_ajuda'],
];

const resumo = (r: any): string => {
  switch (r.tipo) {
    case 'lancar': return 'lancar ' + r.lancs.map((l: any) => `${l.tipo}|${l.descricao}|${l.categoria}|${l.valor}|${l.data}${l.duvida ? ' ?' + l.duvida : ''}`).join(' ; ');
    case 'conta': return `conta ${r.conta.nome}|${r.conta.categoria}|${r.conta.valor}|${r.conta.dia}|${r.conta.tipo}`;
    case 'perguntar': return `perguntar ${r.falta} ${r.rotulo}`;
    case 'pagar': return `pagar ${r.busca} ${r.valor}`;
    case 'resumo': return `resumo ${r.periodo}`;
    case 'editar_ultimo': return 'editar_ultimo ' + ['valor', 'desc', 'cat', 'data'].filter(k => r[k] != null).map(k => `${k}=${r[k]}`).join(' ');
    case 'editar_conta': return `editar_conta alvo=${r.alvo} ` + ['nome', 'valor', 'dia'].filter(k => r[k] != null).map(k => `${k}=${r[k]}`).join(' ');
    default: return r.tipo;
  }
};

let falhas = 0;
for (const [frase, esperado] of casos) {
  const obtido = resumo(entender(frase, H, cats, dic));
  if (obtido !== esperado) { falhas++; console.log(`✗ ${JSON.stringify(frase)}\n    esperado: ${esperado}\n    obtido:   ${obtido}`); }
}
const extras: [unknown, unknown][] = [
  [completarPendente({ texto: 'add conta de luz', falta: 'valor' }, '180'), 'add conta de luz 180'],
  [completarPendente({ texto: 'luz 180 vence', falta: 'dia' }, '20'), 'luz 180 vence dia 20'],
  [completarPendente({ texto: 'add conta de luz', falta: 'valor' }, 'foi 200 , vai vencer dia 20 /11'), 'add conta de luz foi 200 , vai vencer dia 20 /11'],
  [completarPendente({ texto: 'add conta de luz', falta: 'valor' }, 'mercado 50'), null],
  [acharConta('luz', [{ id: '1', nome: 'Conta de luz', mes: '2026-11-01', falta: 180 }, { id: '2', nome: 'Água', mes: '2026-11-01', falta: 80 }]).map(x => x.nome).join(), 'Conta de luz'],
];
for (const [obt, esp] of extras) if (obt !== esp) { falhas++; console.log(`✗ extra: esperado ${esp} · obtido ${obt}`); }
console.log(`testes: ${casos.length + extras.length} | falhas: ${falhas}`);
if (falhas) (globalThis as any).process?.exit(1);
