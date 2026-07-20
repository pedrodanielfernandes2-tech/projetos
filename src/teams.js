async function postToTeams({ title, text }) {
  const url = process.env.TEAMS_WEBHOOK_URL;
  if (!url) {
    throw new Error('TEAMS_WEBHOOK_URL nao configurada (configure no Environment do Render)');
  }

  // O fluxo do Power Automate usa a acao "Postar cartao em um chat ou canal", que exige
  // um Adaptive Card de verdade no corpo (nao um texto simples como {"text": "..."}).
  const body = [];
  if (title) {
    body.push({ type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true });
  }
  if (text) {
    body.push({ type: 'TextBlock', text, wrap: true });
  }
  const adaptiveCard = {
    type: 'AdaptiveCard',
    '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(adaptiveCard),
  });
  if (!res.ok) {
    const corpo = await res.text().catch(() => '');
    throw new Error(`falha ao enviar para o Teams (status ${res.status}): ${corpo}`);
  }
}

module.exports = { postToTeams };
