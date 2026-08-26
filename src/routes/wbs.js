const express = require('express');
const PDFDocument = require('pdfkit');
const { pool } = require('../db');
const { requireAdminIfSetting } = require('../adminAuth');
const { registrarAuditoria } = require('../audit');
const { renderWbsPdf } = require('../wbsPdf');
const { calcularPrioridades } = require('../wbsPrioridade');
const router = express.Router({ mergeParams: true });

function getAutor(req) {
  return req.header('x-autor') || 'anônimo';
}

function buildTree(rows) {
  const byId = {};
  rows.forEach(r => { byId[r.id] = { ...r, filhos: [] }; });
  const roots = [];
  rows.forEach(r => {
    if (r.parent_id && byId[r.parent_id]) {
      byId[r.parent_id].filhos.push(byId[r.id]);
    } else {
      roots.push(byId[r.id]);
    }
  });
  function sortRec(list) {
    list.sort((a, b) => a.ordem - b.ordem);
    list.forEach(n => sortRec(n.filhos));
  }
  sortRec(roots);
  function numerar(list, prefixo) {
    list.forEach((n, i) => {
      n.numero = prefixo ? `${prefixo}.${i + 1}` : `${i + 1}`;
      numerar(n.filhos, n.numero);
    });
  }
  numerar(roots, '');
  return roots;
}

function buildStats(rows) {
  const contagem = {};
  rows.forEach(r => { contagem[r.status] = (contagem[r.status] || 0) + 1; });
  const total = rows.length;
  return Object.entries(contagem).map(([status, count]) => ({
    status,
    count,
    percent: total ? Math.round((count / total) * 1000) / 10 : 0,
  }));
}

// conta quantos itens-folha (sem sub-itens) ainda nao tem impacto/esforco preenchidos
function contarPendentesPriorizacao(tree) {
  let count = 0;
  function visitar(nos) {
    nos.forEach(n => {
      if (n.temNotaPropria && n.criticidade === 'AVALIAR') count++;
      visitar(n.filhos);
    });
  }
  visitar(tree);
  return count;
}

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM wbs_items WHERE project_id = $1 ORDER BY ordem', [req.params.id]);
  const tree = buildTree(rows);
  tree.forEach(calcularPrioridades);
  res.json({
    tree,
    stats: buildStats(rows),
    total: rows.length,
    prioridadePendente: contarPendentesPriorizacao(tree),
  });
});

router.get('/pdf', async (req, res) => {
  const { rows: projRows } = await pool.query(`
    SELECT p.*, g.nome AS gerente_nome, c.nome AS cliente_nome
    FROM projects p
    LEFT JOIN gps g ON g.id = p.gp_id
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE p.id = $1
  `, [req.params.id]);
  const project = projRows[0];
  if (!project) return res.status(404).json({ error: 'projeto nao encontrado' });

  const { rows } = await pool.query('SELECT * FROM wbs_items WHERE project_id = $1 ORDER BY ordem', [req.params.id]);
  const tree = buildTree(rows);
  const stats = buildStats(rows);

  const nomeArquivo = `WBS-${(project.chamado || project.nome).replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  doc.pipe(res);
  try {
    renderWbsPdf(doc, { project, tree, stats, total: rows.length });
  } catch (e) {
    console.error('[wbs-pdf] falha ao gerar PDF:', e.message);
  }
  doc.end();
});

router.post('/', requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const { parent_id, titulo, area, acao, responsavel, status, data_inicio, data_fim, observacao, impacto, esforco, horas_esforco } = req.body;
  if (!titulo || !titulo.trim()) return res.status(400).json({ error: 'titulo obrigatorio' });

  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(ordem), -1) AS maxordem FROM wbs_items WHERE project_id = $1 AND parent_id IS NOT DISTINCT FROM $2',
    [req.params.id, parent_id || null]
  );
  const ordem = maxRows[0].maxordem + 1;

  const { rows } = await pool.query(
    `INSERT INTO wbs_items (project_id, parent_id, titulo, area, acao, responsavel, status, data_inicio, data_fim, observacao, ordem, impacto, esforco, horas_esforco)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
    [req.params.id, parent_id || null, titulo.trim(), area || '', acao || '', responsavel || '', status || 'Pendente', data_inicio || null, data_fim || null, observacao || '', ordem, impacto || 0, esforco || 0, horas_esforco || 0]
  );

  await registrarAuditoria({
    entidade: 'wbs_item', entidade_id: rows[0].id, projeto_id: Number(req.params.id),
    acao: 'criado', autor: getAutor(req), detalhes: `Item WBS "${titulo.trim()}" criado`,
    envolve_data: !!(data_inicio || data_fim),
  });

  res.status(201).json(rows[0]);
});

