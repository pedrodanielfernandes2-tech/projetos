const express = require('express');
const { pool } = require('../db');
const { requireAdminAlways } = require('../adminAuth');
const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT nome FROM areas ORDER BY nome');
  res.json(rows.map(r => r.nome));
});

router.post('/', requireAdminAlways, async (req, res) => {
  const { nome } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'nome da area obrigatorio' });
  try {
    const { rows } = await pool.query('INSERT INTO areas (nome) VALUES ($1) RETURNING id, nome', [nome.trim()]);
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(400).json({ error: 'ja existe uma area com esse nome' });
  }
});

router.delete('/:nome', requireAdminAlways, async (req, res) => {
  const nome = decodeURIComponent(req.params.nome);
  const { rows: taskRows } = await pool.query('SELECT COUNT(*)::int AS n FROM area_tasks WHERE area = $1', [nome]);
  if (taskRows[0].n > 0) {
    return res.status(400).json({ error: 'essa area esta em uso por projetos e nao pode ser removida' });
  }
  await pool.query('DELETE FROM areas WHERE nome = $1', [nome]);
  res.json({ ok: true });
});

module.exports = router;
