const express = require('express');
const { pool } = require('../db');
const { requireAdminIfSetting } = require('../adminAuth');
const { calcularStatusPrazo, calcularStatusTarefa } = require('../statusCalc');
const { registrarAuditoria } = require('../audit');
const { postToTeams } = require('../teams');
const { gpIdRestrito, requireProjetoDoProprioGp } = require('../gpRestricao');
const router = express.Router();

function getAutor(req) {
  return req.header('x-autor') || 'anônimo';
}

async function getProjectName(id) {
  const { rows } = await pool.query('SELECT nome FROM projects WHERE id = $1', [id]);
  return rows[0] ? rows[0].nome : '';
}

function calcularSaudeImplantacao(wbsRows) {
  if (wbsRows.length === 0) return null;
  const hojeStr = new Date().toISOString().slice(0, 10);
  const agora = new Date();
  let temAtrasado = false;
  let temRisco = false;
  wbsRows.forEach(item => {
    if (item.status === 'Concluído') return;
    if (item.status === 'Suspensa') { temRisco = true; return; }
    if (!item.data_fim) return;
    if (hojeStr > item.data_fim) { temAtrasado = true; return; }
    if (item.data_inicio) {
      const inicio = new Date(item.data_inicio + 'T00:00:00');
      const fim = new Date(item.data_fim + 'T00:00:00');
      if (agora > inicio && fim > inicio) {
        const elapsed = ((agora - inicio) / (fim - inicio)) * 100;
        if (elapsed >= 80) temRisco = true;
      }
    } else {
      const diasRestantes = (new Date(item.data_fim + 'T00:00:00') - agora) / (1000 * 60 * 60 * 24);
      if (diasRestantes <= 3) temRisco = true;
    }
  });
  if (temAtrasado) return 'critico';
  if (temRisco) return 'atencao';
  return 'saudavel';
}

async function loadProject(id) {
  const { rows } = await pool.query(`
    SELECT p.*, g.nome AS gerente_nome, g.email AS gerente_email, c.nome AS cliente_nome
    FROM projects p
    LEFT JOIN gps g ON g.id = p.gp_id
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE p.id = $1
  `, [id]);
  const project = rows[0];
  if (!project) return null;
  const tarefas = await pool.query('SELECT * FROM area_tasks WHERE project_id = $1 ORDER BY inicio', [id]);
  const historico = await pool.query('SELECT * FROM historico WHERE project_id = $1 ORDER BY data DESC, id DESC', [id]);
  const links = await pool.query('SELECT * FROM project_links WHERE project_id = $1 ORDER BY id DESC', [id]);
  const wbsItems = await pool.query('SELECT status, data_inicio, data_fim FROM wbs_items WHERE project_id = $1', [id]);
  project.tarefas = tarefas.rows.map(t => ({ ...t, status: calcularStatusTarefa(t) }));
  project.historico = historico.rows;
  project.links = links.rows;
  project.wbs_total_itens = wbsItems.rows.length;
  project.saude_implantacao = calcularSaudeImplantacao(wbsItems.rows);
  project.status_prazo = calcularStatusPrazo(project);
  return project;
}

router.get('/', async (req, res) => {
  const { area } = req.query;
  let ids;
  if (area) {
    const { rows } = await pool.query('SELECT DISTINCT project_id FROM area_tasks WHERE area = $1', [area]);
    ids = rows.map(r => r.project_id);
  } else {
    const { rows } = await pool.query('SELECT id FROM projects ORDER BY id DESC');
    ids = rows.map(r => r.id);
  }
  const meuGpId = await gpIdRestrito(req.usuario);
  if (meuGpId !== null) {
    const { rows } = await pool.query('SELECT id FROM projects WHERE gp_id = $1', [meuGpId]);
    const idsDoMeuGp = new Set(rows.map(r => r.id));
    ids = ids.filter(id => idsDoMeuGp.has(id));
  }
  const projects = await Promise.all(ids.map(loadProject));
  res.json(projects.filter(Boolean));
});

