// Logica de classificacao da matriz Impacto x Esforco, replicando as formulas
// da planilha de referencia (aba "Impacto x Esforço"):
//   nota = 0            -> "AVALIAR" (ainda nao avaliado)
//   nota >= 4            -> "ALTO"
//   nota >= 2            -> "MÉDIO"
//   0 < nota < 2          -> "BAIXO"

function classificar(nota) {
  const n = Number(nota) || 0;
  if (n === 0) return 'AVALIAR';
  if (n >= 4) return 'ALTO';
  if (n >= 2) return 'MÉDIO';
  return 'BAIXO';
}

const CRITICIDADE_MAP = {
  'ALTO-BAIXO': '1 - Faça agora mesmo!',
  'MÉDIO-BAIXO': '2 - Ganho rápido',
  'ALTO-MÉDIO': '3 - Iniciativa gratificante',
  'BAIXO-BAIXO': '4 - Tarefa pontual',
  'MÉDIO-MÉDIO': '5 - Considerar',
  'ALTO-ALTO': '6 - Projeto grande que vale a pena',
  'BAIXO-MÉDIO': '7 - Não vale a pena',
  'MÉDIO-ALTO': '8 - Não vale a pena',
  'BAIXO-ALTO': '9 - Perda de tempo! Nem considere',
};

function calcularCriticidade(impactoClass, esforcoClass) {
  if (impactoClass === 'AVALIAR' || esforcoClass === 'AVALIAR') return 'AVALIAR';
  return CRITICIDADE_MAP[`${impactoClass}-${esforcoClass}`] || 'AVALIAR';
}

// Preenche recursivamente, em cada no da arvore, os campos:
// impactoEfetivo/esforcoEfetivo (nota propria se for folha, ou media dos filhos se tiver),
// impactoClass/esforcoClass e criticidade.
function calcularPrioridades(node) {
  if (!node.filhos || node.filhos.length === 0) {
    node.impactoEfetivo = Number(node.impacto) || 0;
    node.esforcoEfetivo = Number(node.esforco) || 0;
    node.temNotaPropria = true;
  } else {
    node.filhos.forEach(calcularPrioridades);
    const impactos = node.filhos.map(f => f.impactoEfetivo);
    const esforcos = node.filhos.map(f => f.esforcoEfetivo);
    node.impactoEfetivo = impactos.reduce((a, b) => a + b, 0) / impactos.length;
    node.esforcoEfetivo = esforcos.reduce((a, b) => a + b, 0) / esforcos.length;
    node.temNotaPropria = false;
  }
  node.impactoClass = classificar(node.impactoEfetivo);
  node.esforcoClass = classificar(node.esforcoEfetivo);
  node.criticidade = calcularCriticidade(node.impactoClass, node.esforcoClass);
  return node;
}

module.exports = { classificar, calcularCriticidade, calcularPrioridades };