// ---------- modelos reutilizaveis de WBS ----------

// busca a subarvore de wbs_items a partir de uma lista de linhas de um projeto (ja em memoria)
function subarvoreDe(rows, parentId) {
  return rows
    .filter(r => r.parent_id === parentId)
    .sort((a, b) => a.ordem - b.ordem)
    .map(r => ({ ...r, filhos: subarvoreDe(rows, r.id) }));
}

router.post('/salvar-modelo', requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const { nome } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'nome do modelo obrigatorio' });

  const { rows } = await pool.query('SELECT * FROM wbs_items WHERE project_id = $1 ORDER BY ordem', [req.params.id]);
  if (rows.length === 0) return res.status(400).json({ error: 'esse projeto ainda nao tem itens de WBS para salvar como modelo' });

  const arvore = subarvoreDe(rows, null);

  const { rows: tplRows } = await pool.query('INSERT INTO wbs_templates (nome) VALUES ($1) RETURNING id', [nome.trim()]);
  const templateId = tplRows[0].id;

  async function inserirNoModelo(item, parentId, ordem) {
    const { rows: r } = await pool.query(
      'INSERT INTO wbs_template_items (template_id, parent_id, titulo, area, acao, ordem) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [templateId, parentId, item.titulo, item.area, item.acao, ordem]
    );
    let i = 0;
    for (const filho of item.filhos) {
      await inserirNoModelo(filho, r[0].id, i);
      i++;
    }
  }
  let i = 0;
  for (const raiz of arvore) {
    await inserirNoModelo(raiz, null, i);
    i++;
  }

  await registrarAuditoria({
    entidade: 'wbs_template', entidade_id: templateId, projeto_id: Number(req.params.id),
    acao: 'criado', autor: getAutor(req), detalhes: `Modelo de WBS "${nome.trim()}" salvo a partir deste projeto (${rows.length} item(ns))`,
  });

  res.status(201).json({ id: templateId, nome: nome.trim() });
});

router.post('/aplicar-modelo', requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const { template_id } = req.body;
  if (!template_id) return res.status(400).json({ error: 'template_id obrigatorio' });

  const { rows: itensModelo } = await pool.query('SELECT * FROM wbs_template_items WHERE template_id = $1 ORDER BY ordem', [template_id]);
  if (itensModelo.length === 0) return res.status(404).json({ error: 'modelo nao encontrado ou vazio' });

  const arvore = subarvoreDe(itensModelo, null);

  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(ordem), -1) AS maxordem FROM wbs_items WHERE project_id = $1 AND parent_id IS NULL',
    [req.params.id]
  );
  let proximaOrdem = maxRows[0].maxordem + 1;

  async function inserirNoProjeto(item, parentId, ordem) {
    const { rows: r } = await pool.query(
      `INSERT INTO wbs_items (project_id, parent_id, titulo, area, acao, status, ordem)
       VALUES ($1, $2, $3, $4, $5, 'Pendente', $6) RETURNING id`,
      [req.params.id, parentId, item.titulo, item.area, item.acao, ordem]
    );
    let i = 0;
    for (const filho of item.filhos) {
      await inserirNoProjeto(filho, r[0].id, i);
      i++;
    }
  }
  for (const raiz of arvore) {
    await inserirNoProjeto(raiz, null, proximaOrdem);
    proximaOrdem++;
  }

  await registrarAuditoria({
    entidade: 'wbs_item', projeto_id: Number(req.params.id),
    acao: 'criado', autor: getAutor(req), detalhes: `Modelo de WBS aplicado a este projeto (${itensModelo.length} item(ns) adicionados)`,
  });

  res.json({ ok: true, itensAdicionados: itensModelo.length });
});