router.get('/:id', requireProjetoDoProprioGp(), async (req, res) => {
  const project = await loadProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'projeto nao encontrado' });
  res.json(project);
});

router.post('/', async (req, res) => {
  const { nome, chamado, cliente_id, gp_id, tipo, fase, status_prazo, resumo, data_inicio, data_fim, progresso, tarefas } = req.body;
  if (!nome || !Array.isArray(tarefas) || tarefas.length === 0) {
    return res.status(400).json({ error: 'nome e ao menos uma area envolvida sao obrigatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const statusInicial = status_prazo || 'em dia';
    const jaNasceConcluido = ['concluído', 'concluido'].includes(statusInicial.toLowerCase());
    const { rows } = await client.query(`
      INSERT INTO projects (nome, chamado, cliente_id, gp_id, tipo, fase, status_prazo, resumo, data_inicio, data_fim, progresso, concluido_em)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id
    `, [nome, chamado || '', cliente_id || null, gp_id || null, tipo || 'Melhoria', fase || 'Levantamento', statusInicial, resumo || '', data_inicio || null, data_fim || null, progresso || 0, jaNasceConcluido ? new Date() : null]);
    const projectId = rows[0].id;

    for (const t of tarefas) {
      await client.query(
        'INSERT INTO area_tasks (project_id, area, inicio, fim, status) VALUES ($1, $2, $3, $4, $5)',
        [projectId, t.area, t.inicio || null, t.fim || null, t.status || 'planejamento']
      );
    }
    const autor = getAutor(req);
    await client.query(
      "INSERT INTO historico (project_id, data, texto, autor) VALUES ($1, CURRENT_DATE, $2, $3)",
      [projectId, 'Projeto cadastrado.', autor]
    );
    await client.query('COMMIT');

    await registrarAuditoria({
      entidade: 'projeto', entidade_id: projectId, projeto_id: projectId, projeto_nome: nome,
      acao: 'criado', autor,
      detalhes: `Projeto criado${chamado ? ' (chamado ' + chamado + ')' : ''} com ${tarefas.length} área(s): ${tarefas.map(t => t.area).join(', ')}`,
      envolve_data: tarefas.some(t => t.inicio || t.fim) || !!(data_inicio || data_fim),
    });

    res.status(201).json(await loadProject(projectId));
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'falha ao criar projeto: ' + e.message });
  } finally {
    client.release();
  }
});

router.put('/:id', requireProjetoDoProprioGp(), requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const { nome, chamado, cliente_id, gp_id, tipo, fase, status_prazo, resumo, data_inicio, data_fim, progresso } = req.body;
  const antigo = (await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id])).rows[0];

  const statusNormalizado = (status_prazo || '').toLowerCase();
  const eraConcluido = antigo && ['concluído', 'concluido'].includes((antigo.status_prazo || '').toLowerCase());
  const ficaConcluido = ['concluído', 'concluido'].includes(statusNormalizado);
  // So grava a data de conclusao na TRANSICAO pra concluido (nao sobrescreve se ja estava
  // concluido e só editaram outra coisa); limpa se foi reaberto.
  let concluidoEmClause = 'concluido_em';
  if (ficaConcluido && !eraConcluido) concluidoEmClause = 'NOW()';
  else if (!ficaConcluido && eraConcluido) concluidoEmClause = 'NULL';

  await pool.query(`
    UPDATE projects SET nome=$1, chamado=$2, cliente_id=$3, gp_id=$4, tipo=$5, fase=$6, status_prazo=$7, resumo=$8, data_inicio=$9, data_fim=$10, progresso=$11, concluido_em=${concluidoEmClause}
    WHERE id=$12
  `, [nome, chamado || '', cliente_id || null, gp_id || null, tipo, fase, status_prazo, resumo, data_inicio || null, data_fim || null, progresso, req.params.id]);

  if (antigo) {
    const mudancas = [];
    let envolveData = false;
    if (nome !== undefined && antigo.nome !== nome) mudancas.push(`nome: "${antigo.nome}" → "${nome}"`);
    if (data_inicio !== undefined && (antigo.data_inicio || '') !== (data_inicio || '')) {
      mudancas.push(`data de início: ${antigo.data_inicio || 'sem data'} → ${data_inicio || 'sem data'}`);
      envolveData = true;
    }
    if (data_fim !== undefined && (antigo.data_fim || '') !== (data_fim || '')) {
      mudancas.push(`data de entrega: ${antigo.data_fim || 'sem data'} → ${data_fim || 'sem data'}`);
      envolveData = true;
    }
    if (status_prazo !== undefined && (antigo.status_prazo || '') !== (status_prazo || '')) mudancas.push(`status do prazo: ${antigo.status_prazo} → ${status_prazo}`);
    if (fase !== undefined && (antigo.fase || '') !== (fase || '')) mudancas.push(`fase: ${antigo.fase} → ${fase}`);
    await registrarAuditoria({
      entidade: 'projeto', entidade_id: Number(req.params.id), projeto_id: Number(req.params.id), projeto_nome: nome,
      acao: 'editado', autor: getAutor(req),
      detalhes: mudancas.length > 0 ? mudancas.join('; ') : 'projeto salvo sem alterações detectadas',
      envolve_data: envolveData,
    });
  }

  res.json(await loadProject(req.params.id));
});

