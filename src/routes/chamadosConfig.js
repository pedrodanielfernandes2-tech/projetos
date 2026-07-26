const express = require('express');
const { pool } = require('../db');
const { requireChamadosAuth } = require('../chamadosAuth');
const router = express.Router();

router.get('/', requireChamadosAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM chamados_config WHERE vigente_ate IS NULL ORDER BY id DESC LIMIT 1'
  );
  res.json(rows);
});

router.post('/', requireChamadosAuth, async (req, res) => {
  const { pct_qa, pct_gerencial, valor_hora } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO chamados_config (pct_qa, pct_gerencial, valor_hora) VALUES ($1, $2, $3) RETURNING *',
    [pct_qa, pct_gerencial, valor_hora]
  );
  res.status(201).json(rows);
});

router.patch('/:id', requireChamadosAuth, async (req, res) => {
  const campos = [];
  const valores = [];
  let i = 1;
  ['pct_qa', 'pct_gerencial', 'valor_hora'].forEach(campo => {
    if (req.body[campo] !== undefined) { campos.push(`${campo} = $${i++}`); valores.push(req.body[campo]); }
  });
  if (campos.length === 0) return res.json({ ok: true });
  valores.push(req.params.id);
  await pool.query(`UPDATE chamados_config SET ${campos.join(', ')} WHERE id = $${i}`, valores);
  res.json({ ok: true });
});

module.exports = router;
