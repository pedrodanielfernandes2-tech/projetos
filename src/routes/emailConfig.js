const express = require('express');
const db = require('../db');
const { sendDigestNow } = require('../email');
const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM email_config WHERE id = 1').get());
});

router.put('/', (req, res) => {
  const { frequencia, dia_semana, hora, enviar_gps, enviar_admins } = req.body;
  db.prepare(`
    UPDATE email_config SET frequencia=?, dia_semana=?, hora=?, enviar_gps=?, enviar_admins=? WHERE id=1
  `).run(frequencia, dia_semana, hora, enviar_gps ? 1 : 0, enviar_admins ? 1 : 0);
  res.json({ ok: true });
});

// dispara o envio agora, ignorando a periodicidade (util para testar)
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