// Liga/desliga a matriz de priorizacao (Impacto x Esforco) da WBS desse projeto.
router.put('/:id/priorizacao', requireProjetoDoProprioGp(), requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const { ativa } = req.body;
  await pool.query('UPDATE projects SET priorizacao_ativa = $1 WHERE id = $2', [!!ativa, req.params.id]);
  await registrarAuditoria({
    entidade: 'projeto', entidade_id: Number(req.params.id), projeto_id: Number(req.params.id),
    acao: 'editado', autor: getAutor(req),
    detalhes: `Priorização (Impacto x Esforço) ${ativa ? 'ativada' : 'desativada'} para este projeto`,
  });
  res.json({ ok: true, priorizacao_ativa: !!ativa });
});

router.delete('/:id', requireProjetoDoProprioGp(), requireAdminIfSetting('restringir_exclusao'), async (req, res) => {
  const projeto = (await pool.query('SELECT * FROM projects WHERE id = $1', [req.params.id])).rows[0];
  await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);

  await registrarAuditoria({
    entidade: 'projeto', entidade_id: Number(req.params.id), projeto_id: Number(req.params.id),
    projeto_nome: projeto ? projeto.nome : '',
    acao: 'excluido', autor: getAutor(req),
    detalhes: projeto ? `Projeto "${projeto.nome}"${projeto.chamado ? ' (chamado ' + projeto.chamado + ')' : ''} excluído` : 'projeto excluído',
  });

  res.json({ ok: true });
});

// Tarefas por area dentro de um projeto
router.post('/:id/tarefas', requireProjetoDoProprioGp(), requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const { area, inicio, fim, status } = req.body;
  if (!area) return res.status(400).json({ error: 'area obrigatoria' });
  const { rows } = await pool.query(
    'INSERT INTO area_tasks (project_id, area, inicio, fim, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [req.params.id, area, inicio || null, fim || null, status || 'planejamento']
  );

  await registrarAuditoria({
    entidade: 'tarefa', entidade_id: rows[0].id, projeto_id: Number(req.params.id), projeto_nome: await getProjectName(req.params.id),
    acao: 'criado', autor: getAutor(req),
    detalhes: `Área "${area}" adicionada (${inicio || 'sem data'} → ${fim || 'sem data'})`,
    envolve_data: !!(inicio || fim),
  });

  res.status(201).json(rows[0]);
});

