const express = require('express');
const { pool } = require('../db');
const { requireAdminIfSetting } = require('../adminAuth');
const router = express.Router();

const STATUS_MANUAIS = ['bloqueado', 'concluído', 'concluido'];

function calcularStatusPrazo(project) {
  // Respeita marcacoes manuais (bloqueado/concluido) - nao sao dedutiveis so pelas datas.
  if (STATUS_MANUAIS.includes((project.status_prazo || '').toLowerCase())) {
    return project.status_prazo;
  }
  const hoje = new Date().toISOString().slice(0, 10);
  if (project.data_inicio && hoje < project.data_inicio) return 'não iniciado';
  if (project.data_fim && hoje > project.data_fim) return 'atrasado';
  return 'em dia';
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
  project.tarefas = tarefas.rows;
  project.historico = historico.rows;
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
  const projects = await Promise.all(ids.map(loadProject));
  res.json(projects.filter(Boolean));
});

router.get('/:id', async (req, res) => {
  const project = await loadProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'projeto nao encontrado' });
  res.json(project);
});

router.post('/', async (req, res) => {
  const { nome, chamado, cliente_id, gp_id, tipo, fase, status_prazo, resumo, data_inicio, data_fim, progresso, tarefas, autor } = req.body;
  if (!nome || !data_inicio || !data_fim || !Array.isArray(tarefas) || tarefas.length === 0) {
    return res.status(400).json({ error: 'nome, datas gerais e ao menos uma tarefa de area sao obrigatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`
      INSERT INTO projects (nome, chamado, cliente_id, gp_id, tipo, fase, status_prazo, resumo, data_inicio, data_fim, progresso)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id
    `, [nome, chamado || '', cliente_id || null, gp_id || null, tipo || 'Melhoria', fase || 'Levantamento', status_prazo || 'em dia', resumo || '', data_inicio, data_fim, progresso || 0]);
    const projectId = rows[0].id;

    for (const t of tarefas) {
      await client.query(
        'INSERT INTO area_tasks (project_id, area, inicio, fim, status) VALUES ($1, $2, $3, $4, $5)',
        [projectId, t.area, t.inicio, t.fim, t.status || 'planejamento']
      );
    }
    await client.query(
      "INSERT INTO historico (project_id, data, texto, autor) VALUES ($1, CURRENT_DATE, $2, $3)",
      [projectId, 'Projeto cadastrado.', autor || 'sistema']
    );
    await client.query('COMMIT');
    res.status(201).json(await loadProject(projectId));
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'falha ao criar projeto: ' + e.message });
  } finally {
    client.release();
  }
});

router.put('/:id', requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const { nome, chamado, cliente_id, gp_id, tipo, fase, status_prazo, resumo, data_inicio, data_fim, progresso } = req.body;
  await pool.query(`
    UPDATE projects SET nome=$1, chamado=$2, cliente_id=$3, gp_id=$4, tipo=$5, fase=$6, status_prazo=$7, resumo=$8, data_inicio=$9, data_fim=$10, progresso=$11
    WHERE id=$12
  `, [nome, chamado || '', cliente_id || null, gp_id || null, tipo, fase, status_prazo, resumo, data_inicio, data_fim, progresso, req.params.id]);
  res.json(await loadProject(req.params.id));
});

router.delete('/:id', requireAdminIfSetting('restringir_exclusao'), async (req, res) => {
  await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Tarefas por area dentro de um projeto
router.post('/:id/tarefas', requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const { area, inicio, fim, status } = req.body;
  if (!area || !inicio || !fim) return res.status(400).json({ error: 'area, inicio e fim sao obrigatorios' });
  const { rows } = await pool.query(
    'INSERT INTO area_tasks (project_id, area, inicio, fim, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [req.params.id, area, inicio, fim, status || 'planejamento']
  );
  res.status(201).json(rows[0]);
});

router.put('/:id/tarefas/:taskId', requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const { area, inicio, fim, status } = req.body;
  await pool.query(
    'UPDATE area_tasks SET area=$1, inicio=$2, fim=$3, status=$4 WHERE id=$5 AND project_id=$6',
    [area, inicio, fim, status, req.params.taskId, req.params.id]
  );
  res.json({ ok: true });
});

router.delete('/:id/tarefas/:taskId', requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  await pool.query('DELETE FROM area_tasks WHERE id=$1 AND project_id=$2', [req.params.taskId, req.params.id]);
  res.json({ ok: true });
});

// Historico
router.post('/:id/historico', async (req, res) => {
  const { texto, autor, data } = req.body;
  if (!texto) return res.status(400).json({ error: 'texto obrigatorio' });
  const { rows } = await pool.query(
    'INSERT INTO historico (project_id, data, texto, autor) VALUES ($1, $2, $3, $4) RETURNING id',
    [req.params.id, data || new Date().toISOString().slice(0, 10), texto, autor || '']
  );
  res.status(201).json(rows[0]);
});

module.exports = router;
