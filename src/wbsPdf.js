const STATUS_COLORS = {
  'Pendente': { bg: '#FBEAE9', text: '#C4211F' },
  'Em Andamento': { bg: '#E5EEFA', text: '#1B63AC' },
  'Em Elaboração': { bg: '#FDF3E3', text: '#B7791F' },
  'Homolog./Cliente': { bg: '#FDEEDB', text: '#C2650C' },
  'Concluído': { bg: '#E4F7EC', text: '#1F9D55' },
  'Impasse': { bg: '#2A2A2A', text: '#FFFFFF' },
};
function corStatus(status) {
  return STATUS_COLORS[status] || { bg: '#EEF0F3', text: '#667085' };
}

function flatten(tree, depth = 0, out = []) {
  tree.forEach(item => {
    out.push({ ...item, depth });
    if (item.filhos && item.filhos.length > 0) flatten(item.filhos, depth + 1, out);
  });
  return out;
}

function fmtDataBR(d) {
  if (!d) return '-';
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
}

const MARGIN = 40;
const COLS = [
  { key: 'numero', label: 'Item', width: 32 },
  { key: 'titulo', label: 'Título', width: 148 },
  { key: 'area', label: 'Área', width: 55 },
  { key: 'acao', label: 'Ação', width: 62 },
  { key: 'responsavel', label: 'Responsável', width: 68 },
  { key: 'data_inicio', label: 'Início', width: 42 },
  { key: 'data_fim', label: 'Fim', width: 42 },
  { key: 'status', label: 'Status', width: 66 },
];
const CONTENT_WIDTH = COLS.reduce((s, c) => s + c.width, 0);

function colX(index) {
  let x = MARGIN;
  for (let i = 0; i < index; i++) x += COLS[i].width;
  return x;
}

function drawHeaderRow(doc, y) {
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#667085');
  COLS.forEach((col, i) => {
    doc.text(col.label.toUpperCase(), colX(i), y, { width: col.width - 4 });
  });
  doc.moveTo(MARGIN, y + 13).lineTo(MARGIN + CONTENT_WIDTH, y + 13)
    .strokeColor('#E2E7EF').lineWidth(0.5).stroke();
  return y + 19;
}

function renderWbsPdf(doc, { project, tree, stats, total }) {
  // ---------- cabecalho ----------
  doc.font('Helvetica-Bold').fontSize(17).fillColor('#1A2130').text(`WBS — ${project.nome}`, MARGIN, MARGIN, { width: CONTENT_WIDTH });

  doc.font('Helvetica').fontSize(9.5).fillColor('#667085');
  const infoLinhas = [
    project.chamado ? `Chamado ${project.chamado}` : null,
    project.cliente_nome ? `Cliente: ${project.cliente_nome}` : null,
    `GP: ${project.gerente_nome || '-'}`,
    `Gerado em ${new Date().toLocaleString('pt-BR')}`,
  ].filter(Boolean).join('   ·   ');
  doc.text(infoLinhas, MARGIN, doc.y + 4, { width: CONTENT_WIDTH });

  // ---------- resumo de status ----------
  let sy = doc.y + 18;
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#1A2130').text('Resumo', MARGIN, sy);
  sy += 16;
  let sx = MARGIN;
  const boxGap = 8;
  const boxW = 88;
  const boxH = 36;
  const itensResumo = [{ status: 'Total', count: total, percent: null }, ...stats];
  itensResumo.forEach(s => {
    if (sx + boxW > MARGIN + CONTENT_WIDTH) { sx = MARGIN; sy += boxH + boxGap; }
    const cor = s.status === 'Total' ? { bg: '#F5F8FC', text: '#1A2130' } : corStatus(s.status);
    doc.roundedRect(sx, sy, boxW - boxGap, boxH, 4).fill(cor.bg);
    doc.fillColor(cor.text).font('Helvetica-Bold').fontSize(14).text(String(s.count), sx + 8, sy + 6, { width: boxW - boxGap - 16 });
    doc.font('Helvetica').fontSize(7.5).text(
      s.percent !== null ? `${s.status} (${s.percent}%)` : s.status,
      sx + 8, sy + 23, { width: boxW - boxGap - 16 }
    );
    sx += boxW;
  });
  doc.y = sy + boxH + 22;

  // ---------- tabela ----------
  let y = drawHeaderRow(doc, doc.y);
  const flat = flatten(tree);

  if (flat.length === 0) {
    doc.font('Helvetica').fontSize(9).fillColor('#667085').text('Nenhum item cadastrado ainda.', MARGIN, y);
    return;
  }

  flat.forEach(item => {
    const tituloIndent = Math.min(item.depth * 8, 60);
    doc.font('Helvetica-Bold').fontSize(8);
    const alturaTitulo = doc.heightOfString(item.titulo, { width: COLS[1].width - 4 - tituloIndent });
    const rowH = Math.max(15, alturaTitulo + 3);

    if (y + rowH > doc.page.height - MARGIN) {
      doc.addPage();
      y = drawHeaderRow(doc, MARGIN);
    }

    doc.font('Helvetica').fontSize(7.5).fillColor('#1A2130');
    doc.text(item.numero, colX(0), y, { width: COLS[0].width - 4 });

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1A2130');
    doc.text(item.titulo, colX(1) + tituloIndent, y, { width: COLS[1].width - 4 - tituloIndent });

    doc.font('Helvetica').fontSize(7.5).fillColor('#667085');
    doc.text(item.area || '-', colX(2), y, { width: COLS[2].width - 4 });
    doc.text(item.acao || '-', colX(3), y, { width: COLS[3].width - 4 });
    doc.text(item.responsavel || '-', colX(4), y, { width: COLS[4].width - 4 });
    doc.text(fmtDataBR(item.data_inicio), colX(5), y, { width: COLS[5].width - 4 });
    doc.text(fmtDataBR(item.data_fim), colX(6), y, { width: COLS[6].width - 4 });

    const cor = corStatus(item.status);
    const statusW = COLS[7].width - 8;
    doc.roundedRect(colX(7), y - 1, statusW, 12, 3).fill(cor.bg);
    doc.fillColor(cor.text).font('Helvetica-Bold').fontSize(6.5).text(item.status, colX(7) + 3, y + 1.5, { width: statusW - 6 });

    y += rowH + 4;
  });
}

module.exports = { renderWbsPdf };
