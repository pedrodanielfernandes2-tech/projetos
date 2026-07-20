const express = require('express');
const { pool } = require('../db');
const { requireAdminAlways } = require('../adminAuth');
const { sendDigestNow } = require('../email');
const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM email_config WHERE id = 1');
  res.json(rows[0]);
});

router.put('/', requireAdminAlways, async (req, res) => {
  const { frequencia, dia_semana, hora, enviar_gps, enviar_admins, enviar_teams } = req.body;
  await pool.query(`
    UPDATE email_config SET frequencia=$1, dia_semana=$2, hora=$3, enviar_gps=$4, enviar_admins=$5, enviar_teams=$6 WHERE id=1
  `, [frequencia, dia_semana, hora, !!enviar_gps, !!enviar_admins, !!enviar_teams]);
  res.json({ ok: true });
});

// dispara o envio agora, ignorando a periodicidade (util para testar)
router.post('/enviar-agora', requireAdminAlways, async (req, res) => {
  try {
    const resultado = await sendDigestNow();
    res.json(resultado);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'falha ao enviar e-mail: ' + e.message });
  }
});

module.exports = router;
