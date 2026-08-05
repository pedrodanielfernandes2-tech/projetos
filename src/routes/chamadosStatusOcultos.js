const express = require('express');
const { pool } = require('../db');
const { requireChamadosAuth } = require('../chamadosAuth');
const router = express.Router();

router.get('/', requireChamadosAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT status FROM chamados_status_ocultos ORDER BY status');
  res.json(rows);
});

router.post('/', requireChamadosAuth, async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status obrigatorio' });
  await pool.query('INSERT INTO chamados_status_ocultos (status) VALUES ($1) ON CONFLICT (status) DO NOTHING', [status]);
  res.status(201).json([{ status }]);
});

router.delete('/', requireChamadosAuth, async (req, res) => {
  const status = req.query.status;
  if (!status) return res.status(400).json({ error: 'status obrigatorio (query ?status=)' });
  await pool.query('DELETE FROM chamados_status_ocultos WHERE status = $1', [status]);
  res.json({ ok: true });
});

module.exports = router;
