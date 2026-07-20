const { pool } = require('./db');
const { calcularStatusPrazo, calcularStatusTarefa } = require('./statusCalc');
const { postToTeams } = require('./teams');

function parseSender() {
  const raw = process.env.SMTP_FROM || '';
  const match = raw.match(/^"?([^"<]*)"?\s*<(.+)>$/);
  if (match) return { name: match[1].trim() || 'Painel de Projetos', email: match[2].trim() };
  return { name: 'Painel de Projetos', email: raw };
}

async function sendMail({ to, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error('BREVO_API_KEY nao configurada (configure no Environment do Render)');
  }
  const sender = parseSender();
  if (!sender.email) {
    throw new Error('SMTP_FROM nao configurado (defina o remetente, ex: "Painel de Projetos <voce@empresa.com>")');
  }
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    throw new Error(`falha ao enviar via Brevo (status ${res.status}): ${corpo}`);
  }
}

function statusLabel(s) {
  return (s || 'planejamento').replace(/^\w/, c => c.toUpperCase());
}

function buildProjectBlock(project) {
  const tarefasHtml = project.tarefas.map(t => `
    <tr>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;">${t.area}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;">${t.inicio} a ${t.fim}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #eee;">${statusLabel(t.status)}</td>
    </tr>
  `).join('');

  const ultimoHistorico = project.historico[0]
    ? `<p style="margin:4px 0;color:#555;font-size:13px;"><strong>${project.historico[0].data}:</strong> ${project.historico[0].texto}</p>`
    : '';

  const chamadoLine = project.chamado ? ` · Chamado: ${project.chamado}` : '';
  const clienteLine = project.cliente_nome ? ` · Cliente: ${project.cliente_nome}` : '';

  return `
    <div style="margin-bottom:20px;border:1px solid #ddd;border-radius:8px;padding:14px 16px;">
      <p style="margin:0 0 4px;font-size:15px;font-weight:bold;">${project.nome}${chamadoLine}</p>
      <p style="margin:0 0 8px;color:#666;font-size:13px;">GP: ${project.gerente_nome || '-'}${clienteLine} · Fase: ${project.fase} · Status do prazo: <strong>${statusLabel(project.status_prazo)}</strong></p>
      <p style="margin:0 0 8px;font-size:14px;">${project.resumo || ''}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px;">
        <thead><tr>
          <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc;">Area</th>
          <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc;">Prazo</th>
          <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc;">Status</th>
        </tr></thead>
        <tbody>${tarefasHtml}</tbody>
      </table>
      ${ultimoHistorico}
    </div>
  `;
}

async function getAllProjectsFull() {
  const { rows: ids } = await pool.query('SELECT id FROM projects');
  const projects = [];
  for (const { id } of ids) {
    const { rows } = await pool.query(`
      SELECT p.*, g.nome AS gerente_nome, g.email AS gerente_email, c.nome AS cliente_nome
      FROM projects p
      LEFT JOIN gps g ON g.id = p.gp_id
      LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.id = $1
    `, [id]);
    const project = rows[0];
    const tarefas = await pool.query('SELECT * FROM area_tasks WHERE project_id = $1', [id]);
    const historico = await pool.query('SELECT * FROM historico WHERE project_id = $1 ORDER BY data DESC, id DESC', [id]);
    project.tarefas = tarefas.rows.map(t => ({ ...t, status: calcularStatusTarefa(t) }));
    project.historico = historico.rows;
    project.status_prazo = calcularStatusPrazo(project);
    projects.push(project);
  }
  return projects;
}

async function sendDigestNow() {
  const { rows: configRows } = await pool.query('SELECT * FROM email_config WHERE id = 1');
  const config = configRows[0];
  const allProjects = await getAllProjectsFull();
  const enviados = [];
  let emailErro = null;

  try {
    if (config.enviar_gps) {
      const { rows: gpsList } = await pool.query('SELECT * FROM gps');
      for (const gp of gpsList) {
        const projetosDoGp = allProjects.filter(p => p.gp_id === gp.id);
        if (projetosDoGp.length === 0) continue;
        const html = `
          <h2 style="font-size:18px;">Resumo de projetos - ${new Date().toLocaleDateString('pt-BR')}</h2>
          <p style="color:#666;font-size:13px;">Projetos sob sua responsabilidade</p>
          ${projetosDoGp.map(buildProjectBlock).join('')}
        `;
        await sendMail({
          to: gp.email,
          subject: `Resumo dos seus projetos - ${new Date().toLocaleDateString('pt-BR')}`,
          html,
        });
        enviados.push(gp.email);
      }
    }

    if (config.enviar_admins) {
      const { rows: admins } = await pool.query('SELECT * FROM admin_emails');
      if (admins.length > 0) {
        const html = `
          <h2 style="font-size:18px;">Resumo geral de todos os projetos - ${new Date().toLocaleDateString('pt-BR')}</h2>
          ${allProjects.map(buildProjectBlock).join('')}
        `;
        for (const admin of admins) {
          await sendMail({
            to: admin.email,
            subject: `Resumo geral de projetos - ${new Date().toLocaleDateString('pt-BR')}`,
            html,
          });
          enviados.push(admin.email);
        }
      }
    }
  } catch (e) {
    // Uma falha no envio de e-mail nao deve impedir a tentativa de envio ao Teams (sao independentes).
    emailErro = e.message;
  }

  await pool.query("UPDATE email_config SET ultimo_envio = NOW() WHERE id = 1");

  let teams = null;
  if (config.enviar_teams) {
    try {
      const atrasados = allProjects.filter(p => p.status_prazo === 'atrasado');
      const bloqueados = allProjects.filter(p => p.status_prazo === 'bloqueado');
      const linhas = [];
      if (atrasados.length > 0) {
        linhas.push(`**Atrasados (${atrasados.length}):** ` + atrasados.map(p => p.nome).join(', '));
      }
      if (bloqueados.length > 0) {
        linhas.push(`**Bloqueados (${bloqueados.length}):** ` + bloqueados.map(p => p.nome).join(', '));
      }
      if (linhas.length === 0) {
        linhas.push('Nenhum projeto atrasado ou bloqueado hoje. ✅');
      }
      linhas.push(`\n_Total de projetos ativos: ${allProjects.length}_`);
      await postToTeams({
        title: `Resumo de projetos - ${new Date().toLocaleDateString('pt-BR')}`,
        text: linhas.join('\n\n'),
      });
      teams = 'enviado';
    } catch (e) {
      teams = 'erro: ' + e.message;
    }
  }

  return { enviados, emailErro, teams };
}

module.exports = { sendDigestNow, getAllProjectsFull };
