const nodemailer = require('nodemailer');
const db = require('./db');

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
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

  return `
    <div style="margin-bottom:20px;border:1px solid #ddd;border-radius:8px;padding:14px 16px;">
      <p style="margin:0 0 4px;font-size:15px;font-weight:bold;">${project.nome}</p>
      <p style="margin:0 0 8px;color:#666;font-size:13px;">GP: ${project.gerente_nome || '-'} · Fase: ${project.fase} · Status do prazo: <strong>${statusLabel(project.status_prazo)}</strong></p>
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

function getAllProjectsFull() {
  const ids = db.prepare('SELECT id FROM projects').all().map(r => r.id);
  return ids.map(id => {
    const project = db.prepare(`
      SELECT p.*, g.nome AS gerente_nome, g.email AS gerente_email
      FROM projects p LEFT JOIN gps g ON g.id = p.gp_id WHERE p.id = ?
    `).get(id);
    project.tarefas = db.prepare('SELECT * FROM area_tasks WHERE project_id = ?').all(id);
    project.historico = db.prepare('SELECT * FROM historico WHERE project_id = ? ORDER BY data DESC, id DESC').all(id);
    return project;
  });
}

async function sendDigestNow() {
  const config = db.prepare('SELECT * FROM email_config WHERE id = 1').get();
  const allProjects = getAllProjectsFull();
  const transporter = getTransporter();
  const enviados = [];

  if (config.enviar_gps) {
    const gpsList = db.prepare('SELECT * FROM gps').all();
    for (const gp of gpsList) {
      const areas = JSON.parse(gp.areas);
      const projetosDoGp = allProjects.filter(p => p.tarefas.some(t => areas.includes(t.area)));
      if (projetosDoGp.length === 0) continue;
      const html = `
        <h2 style="font-size:18px;">Resumo de projetos - ${new Date().toLocaleDateString('pt-BR')}</h2>
        <p style="color:#666;font-size:13px;">Projetos das areas: ${areas.join(', ')}</p>
        ${projetosDoGp.map(buildProjectBlock).join('')}
      `;
      await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: gp.email,
        subject: `Resumo de projetos (${areas.join(', ')}) - ${new Date().toLocaleDateString('pt-BR')}`,
        html,
      });
      enviados.push(gp.email);
    }
  }

  if (config.enviar_admins) {
    const admins = db.prepare('SELECT * FROM admin_emails').all();
    if (admins.length > 0) {
      const html = `
        <h2 style="font-size:18px;">Resumo geral de todos os projetos - ${new Date().toLocaleDateString('pt-BR')}</h2>
        ${allProjects.map(buildProjectBlock).join('')}
      `;
      for (const admin of admins) {
        await transporter.sendMail({
          from: process.env.SMTP_FROM,
          to: admin.email,
          subject: `Resumo geral de projetos - ${new Date().toLocaleDateString('pt-BR')}`,
          html,
        });
        enviados.push(admin.email);
      }
    }
  }

  db.prepare("UPDATE email_config SET ultimo_envio = datetime('now') WHERE id = 1").run();
  return { enviados };
}

module.exports = { sendDigestNow, getAllProjectsFull };
