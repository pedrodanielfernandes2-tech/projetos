const cron = require('node-cron');
const { pool } = require('./db');
const { sendDigestNow } = require('./email');

function diasDesde(data) {
  if (!data) return Infinity;
  const ms = Date.now() - new Date(data).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

function deveEnviarHoje(config) {
  const hoje = new Date();
  const diaSemanaHoje = hoje.getDay();

  switch (config.frequencia) {
    case 'diaria':
      return true;
    case 'semanal':
      return diaSemanaHoje === config.dia_semana;
    case 'quinzenal':
      return diaSemanaHoje === config.dia_semana && diasDesde(config.ultimo_envio) >= 13;
    case 'mensal':
      return diasDesde(config.ultimo_envio) >= 27;
    default:
      return false;
  }
}

function startScheduler() {
  const cronLib = require('node-cron');
  cronLib.schedule('0 7 * * *', async () => {
    try {
      const { rows } = await pool.query('SELECT * FROM email_config WHERE id = 1');
      const config = rows[0];
      if (!deveEnviarHoje(config)) return;
      const resultado = await sendDigestNow();
      console.log(`[scheduler] e-mails enviados: ${resultado.enviados.join(', ')}`);
    } catch (e) {
      console.error('[scheduler] falha ao enviar e-mails automaticos:', e.message);
    }
  });
  console.log('[scheduler] agendador iniciado - verifica todo dia as 07:00');
}

module.exports = { startScheduler, deveEnviarHoje };