router.put('/:id/tarefas/:taskId', requireProjetoDoProprioGp(), requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const { area, inicio, fim, status } = req.body;
  const antiga = (await pool.query('SELECT * FROM area_tasks WHERE id = $1 AND project_id = $2', [req.params.taskId, req.params.id])).rows[0];

  await pool.query(
    'UPDATE area_tasks SET area=$1, inicio=$2, fim=$3, status=$4 WHERE id=$5 AND project_id=$6',
    [area, inicio || null, fim || null, status, req.params.taskId, req.params.id]
  );

  if (antiga) {
    const mudancas = [];
    let envolveData = false;
    if ((antiga.inicio || '') !== (inicio || '')) {
      mudancas.push(`início: ${antiga.inicio || 'sem data'} → ${inicio || 'sem data'}`);
      envolveData = true;
    }
    if ((antiga.fim || '') !== (fim || '')) {
      mudancas.push(`fim: ${antiga.fim || 'sem data'} → ${fim || 'sem data'}`);
      envolveData = true;
    }
    if ((antiga.status || '') !== (status || '')) mudancas.push(`status: ${antiga.status} → ${status}`);
    await registrarAuditoria({
      entidade: 'tarefa', entidade_id: Number(req.params.taskId), projeto_id: Number(req.params.id), projeto_nome: await getProjectName(req.params.id),
      acao: 'editado', autor: getAutor(req),
      detalhes: `Área "${area}": ` + (mudancas.length > 0 ? mudancas.join('; ') : 'sem alterações detectadas'),
      envolve_data: envolveData,
    });
  }

  res.json({ ok: true });
});

router.delete('/:id/tarefas/:taskId', requireProjetoDoProprioGp(), requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const antiga = (await pool.query('SELECT * FROM area_tasks WHERE id = $1 AND project_id = $2', [req.params.taskId, req.params.id])).rows[0];
  await pool.query('DELETE FROM area_tasks WHERE id=$1 AND project_id=$2', [req.params.taskId, req.params.id]);

  await registrarAuditoria({
    entidade: 'tarefa', entidade_id: Number(req.params.taskId), projeto_id: Number(req.params.id), projeto_nome: await getProjectName(req.params.id),
    acao: 'excluido', autor: getAutor(req),
    detalhes: antiga ? `Área "${antiga.area}" removida (tinha prazo ${antiga.inicio || 'sem data'} → ${antiga.fim || 'sem data'})` : 'área removida',
    envolve_data: !!(antiga && (antiga.inicio || antiga.fim)),
  });

  res.json({ ok: true });
});

// Historico
router.post('/:id/historico', requireProjetoDoProprioGp(), async (req, res) => {
  const { texto, autor, data } = req.body;
  if (!texto) return res.status(400).json({ error: 'texto obrigatorio' });
  const { rows } = await pool.query(
    'INSERT INTO historico (project_id, data, texto, autor) VALUES ($1, $2, $3, $4) RETURNING id',
    [req.params.id, data || new Date().toISOString().slice(0, 10), texto, autor || getAutor(req)]
  );
  res.status(201).json(rows[0]);
});

router.patch('/:id/historico/:historicoId', requireProjetoDoProprioGp(), async (req, res) => {
  const { texto, data } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'texto obrigatorio' });
  const existente = (await pool.query(
    'SELECT * FROM historico WHERE id = $1 AND project_id = $2',
    [req.params.historicoId, req.params.id]
  )).rows[0];
  if (!existente) return res.status(404).json({ error: 'registro de histórico não encontrado' });

  await pool.query(
    'UPDATE historico SET texto = $1, data = $2 WHERE id = $3',
    [texto.trim(), data || existente.data, req.params.historicoId]
  );
  await registrarAuditoria({
    entidade: 'historico', entidade_id: existente.id, projeto_id: req.params.id,
    acao: 'editado', autor: getAutor(req), detalhes: `Registro de histórico editado: "${texto.trim()}"`,
  });
  res.json({ ok: true });
});

