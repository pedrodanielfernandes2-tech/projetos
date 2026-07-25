const express = require('express');
const { checarSenhaChamados } = require('../chamadosAuth');
const router = express.Router();

router.post('/login', (req, res) => {
  const senha = req.body.senha || '';
  if (!process.env.CHAMADOS_PASSWORD) {
    return res.status(500).json({ error: 'CHAMADOS_PASSWORD nao configurada no servidor' });
  }
  if (senha === process.env.CHAMADOS_PASSWORD) {
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'senha incorreta' });
});

module.exports = router;
