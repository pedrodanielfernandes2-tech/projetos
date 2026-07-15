const express = require('express');
const db = require('../db');
const router = express.Router();

function loadProject(id) {
  const project = db.prepare(`
    SELECT p.*, g.nome AS gerente_nome, g.email AS gerente_email
    FROM projects p LEFT JOIN gps g ON g.id = p.gp_id
    WHERE p.id = ?
  `).get(id);
  if (!project) return null;
  project.tarefas = db.prepare('SELECT * FROM area_tasks WHERE project_id = ? ORDER BY inicio').all(id);
  project.historico = db.prepare('SELECT * FROM historico WHERE project_id = ? ORDER BY data DESC, id DESC').all(id);
  return project;
}

router.get('/', (req, res) => {
  const { area } = req.query;
  let ids;
  if (area) {
    ids = db.prepare('SELECT DISTINCT project_id FROM area_tasks WHERE area = ?').all(area).map(r => r.project_id);
  } else {
    ids = db.prepare('SELECT id FROM projects').all().map(r => r.id);
  }
  res.json(ids.map(loadProject).filter(Boolean));
});

router.get('/:id', (req, res) => {
  const project = loadProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'projeto nao encontrado' });
  res.json(project);
});

router.post('/', (req, res) => {
  const { nome, gp_id, tipo, fase, status_prazo, resumo, data_inicio, data_fim, progresso, tarefas } = req.body;
  if (!nome || !data_inicio || !data_fim || !Array.isArray(tarefas) || tarefas.length === 0) {
    return res.status(400).json({ error: 'nome, datas gerais e ao menos uma tarefa de area sao obrigatorios' });
  }
  const info = db.prepare(`
    INSERT INTO projects (nome, gp_id, tipo, fase, status_prazo, resumo, data_inicio, data_fim, progresso)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(nome, gp_id || null, tipo || 'Melhoria', fase || 'Levantamento', status_prazo || 'em dia', resumo || '', data_inicio, data_fim, progresso || 0);

  const projectId = info.lastInsertRowid;
  const insertTask = db.prepare('INSERT INTO area_tasks (project_id, area, inicio, fim, status) VALUES (?, ?, ?, ?, ?)');
  for (const t of tarefas) {
    insertTask.run(projectId, t.area, t.inicio, t.fim, t.status || 'planejamento');
  }
  db.prepare('INSERT INTO historico (project_id, data, texto, autor) VALUES (?, date(\'now\'), ?, ?)')
    .run(projectId, 'Projeto cadastrado.', req.body.autor || 'sistema');

  res.status(201).json(loadProject(projectId));
});

router.put('/:id', (req, res) => {
  const { nome, gp_id, tipo, fase, status_prazo, resumo, data_inicio, data_fim, progresso } = req.body;
  db.prepare(`
    UPDATE projects SET nome=?, gp_id=?, tipo=?, fase=?, status_prazo=?, resumo=?, data_inicio=?, data_fim=?, progresso=?
    WHERE id=?
  `).run(nome, gp_id || null, tipo, fase, status_prazo, resumo, data_inicio, data_fim, progresso, req.params.id);
  res.json(loadProject(req.params.id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Tarefas por area dentro de um projeto
router.post('/:id/tarefas', (req, res) => {
  const { area, inicio, fim, status } = req.body;
  if (!area || !inicio || !fim) return res.status(400).json({ error: 'area, inicio e fim sao obrigatorios' });
  const info = db.prepare('INSERT INTO area_tasks (project_id, area, inicio, fim, status) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.id, area, inicio, fim, status || 'planejamento');
  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/:id/tarefas/:taskId', (req, res) => {
  const { area, inicio, fim, status } = req.body;
  db.prepare('UPDATE area_tasks SET area=?, inicio=?, fim=?, status=? WHERE id=? AND project_id=?')
    .run(area, inicio, fim, status, req.params.taskId, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id/tarefas/:taskId', (req, res) => {
  db.prepare('DELETE FROM area_tasks WHERE id=? AND project_id=?').run(req.params.taskId, req.params.id);
  res.json({ ok: true });
});

// Historico
router.post('/:id/historico', (req, res) => {
  const { texto, autor, data } = req.body;
  if (!texto) return res.status(400).json({ error: 'texto obrigatorio' });
  const info = db.prepare('INSERT INTO historico (project_id, data, texto, autor) VALUES (?, ?, ?, ?)')
    .run(req.params.id, data || new Date().toISOString().slice(0, 10), texto, autor || '');
  res.status(201).json({ id: info.lastInsertRowid });
});

module.exports = router;