router.delete('/:id/historico/:historicoId', requireProjetoDoProprioGp(), async (req, res) => {
  const existente = (await pool.query(
    'SELECT * FROM historico WHERE id = $1 AND project_id = $2',
    [req.params.historicoId, req.params.id]
  )).rows[0];
  if (!existente) return res.status(404).json({ error: 'registro de histórico não encontrado' });

  await pool.query('DELETE FROM historico WHERE id = $1', [req.params.historicoId]);
  await registrarAuditoria({
    entidade: 'historico', entidade_id: existente.id, projeto_id: req.params.id,
    acao: 'excluido', autor: getAutor(req), detalhes: `Registro de histórico excluído: "${existente.texto}"`,
  });
  res.json({ ok: true });
});

// Links do projeto
router.post('/:id/links', requireProjetoDoProprioGp(), async (req, res) => {
  const { titulo, url } = req.body;
  if (!url || !url.trim()) return res.status(400).json({ error: 'url obrigatoria' });
  const { rows } = await pool.query(
    'INSERT INTO project_links (project_id, titulo, url) VALUES ($1, $2, $3) RETURNING *',
    [req.params.id, (titulo || '').trim() || url.trim(), url.trim()]
  );
  res.status(201).json(rows[0]);
});

router.delete('/:id/links/:linkId', requireProjetoDoProprioGp(), async (req, res) => {
  await pool.query('DELETE FROM project_links WHERE id = $1 AND project_id = $2', [req.params.linkId, req.params.id]);
  res.json({ ok: true });
});

// Notificar um projeto especifico no Teams (sob demanda)
router.post('/:id/notificar-teams', requireProjetoDoProprioGp(), async (req, res) => {
  const project = await loadProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'projeto nao encontrado' });

  const linhasTarefas = project.tarefas.map(t =>
    `- ${t.area}: ${t.inicio || 'sem data'} → ${t.fim || 'sem data'} (${t.status})`
  ).join('\n');

  // historico: as atualizacoes mais recentes primeiro (ja vem ordenado assim do loadProject)
  const LIMITE_HISTORICO = 5;
  const historicoVisivel = project.historico.slice(0, LIMITE_HISTORICO);
  const linhasHistorico = historicoVisivel.map(h => `- ${h.data ? h.data.slice(0, 10).split('-').reverse().join('/') : ''}: ${h.texto}`).join('\n');
  const restanteHistorico = project.historico.length - historicoVisivel.length;

  // WBS: resumo (contagem por status) + link pro PDF completo, se houver itens
  const { rows: wbsRows } = await pool.query('SELECT status FROM wbs_items WHERE project_id = $1', [req.params.id]);
  let blocoWbs = null;
  if (wbsRows.length > 0) {
    const contagem = {};
    wbsRows.forEach(r => { contagem[r.status] = (contagem[r.status] || 0) + 1; });
    const concluidos = contagem['Concluído'] || 0;
    const percentConcluido = Math.round((concluidos / wbsRows.length) * 100);
    const resumoStatus = Object.entries(contagem).map(([status, n]) => `${status}: ${n}`).join(' · ');
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    blocoWbs = `WBS: ${wbsRows.length} item(ns) · ${percentConcluido}% concluído\n${resumoStatus}\n📄 PDF completo: ${baseUrl}/api/projects/${req.params.id}/wbs/pdf`;
  }

  const partes = [
    project.chamado ? `Chamado: ${project.chamado}` : null,
    project.cliente_nome ? `Cliente: ${project.cliente_nome}` : null,
    `GP: ${project.gerente_nome || '-'}`,
    `Fase: ${project.fase} · Status do prazo: **${project.status_prazo}**`,
    project.resumo ? `Resumo: ${project.resumo}` : null,
    linhasTarefas ? `\nÁreas:\n${linhasTarefas}` : null,
    linhasHistorico ? `\nHistórico recente:\n${linhasHistorico}${restanteHistorico > 0 ? `\n(+${restanteHistorico} atualização(ões) anterior(es))` : ''}` : null,
    blocoWbs ? `\n${blocoWbs}` : null,
  ].filter(Boolean);

  try {
    // Mencao pausada por enquanto (o conector CardPlatform do fluxo nao repassa msteams.entities).
    await postToTeams({ title: `📋 ${project.nome}`, text: partes.join('\n') });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
