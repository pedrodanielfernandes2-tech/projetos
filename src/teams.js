async function postToTeams({ title, text }) {
  const url = process.env.TEAMS_WEBHOOK_URL;
  if (!url) {
    throw new Error('TEAMS_WEBHOOK_URL nao configurada (configure no Environment do Render)');
  }
  // Fluxos do Power Automate (Workflows), que substituiram os "Incoming Webhooks" classicos
  // do Teams, geralmente esperam um corpo simples com um campo "text" (nao o formato antigo
  // de MessageCard com @type/@context).
  const mensagem = title ? `**${title}**\n\n${text}` : text;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: mensagem }),
  });
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    throw new Error(`falha ao enviar para o Teams (status ${res.status}): ${corpo}`);
  }
}

module.exports = { postToTeams };
