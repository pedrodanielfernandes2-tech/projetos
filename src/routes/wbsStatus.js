const express = require('express');
const { pool } = require('../db');
const { requireAdminAlways } = require('../adminAuth');
const { registrarAuditoria } = require('../audit');
const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT nome FROM wbs_status ORDER BY ordem, id');
  res.json(rows.map(r => r.nome));
});

router.post('/', requireAdminAlways, async (req, res) => {
  const { nome } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'nome do status obrigatorio' });
  try {
    const { rows: maxRows } = await pool.query('SELECT COALESCE(MAX(ordem), -1) AS maxordem FROM wbs_status');
    const ordem = maxRows[0].maxordem + 1;
    const { rows } = await pool.query('INSERT INTO wbs_status (nome, ordem) VALUES ($1, $2) RETURNING id, nome', [nome.trim(), ordem]);
    await registrarAuditoria({
      entidade: 'wbs_status', entidade_id: rows[0].id, acao: 'criado',
      autor: req.header('x-autor') || 'anônimo', detalhes: `Status de WBS "${nome.trim()}" cadastrado`,
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(400).json({ error: 'ja existe um status com esse nome' });
  }
});

router.delete('/:nome', requireAdminAlways, async (req, res) => {
  const nome = decodeURIComponent(req.params.nome);
  const { rows: itemRows } = await pool.query('SELECT COUNT(*)::int AS n FROM wbs_items WHERE status = $1', [nome]);
  if (itemRows[0].n > 0) {
    return res.status(400).json({ error: 'esse status esta em uso por itens de WBS e nao pode ser removido' });
  }
  await pool.query('DELETE FROM wbs_status WHERE nome = $1', [nome]);
  await registrarAuditoria({
    entidade: 'wbs_status', acao: 'excluido',
    autor: req.header('x-autor') || 'anônimo', detalhes: `Status de WBS "${nome}" removido`,
  });
  res.json({ ok: true });
});

module.exports = router;
