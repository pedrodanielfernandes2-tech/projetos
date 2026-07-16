async function postToTeams({ title, text, color }) {
  const url = process.env.TEAMS_WEBHOOK_URL;
  if (!url) {
    throw new Error('TEAMS_WEBHOOK_URL nao configurada (configure no Environment do Render)');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      '@type': 'MessageCard',
      '@context': 'http://schema.org/extensions',
      summary: title,
      themeColor: color || '1B63AC',
      title,
      text,
    }),
  });
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    throw new Error(`falha ao enviar para o Teams (status ${res.status}): ${corpo}`);
  }
}

module.exports = { postToTeams };
