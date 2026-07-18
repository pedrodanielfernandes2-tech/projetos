const express = require('express');
const { pool } = require('../db');
const { requireAdminAlways } = require('../adminAuth');
const { registrarAuditoria } = require('../audit');
const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT nome FROM acoes ORDER BY nome');
  res.json(rows.map(r => r.nome));
});

router.post('/', requireAdminAlways, async (req, res) => {
  const { nome } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'nome da acao obrigatorio' });
  try {
    const { rows } = await pool.query('INSERT INTO acoes (nome) VALUES ($1) RETURNING id, nome', [nome.trim()]);
    await registrarAuditoria({
      entidade: 'acao', entidade_id: rows[0].id, acao: 'criado',
      autor: req.header('x-autor') || 'anônimo', detalhes: `Ação "${nome.trim()}" cadastrada`,
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(400).json({ error: 'ja existe uma acao com esse nome' });
  }
});

router.delete('/:nome', requireAdminAlways, async (req, res) => {
  const nome = decodeURIComponent(req.params.nome);
  const { rows: usoRows } = await pool.query('SELECT COUNT(*)::int AS n FROM wbs_items WHERE acao = $1', [nome]);
  if (usoRows[0].n > 0) {
    return res.status(400).json({ error: 'essa acao esta em uso em itens de WBS e nao pode ser removida' });
  }
  await pool.query('DELETE FROM acoes WHERE nome = $1', [nome]);
  await registrarAuditoria({
    entidade: 'acao', acao: 'excluido',
    autor: req.header('x-autor') || 'anônimo', detalhes: `Ação "${nome}" removida`,
  });
  res.json({ ok: true });
});

module.exports = router;
