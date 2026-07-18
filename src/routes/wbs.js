const express = require('express');
const { pool } = require('../db');
const { requireAdminIfSetting } = require('../adminAuth');
const { registrarAuditoria } = require('../audit');
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

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM wbs_items WHERE project_id = $1 ORDER BY ordem', [req.params.id]);
  res.json({ tree: buildTree(rows), stats: buildStats(rows), total: rows.length });
});

router.post('/', requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const { parent_id, titulo, area, acao, responsavel, status, data_inicio, data_fim, observacao } = req.body;
  if (!titulo || !titulo.trim()) return res.status(400).json({ error: 'titulo obrigatorio' });

  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(ordem), -1) AS maxordem FROM wbs_items WHERE project_id = $1 AND parent_id IS NOT DISTINCT FROM $2',
    [req.params.id, parent_id || null]
  );
  const ordem = maxRows[0].maxordem + 1;

  const { rows } = await pool.query(
    `INSERT INTO wbs_items (project_id, parent_id, titulo, area, acao, responsavel, status, data_inicio, data_fim, observacao, ordem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [req.params.id, parent_id || null, titulo.trim(), area || '', acao || '', responsavel || '', status || 'Pendente', data_inicio || null, data_fim || null, observacao || '', ordem]
  );

  await registrarAuditoria({
    entidade: 'wbs_item', entidade_id: rows[0].id, projeto_id: Number(req.params.id),
    acao: 'criado', autor: getAutor(req), detalhes: `Item WBS "${titulo.trim()}" criado`,
    envolve_data: !!(data_inicio || data_fim),
  });

  res.status(201).json(rows[0]);
});

module.exports = router;
