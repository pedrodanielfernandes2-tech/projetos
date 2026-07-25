const express = require('express');
const { pool } = require('../chamadosDb');
const { requireChamadosAuth } = require('../chamadosAuth');
const router = express.Router();

router.use(requireChamadosAuth);

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, nome FROM clientes ORDER BY nome ASC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'falha ao buscar clientes: ' + e.message });
  }
});

router.post('/', async (req, res) => {
  const { nome } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'nome obrigatorio' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO clientes (nome) VALUES ($1) RETURNING *',
      [nome.trim()]
    );
    res.status(201).json(rows);
  } catch (e) {
    res.status(400).json({ error: 'ja existe um cliente com esse nome' });
  }
});

module.exports = router;
