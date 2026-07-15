const cron = require('node-cron');
const db = require('./db');
const { sendDigestNow } = require('./email');

function diasDesde(dataStr) {
  if (!dataStr) return Infinity;
  const ms = Date.now() - new Date(dataStr.replace(' ', 'T') + 'Z').getTime();
  return ms / (1000 * 60 * 60 * 24);
}

function deveEnviarHoje(config) {
  const hoje = new Date();
  const diaSemanaHoje = hoje.getDay(); // 0=domingo ... 6=sabado

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
  // roda todo dia as 07:00 (verifica se, segundo a config, deve disparar hoje)
  cron.schedule('0 7 * * *', async () => {
    const config = db.prepare('SELECT * FROM email_config WHERE id = 1').get();
    if (!deveEnviarHoje(config)) return;
    try {
      const resultado = await sendDigestNow();
      console.log(`[scheduler] e-mails enviados: ${resultado.enviados.join(', ')}`);
    } catch (e) {
      console.error('[scheduler] falha ao enviar e-mails automaticos:', e.message);
    }
  });
  console.log('[scheduler] agendador iniciado - verifica todo dia as 07:00');
}

module.exports = { startScheduler, deveEnviarHoje };
