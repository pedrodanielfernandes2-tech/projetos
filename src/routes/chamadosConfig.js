const express = require('express');
const { pool } = require('../chamadosDb');
const { requireChamadosAuth } = require('../chamadosAuth');
const router = express.Router();

router.use(requireChamadosAuth);

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM config_calculo WHERE vigente_ate IS NULL LIMIT 1'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'falha ao buscar configuracao: ' + e.message });
  }
});

router.patch('/:id', async (req, res) => {
  const { pct_qa, pct_gerencial, valor_hora } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE config_calculo SET pct_qa = $1, pct_gerencial = $2, valor_hora = $3 WHERE id = $4 RETURNING *',
      [pct_qa, pct_gerencial, valor_hora, req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'falha ao atualizar configuracao: ' + e.message });
  }
});

router.post('/', async (req, res) => {
  const { pct_qa, pct_gerencial, valor_hora } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO config_calculo (pct_qa, pct_gerencial, valor_hora, criado_por) VALUES ($1,$2,$3,$4) RETURNING *',
      [pct_qa, pct_gerencial, valor_hora, 'painel-unificado']
    );
    res.status(201).json(rows);
  } catch (e) {
    res.status(500).json({ error: 'falha ao criar configuracao: ' + e.message });
  }
});

module.exports = router;
