const express = require('express');
const { pool } = require('../db');
const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM clientes ORDER BY nome');
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { nome } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'nome do cliente obrigatorio' });
  try {
    const { rows } = await pool.query('INSERT INTO clientes (nome) VALUES ($1) RETURNING *', [nome.trim()]);
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(400).json({ error: 'ja existe um cliente com esse nome' });
  }
});

router.delete('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM projects WHERE cliente_id = $1', [req.params.id]);
  if (rows[0].n > 0) {
    return res.status(400).json({ error: 'esse cliente esta vinculado a projetos e nao pode ser removido' });
  }
  await pool.query('DELETE FROM clientes WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
