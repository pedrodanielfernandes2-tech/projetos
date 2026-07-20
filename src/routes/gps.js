const express = require('express');
const { pool } = require('../db');
const { requireAdminAlways } = require('../adminAuth');
const { registrarAuditoria } = require('../audit');
const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM gps ORDER BY nome');
  res.json(rows);
});

router.post('/', requireAdminAlways, async (req, res) => {
  const { nome, email } = req.body;
  if (!nome || !email) {
    return res.status(400).json({ error: 'nome e email sao obrigatorios' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO gps (nome, email) VALUES ($1, $2) RETURNING *',
      [nome, email]
    );
    await registrarAuditoria({
      entidade: 'gp', entidade_id: rows[0].id, acao: 'criado',
      autor: req.header('x-autor') || 'anônimo', detalhes: `GP "${nome}" (${email}) cadastrado`,
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(400).json({ error: 'ja existe um GP com esse e-mail' });
  }
});

router.put('/:id', requireAdminAlways, async (req, res) => {
  const { nome, email } = req.body;
  await pool.query('UPDATE gps SET nome = $1, email = $2 WHERE id = $3', [nome, email, req.params.id]);
  res.json({ ok: true });
});

router.delete('/:id', requireAdminAlways, async (req, res) => {
  const gp = (await pool.query('SELECT * FROM gps WHERE id = $1', [req.params.id])).rows[0];
  await pool.query('DELETE FROM gps WHERE id = $1', [req.params.id]);
  await registrarAuditoria({
    entidade: 'gp', entidade_id: Number(req.params.id), acao: 'excluido',
    autor: req.header('x-autor') || 'anônimo', detalhes: gp ? `GP "${gp.nome}" removido` : 'GP removido',
  });
  res.json({ ok: true });
});

module.exports = router;
