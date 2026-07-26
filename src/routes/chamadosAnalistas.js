const express = require('express');
const { pool } = require('../db');
const { requireChamadosAuth } = require('../chamadosAuth');
const router = express.Router();

router.get('/', requireChamadosAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, nome, ativo FROM chamados_analistas ORDER BY nome');
  res.json(rows);
});

router.post('/', requireChamadosAuth, async (req, res) => {
  const { nome, ativo } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'nome obrigatorio' });
  const { rows } = await pool.query(
    'INSERT INTO chamados_analistas (nome, ativo) VALUES ($1, $2) RETURNING id, nome, ativo',
    [nome.trim(), ativo !== false]
  );
  res.status(201).json(rows);
});

router.patch('/:id', requireChamadosAuth, async (req, res) => {
  const campos = [];
  const valores = [];
  let i = 1;
  if (req.body.nome !== undefined) { campos.push(`nome = $${i++}`); valores.push(req.body.nome); }
  if (req.body.ativo !== undefined) { campos.push(`ativo = $${i++}`); valores.push(req.body.ativo); }
  if (campos.length === 0) return res.json({ ok: true });
  valores.push(req.params.id);
  await pool.query(`UPDATE chamados_analistas SET ${campos.join(', ')} WHERE id = $${i}`, valores);
  res.json({ ok: true });
});

module.exports = router;
