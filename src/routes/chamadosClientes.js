const express = require('express');
const { pool } = require('../db');
const { requireChamadosAuth } = require('../chamadosAuth');
const router = express.Router();

router.get('/', requireChamadosAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, nome, ativo FROM chamados_clientes ORDER BY nome');
  res.json(rows);
});

router.post('/', requireChamadosAuth, async (req, res) => {
  const { nome, ativo } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'nome obrigatorio' });
  const { rows } = await pool.query(
    'INSERT INTO chamados_clientes (nome, ativo) VALUES ($1, $2) RETURNING id, nome, ativo',
    [nome.trim(), ativo !== false]
  );
  res.status(201).json(rows);
});

module.exports = router;
