const ExcelJS = require('exceljs');

// Converte um numero serial do Excel (dias desde 1899-12-30, com o "bug" do ano
// bissexto 1900 ja embutido na formula) numa data ISO (YYYY-MM-DD), ignorando a
// hora (o sistema so guarda data).
function excelSerialParaIso(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  const numero = Number(valor);
  if (isNaN(numero)) return null;
  const ms = Math.round((numero - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

// Extrai o numero de um texto tipo "432 horas" ou "8,5 horas" (virgula decimal).
function parseEsforco(valor) {
  if (valor === null || valor === undefined) return 0;
  const texto = String(valor).replace(/horas?/i, '').replace(',', '.').trim();
  const numero = parseFloat(texto);
  return isNaN(numero) ? 0 : numero;
}

const STATUS_VALIDOS_MAP = {
  'concluído': 'Concluído',
  'concluido': 'Concluído',
  'em andamento': 'Em Andamento',
  'pendente': 'Pendente',
  'cancelado': 'Suspensa',
  'suspensa': 'Suspensa',
  'bloqueado': 'Suspensa',
};
function mapearStatus(valorOriginal) {
  if (!valorOriginal) return 'Pendente';
  const chave = String(valorOriginal).trim().toLowerCase();
  return STATUS_VALIDOS_MAP[chave] || 'Pendente';
}

const MARCADOR_GRUPO = 'pacote de trabalho';

// Le a planilha em modo streaming (mais tolerante com arquivos grandes/com recursos
// nao suportados, tipo validacao de dados avancada, que travam o leitor normal por
// falta de memoria). Procura a aba que tenha as colunas esperadas, sem depender de
// um nome fixo de aba - exports diferentes podem nomear a aba de forma diferente.
async function lerPlanilhaWbs(caminhoArquivo) {
  const wbReader = new ExcelJS.stream.xlsx.WorkbookReader(caminhoArquivo, {});
  let linhasBrutas = null;

  for await (const sheet of wbReader) {
    const linhas = [];
    for await (const row of sheet) {
      linhas.push(row.values);
    }
    const temCabecalho = linhas.some(v =>
      Array.isArray(v) &&
      v.some(c => String(c || '').trim().toLowerCase() === 'atividade') &&
      v.some(c => String(c || '').trim().toLowerCase().startsWith('esforço'))
    );
    if (temCabecalho) { linhasBrutas = linhas; break; }
  }

  if (!linhasBrutas) {
    const erro = new Error('Não encontrei uma aba com as colunas esperadas (Atividade, Esforço, Início, Fim, Status). Confira o arquivo.');
    erro.status = 400;
    throw erro;
  }

  const idxCabecalho = linhasBrutas.findIndex(v =>
    Array.isArray(v) && v.some(c => String(c || '').trim().toLowerCase() === 'atividade')
  );
  const cabecalho = linhasBrutas[idxCabecalho];
  const norm = (c) => String(c || '').trim().toLowerCase();
  const colAtividade = cabecalho.findIndex(c => norm(c) === 'atividade');
  const colEsforco = cabecalho.findIndex(c => norm(c).startsWith('esforço') || norm(c).startsWith('esforco'));
  const colInicio = cabecalho.findIndex(c => norm(c) === 'início' || norm(c) === 'inicio');
  const colFim = cabecalho.findIndex(c => norm(c) === 'fim');
  const colStatus = cabecalho.findIndex(c => norm(c) === 'status');

  if (colAtividade === -1 || colEsforco === -1) {
    const erro = new Error('Não encontrei as colunas "Atividade" e "Esforço" na planilha.');
    erro.status = 400;
    throw erro;
  }

  return linhasBrutas.slice(idxCabecalho + 1)
    .map((v) => {
      if (!Array.isArray(v)) return null;
      const titulo = v[colAtividade];
      if (!titulo || !String(titulo).trim()) return null;
      return {
        titulo: String(titulo).trim(),
        esforco: parseEsforco(v[colEsforco]),
        data_inicio: colInicio !== -1 ? excelSerialParaIso(v[colInicio]) : null,
        data_fim: colFim !== -1 ? excelSerialParaIso(v[colFim]) : null,
        statusOriginal: colStatus !== -1 ? v[colStatus] : null,
      };
    })
    .filter(Boolean);
}

// Reconstroi a hierarquia usando o criterio de "soma das horas dos itens de baixo
// bate com o total do grupo" - grupos sao linhas marcadas "Pacote de Trabalho" na
// coluna Status. A primeira linha, quando e um grupo, e tratada como a "capa" do
// projeto inteiro e descartada (os itens logo abaixo dela viram itens de primeiro
// nivel), ja que o projeto em si ja existe como entidade propria no sistema.
function reconstruirHierarquia(linhas) {
  const avisos = [];
  const itens = [];
  const pilha = []; // cada item: { tempId (ou null pra "capa"), total, acumulado, titulo }
  let proximoId = 1;

  linhas.forEach((linha, idx) => {
    const ehGrupo = String(linha.statusOriginal || '').trim().toLowerCase() === MARCADOR_GRUPO;
    const pularComoCapa = idx === 0 && ehGrupo;

    const paiTempId = pilha.length > 0 ? pilha[pilha.length - 1].tempId : null;
    const tempId = proximoId++;

    if (!pularComoCapa) {
      itens.push({
        tempId,
        paiTempId,
        titulo: linha.titulo,
        esforco: linha.esforco,
        data_inicio: linha.data_inicio,
        data_fim: linha.data_fim,
        status: ehGrupo ? 'Pendente' : mapearStatus(linha.statusOriginal),
        ehGrupo,
      });
    }

    pilha.forEach((p) => { p.acumulado += linha.esforco; });

    if (ehGrupo) {
      pilha.push({ tempId: pularComoCapa ? null : tempId, total: linha.esforco, acumulado: 0, titulo: linha.titulo });
    }

    while (pilha.length > 0 && Math.abs(pilha[pilha.length - 1].acumulado - pilha[pilha.length - 1].total) < 0.01) {
      pilha.pop();
    }
  });

  pilha.forEach((p) => {
    if (p.tempId !== null) {
      avisos.push(`O grupo "${p.titulo}" não fechou certinho (soma ${p.acumulado}h dentro dele, mas o total declarado era ${p.total}h) — confira a hierarquia antes de confirmar.`);
    }
  });

  return { itens, avisos };
}

module.exports = { lerPlanilhaWbs, reconstruirHierarquia, excelSerialParaIso, parseEsforco, mapearStatus };
