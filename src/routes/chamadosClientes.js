const express = require('express');
const { pool } = require('../db');
const { requireChamadosAuth } = require('../chamadosAuth');
const router = express.Router();

router.get('/', requireChamadosAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, nome FROM chamados_clientes ORDER BY nome');
  res.json(rows);
});

router.post('/', requireChamadosAuth, async (req, res) => {
  const { nome } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'nome obrigatorio' });
  const { rows } = await pool.query(
    'INSERT INTO chamados_clientes (nome) VALUES ($1) RETURNING id, nome',
    [nome.trim()]
  );
  res.status(201).json(rows);
});

module.exports = router;
