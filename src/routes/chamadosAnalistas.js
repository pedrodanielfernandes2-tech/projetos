const express = require('express');
const { pool } = require('../chamadosDb');
const { requireChamadosAuth } = require('../chamadosAuth');
const router = express.Router();

router.use(requireChamadosAuth);

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, nome, ativo FROM analistas ORDER BY nome ASC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'falha ao buscar analistas: ' + e.message });
  }
});

router.post('/', async (req, res) => {
  const { nome, ativo } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'nome obrigatorio' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO analistas (nome, ativo) VALUES ($1, $2) RETURNING *',
      [nome.trim(), ativo !== false]
    );
    res.status(201).json(rows);
  } catch (e) {
    res.status(400).json({ error: 'ja existe um analista com esse nome' });
  }
});

router.patch('/:id', async (req, res) => {
  const { ativo } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE analistas SET ativo = $1 WHERE id = $2 RETURNING *',
      [!!ativo, req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'falha ao atualizar analista: ' + e.message });
  }
});

module.exports = router;
