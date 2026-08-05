const express = require('express');
const { pool } = require('../db');
const { sendDigestNow } = require('../email');
const { deveEnviarHoje, checkStatusChangesAndNotify } = require('../scheduler');
const router = express.Router();

// Protegido por um segredo simples via query string (?token=...), pensado pra ser
// chamado por um servico externo de agendamento (ex: cron-job.org), nao por pessoas
// navegando. O proprio ato de chamar essa URL ja "acorda" o servico caso ele esteja
// dormindo no plano gratuito do Render - e entao, na mesma chamada, ja despacha o envio.
function checarToken(req, res) {
  const token = req.query.token || req.header('x-cron-secret');
  if (!process.env.CRON_SECRET) {
    res.status(500).json({ error: 'CRON_SECRET nao configurado no servidor' });
    return false;
  }
  if (token !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'token invalido' });
    return false;
  }
  return true;
}

// Dispara o resumo por e-mail/Teams SE a configuracao mandar enviar hoje (respeita
// a frequencia configurada no Admin - diaria/semanal/quinzenal/mensal). Chame essa
// rota de um servico de agendamento externo no horario desejado.
router.get('/enviar-resumo', async (req, res) => {
  if (!checarToken(req, res)) return;
  try {
    const { rows } = await pool.query('SELECT * FROM email_config WHERE id = 1');
    const config = rows[0];
    if (!deveEnviarHoje(config)) {
      return res.json({ ok: true, enviado: false, motivo: 'configuracao nao manda enviar hoje' });
    }
    const resultado = await sendDigestNow();
    res.json({ ok: true, enviado: true, resultado });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Roda a checagem de projetos que viraram atrasados/bloqueados (a mesma que roda
// a cada 15min via cron interno). Util pra chamar de um servico externo tambem,
// caso o site fique dormindo por longos periodos entre visitas.
router.get('/checar-status', async (req, res) => {
  if (!checarToken(req, res)) return;
  try {
    await checkStatusChangesAndNotify();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