module.exports = router;

// ---------- importar WBS de uma planilha (.xlsx) ----------
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lerPlanilhaWbs, reconstruirHierarquia } = require('../wbsImportar');

const uploadWbs = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB e mais que suficiente pra uma WBS
});

// So le e devolve uma previa (arvore reconstruida) - nao cria nada no banco ainda.
// A pessoa confere/ajusta na tela antes de confirmar de verdade.
router.post('/importar-preview', requireAdminIfSetting('restringir_edicao_prazos'), uploadWbs.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'nenhum arquivo enviado' });
  try {
    const linhas = await lerPlanilhaWbs(req.file.path);
    const { itens, avisos } = reconstruirHierarquia(linhas);
    res.json({ itens, avisos });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// Cria de verdade os itens da previa (ja revisada/ajustada pela pessoa, se precisou).
// Cria pai antes de filho, respeitando a hierarquia (tempId/paiTempId vindos da previa).
router.post('/importar-confirmar', requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const { itens } = req.body;
  if (!Array.isArray(itens) || itens.length === 0) return res.status(400).json({ error: 'nenhum item pra importar' });

  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(ordem), -1) AS maxordem FROM wbs_items WHERE project_id = $1 AND parent_id IS NULL',
    [req.params.id]
  );
  let ordemRaiz = maxRows[0].maxordem + 1;

  const idReal = {}; // tempId (da previa) -> id de verdade no banco
  let criados = 0;

  // ordena pra garantir que todo pai e processado antes dos filhos, mesmo que a
  // lista venha fora de ordem (segue a mesma logica de "sem pai primeiro")
  const pendentes = [...itens];
  const processados = new Set();
  let progresso = true;
  while (pendentes.length > 0 && progresso) {
    progresso = false;
    for (let i = pendentes.length - 1; i >= 0; i--) {
      const item = pendentes[i];
      const paiPronto = item.paiTempId === null || item.paiTempId === undefined || idReal[item.paiTempId] !== undefined;
      if (!paiPronto) continue;

      const parentIdReal = item.paiTempId !== null && item.paiTempId !== undefined ? idReal[item.paiTempId] : null;
      const ordem = parentIdReal === null ? ordemRaiz++ : 0;

      const { rows } = await pool.query(
        `INSERT INTO wbs_items (project_id, parent_id, titulo, status, data_inicio, data_fim, horas_esforco, ordem)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [req.params.id, parentIdReal, item.titulo, item.status || 'Pendente', item.data_inicio || null, item.data_fim || null, item.esforco || 0, ordem]
      );
      idReal[item.tempId] = rows[0].id;
      criados++;
      pendentes.splice(i, 1);
      progresso = true;
    }
  }

  if (pendentes.length > 0) {
    // sobrou algum item cujo "pai" nao existe na lista (referencia quebrada) -
    // insere como item de primeiro nivel, pra nao perder o dado
    for (const item of pendentes) {
      const { rows } = await pool.query(
        `INSERT INTO wbs_items (project_id, parent_id, titulo, status, data_inicio, data_fim, horas_esforco, ordem)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.params.id, item.titulo, item.status || 'Pendente', item.data_inicio || null, item.data_fim || null, item.esforco || 0, ordemRaiz++]
      );
      idReal[item.tempId] = rows[0].id;
      criados++;
    }
  }

  await registrarAuditoria({
    entidade: 'wbs_item', projeto_id: Number(req.params.id),
    acao: 'criado', autor: getAutor(req), detalhes: `WBS importada de planilha (${criados} item(ns) criados)`,
  });

  res.json({ ok: true, itensCriados: criados });
});

module.exports = router;
