const express = require('express');
const { pool } = require('../db');
const { requireAdminAlways } = require('../adminAuth');
const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM app_settings WHERE id = 1');
  res.json(rows[0]);
});

router.put('/', requireAdminAlways, async (req, res) => {
  const { restringir_exclusao, restringir_edicao_prazos } = req.body;
  await pool.query(
    'UPDATE app_settings SET restringir_exclusao = $1, restringir_edicao_prazos = $2 WHERE id = 1',
    [!!restringir_exclusao, !!restringir_edicao_prazos]
  );
  res.json({ ok: true });
});

module.exports = router;
