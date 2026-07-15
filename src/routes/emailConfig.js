const express = require('express');
const { pool } = require('../db');
const { sendDigestNow } = require('../email');
const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM email_config WHERE id = 1');
  res.json(rows[0]);
});

router.put('/', async (req, res) => {
  const { frequencia, dia_semana, hora, enviar_gps, enviar_admins } = req.body;
  await pool.query(`
    UPDATE email_config SET frequencia=$1, dia_semana=$2, hora=$3, enviar_gps=$4, enviar_admins=$5 WHERE id=1
  `, [frequencia, dia_semana, hora, !!enviar_gps, !!enviar_admins]);
  res.json({ ok: true });
});

router.post('/enviar-agora', async (req, res) => {
  try {
    const resultado = await sendDigestNow();
    res.json(resultado);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'falha ao enviar e-mail: ' + e.message });
  }
});

module.exports = router;
