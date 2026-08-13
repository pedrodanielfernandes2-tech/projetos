// Replica exatamente a logica de calculo que ja existia no chamados.html
// (arredondamento ABNT NBR 5891 + formula de valor do projeto).

// Quando o algarismo a descartar e exatamente 5 (sem mais nada depois),
// arredonda para o numero par mais proximo; senao, segue a regra comum.
function arredondarABNT(valor, casas = 1) {
  if (valor === null || valor === undefined || isNaN(valor)) return valor;
  const fator = Math.pow(10, casas);
  const numero = valor * fator;
  const piso = Math.floor(numero);
  const diferenca = numero - piso;
  const EPS = 1e-9;
  let resultado;
  if (diferenca > 0.5 + EPS) {
    resultado = piso + 1;
  } else if (diferenca < 0.5 - EPS) {
    resultado = piso;
  } else {
    resultado = piso % 2 === 0 ? piso : piso + 1;
  }
  return resultado / fator;
}

function calcularChamado({ horasDev, pctMargem, pctNegociado, pctQaAplicado, pctGerencialAplicado, valorHoraAplicado }) {
  const dev = Number(horasDev) || 0;
  const pctQA = Number(pctQaAplicado) || 0;
  const pctGerencial = Number(pctGerencialAplicado) || 0;
  const valorHora = Number(valorHoraAplicado) || 0;

  const qa = arredondarABNT(dev * pctQA, 0);
  const gerencial = arredondarABNT(dev * pctGerencial, 0);
  const totalHoras = arredondarABNT(dev + qa + gerencial, 0);
  const horasMargem = arredondarABNT(totalHoras * (Number(pctMargem) || 0), 0);
  const totalGeral = arredondarABNT(totalHoras + horasMargem, 0);
  const valorProjeto = totalGeral * valorHora;
  const descontoNegociado = valorProjeto * (Number(pctNegociado) || 0);
  const valorTotalProjeto = valorProjeto - descontoNegociado;

  return {
    qa,
    gerencial,
    total_horas: totalHoras,
    horas_margem: horasMargem,
    total_geral: totalGeral,
    valor_projeto: valorProjeto,
    desconto_negociado: descontoNegociado,
    valor_total_projeto: valorTotalProjeto,
  };
}

// Modelo alternativo, pra clientes cuja negociacao e por papel/recurso (cada papel com
// seu proprio valor de hora), em vez de um unico valor de hora pra tudo. Sem calculo
// automatico de % de QA/Gerencial - as horas de cada papel (inclusive QA e Gerencial)
// sao informadas diretamente.
function calcularChamadoPorRecurso({ recursosHoras, pctMargem, pctNegociado }) {
  const valorBase = (recursosHoras || []).reduce(
    (soma, r) => soma + (Number(r.horas) || 0) * (Number(r.valor_hora) || 0),
    0
  );
  const valorProjeto = arredondarABNT(valorBase * (1 + (Number(pctMargem) || 0)), 2);
  const descontoNegociado = arredondarABNT(valorProjeto * (Number(pctNegociado) || 0), 2);
  const valorTotalProjeto = arredondarABNT(valorProjeto - descontoNegociado, 2);

  return {
    valor_base: valorBase,
    valor_projeto: valorProjeto,
    desconto_negociado: descontoNegociado,
    valor_total_projeto: valorTotalProjeto,
  };
}

// Modelo pra projetos com valor negociado fechado (ex: R$ 5.000,00), sem calculo nenhum
// em cima - nem % Margem, nem % Desconto Negociado. O valor informado JA e o valor final.
function calcularChamadoValorFixo({ valorFixo }) {
  const valor = Number(valorFixo) || 0;
  return {
    valor_base: valor,
    valor_projeto: valor,
    desconto_negociado: 0,
    valor_total_projeto: valor,
  };
}

module.exports = { arredondarABNT, calcularChamado, calcularChamadoPorRecurso, calcularChamadoValorFixo };
