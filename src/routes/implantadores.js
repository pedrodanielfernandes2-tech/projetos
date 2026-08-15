const express = require('express');
const { pool } = require('../db');
const { requireAdminAlways } = require('../adminAuth');
const { registrarAuditoria } = require('../audit');
const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM implantadores ORDER BY nome');
  res.json(rows);
});

router.post('/', requireAdminAlways, async (req, res) => {
  const { nome } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'nome obrigatorio' });
  const { rows } = await pool.query(
    'INSERT INTO implantadores (nome) VALUES ($1) RETURNING *',
    [nome.trim()]
  );
  await registrarAuditoria({
    entidade: 'implantador', entidade_id: rows[0].id, acao: 'criado',
    autor: req.header('x-autor') || 'anônimo', detalhes: `Implantador "${nome.trim()}" cadastrado`,
  });
  res.status(201).json(rows[0]);
});

router.put('/:id', requireAdminAlways, async (req, res) => {
  const { nome, ativo } = req.body;
  await pool.query('UPDATE implantadores SET nome = $1, ativo = $2 WHERE id = $3', [nome, ativo !== false, req.params.id]);
  res.json({ ok: true });
});

router.delete('/:id', requireAdminAlways, async (req, res) => {
  const implantador = (await pool.query('SELECT * FROM implantadores WHERE id = $1', [req.params.id])).rows[0];
  await pool.query('DELETE FROM implantadores WHERE id = $1', [req.params.id]);
  await registrarAuditoria({
    entidade: 'implantador', entidade_id: Number(req.params.id), acao: 'excluido',
    autor: req.header('x-autor') || 'anônimo', detalhes: implantador ? `Implantador "${implantador.nome}" removido` : 'Implantador removido',
  });
  res.json({ ok: true });
});

module.exports = router;
