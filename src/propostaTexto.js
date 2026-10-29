// Utilitarios de texto da Proposta Comercial: valor por extenso (pt-BR), datas e
// texto de pagamento. Usado tanto pelo gerador de Word (.docx) quanto pelo de PDF.

const UNID = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze',
  'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENT = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function ate999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100;
  const partes = [];
  if (c) partes.push(CENT[c]);
  if (r) {
    if (r < 20) partes.push(UNID[r]);
    else {
      const d = Math.floor(r / 10), u = r % 10;
      partes.push(u ? `${DEZ[d]} e ${UNID[u]}` : DEZ[d]);
    }
  }
  return partes.join(' e ');
}

function inteiroPorExtenso(n) {
  n = Math.floor(n);
  if (n === 0) return 'zero';
  const milhoes = Math.floor(n / 1e6), milhares = Math.floor((n % 1e6) / 1e3), resto = n % 1e3;
  const partes = [];
  if (milhoes) partes.push(milhoes === 1 ? 'um milhão' : `${ate999(milhoes)} milhões`);
  if (milhares) partes.push(milhares === 1 ? 'mil' : `${ate999(milhares)} mil`);
  if (resto) partes.push(ate999(resto));
  // conector "e": entre os blocos quando o ultimo bloco e < 100 ou centena exata
  let out = partes[0];
  for (let i = 1; i < partes.length; i++) {
    const ultimo = i === partes.length - 1;
    const usaE = ultimo && (resto < 100 || resto % 100 === 0);
    out += (usaE ? ' e ' : ' ') + partes[i];
  }
  return out;
}

// Devolve { inicio, final } para encaixar no modelo: "(<inicio> <final>)".
// Ex.: 11731.68 -> inicio "onze mil setecentos e trinta e um", final "reais e sessenta e oito centavos".
function valorPorExtenso(valor) {
  const cents = Math.round(Number(valor || 0) * 100);
  const reais = Math.floor(cents / 100), cent = cents % 100;
  const inicio = inteiroPorExtenso(reais);
  const moeda = reais === 1 ? 'real' : (reais !== 0 && reais % 1e6 === 0 ? 'de reais' : 'reais');
  let final = moeda;
  if (cent) final += ` e ${inteiroPorExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`;
  return { inicio, final, completo: `${inicio} ${final}` };
}

function moedaBR(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function partesData(v) {
  if (!v) return null;
  const s = (v instanceof Date) ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const [a, m, d] = s.split('-').map(Number);
  if (!a || !m || !d) return null;
  return { ano: a, mes: m, dia: d };
}
function dataBR(v) {
  const p = partesData(v);
  if (!p) return '';
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${p.ano}`;
}

function textoPagamento(parcelas, diasPrimeira, intervalo) {
  const n = Number(parcelas) || 1;
  const d1 = Number(diasPrimeira) || 15;
  const iv = Number(intervalo) || 30;
  if (n <= 1) {
    return `Em prol da parceria entre as empresas, a Visual Mix disponibiliza o pagamento do total do projeto em parcela única, com vencimento em ${d1} dias após o aceite da proposta e respectivo faturamento.`;
  }
  const base = `Em prol da parceria entre as empresas, a Visual Mix disponibiliza o parcelamento do total do projeto em ${n} vezes sem juros, sendo a primeira parcela em ${d1} dias após o aceite da proposta e respectivo faturamento`;
  if (n === 2) return `${base} e a segunda em ${iv} dias.`;
  return `${base} e as parcelas subsequentes em intervalos de ${iv} dias.`;
}

// Mesmas frases do modelo, com os dados do chamado preenchidos.
function textoPrazo(d) {
  const ap = partesData(d.aprovado_ate), ini = partesData(d.inicio_previsto);
  const aprovado = ap ? `${String(ap.dia).padStart(2, '0')}/${String(ap.mes).padStart(2, '0')}` : '__/__';
  const inicio = ini ? `${ini.dia} de ${MESES[ini.mes - 1]} de ${ini.ano}` : '__ de ______ de ____';
  return { aprovado, inicio, ap, ini };
}

module.exports = { valorPorExtenso, inteiroPorExtenso, moedaBR, dataBR, partesData, textoPagamento, textoPrazo, MESES };
