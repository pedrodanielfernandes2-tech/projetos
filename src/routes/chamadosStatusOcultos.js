const express = require('express');
const { pool } = require('../chamadosDb');
const { requireChamadosAuth } = require('../chamadosAuth');
const router = express.Router();

router.use(requireChamadosAuth);

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT status FROM status_ocultos');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'falha ao buscar status ocultos: ' + e.message });
  }
});

router.post('/', async (req, res) => {
  const { status } = req.body;
  try {
    await pool.query('INSERT INTO status_ocultos (status) VALUES ($1) ON CONFLICT DO NOTHING', [status]);
    res.status(201).json({ status });
  } catch (e) {
    res.status(500).json({ error: 'falha ao ocultar status: ' + e.message });
  }
});

router.delete('/', async (req, res) => {
  const { status } = req.query;
  try {
    await pool.query('DELETE FROM status_ocultos WHERE status = $1', [status]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'falha ao remover status oculto: ' + e.message });
  }
});

module.exports = router;
