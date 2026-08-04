const cron = require('node-cron');
const { pool } = require('./db');
const { sendDigestNow } = require('./email');
const { calcularStatusPrazo } = require('./statusCalc');
const { postToTeams } = require('./teams');

function diasDesde(data) {
  if (!data) return Infinity;
  const ms = Date.now() - new Date(data).getTime();
  return ms / (1000 * 60 * 60 * 24);
}

function deveEnviarHoje(config) {
  const agora = new Date();
  const diaSemanaHoje = agora.getDay(); // 0=domingo ... 6=sabado
  const horaAtual = agora.getHours();

  // So dispara na hora configurada (a checagem roda a cada 15min - aceita a primeira
  // janela que bater com a hora escolhida no Admin).
  const horaConfigurada = config.hora ?? 8;
  if (horaAtual !== horaConfigurada) return false;

  // Evita reenvio dentro do mesmo dia (a checagem roda varias vezes dentro da mesma hora).
  if (config.ultimo_envio) {
    const mesmoDia = new Date(config.ultimo_envio).toDateString() === agora.toDateString();
    if (mesmoDia) return false;
  }

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

// Verifica se algum projeto passou a ficar atrasado/bloqueado desde a ultima checagem
// e avisa no Teams. Nao e instantaneo (roda de hora em hora), mas cobre bem o caso de uso
// sem precisar de um sistema de eventos ao vivo.
async function checkStatusChangesAndNotify() {
  if (!process.env.TEAMS_WEBHOOK_URL) return;
  const { rows } = await pool.query(
    'SELECT id, nome, chamado, data_inicio, data_fim, status_prazo, ultimo_status_notificado FROM projects'
  );
  for (const p of rows) {
    const atual = calcularStatusPrazo(p);
    const anterior = p.ultimo_status_notificado;
    const viradaCritica = (atual === 'atrasado' || atual === 'bloqueado') && atual !== anterior;
    if (viradaCritica) {
      try {
        await postToTeams({
          title: `⚠️ Projeto ficou ${atual}`,
          text: `**${p.nome}**${p.chamado ? ' (Chamado ' + p.chamado + ')' : ''} mudou para **${atual}**.`,
        });
      } catch (e) {
        console.error('[teams] falha ao notificar mudanca de status:', e.message);
      }
    }
    if (atual !== anterior) {
      await pool.query('UPDATE projects SET ultimo_status_notificado = $1 WHERE id = $2', [atual, p.id]);
    }
  }
}

function startScheduler() {
  // roda a cada 15 minutos, e dentro disso verifica se a hora/frequencia configurada
  // no Admin bate com o momento atual - permite trocar o horario pela tela, sem
  // precisar mexer no codigo (antes ficava fixo as 07:00, ignorando a configuracao).
  cron.schedule('*/15 * * * *', async () => {
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

  // roda a cada 15 minutos, verificando se algum projeto acabou de ficar atrasado/bloqueado
  cron.schedule('*/15 * * * *', () => {
    checkStatusChangesAndNotify().catch(e => console.error('[scheduler] falha na checagem de status:', e.message));
  });

  console.log('[scheduler] agendador iniciado - resumo respeita o horario configurado no Admin, checagem de status a cada 15 minutos');
}

module.exports = { startScheduler, deveEnviarHoje, checkStatusChangesAndNotify };
