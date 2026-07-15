const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM areas ORDER BY nome').all();
  res.json(rows.map(r => r.nome));
});

router.post('/', (req, res) => {
  const { nome } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'nome da area obrigatorio' });
  try {
    const info = db.prepare('INSERT INTO areas (nome) VALUES (?)').run(nome.trim());
    res.status(201).json({ id: info.lastInsertRowid, nome: nome.trim() });
  } catch (e) {
    res.status(400).json({ error: 'ja existe uma area com esse nome' });
  }
});

router.delete('/:nome', (req, res) => {
  const nome = decodeURIComponent(req.params.nome);
  const emUso = db.prepare('SELECT COUNT(*) AS n FROM area_tasks WHERE area = ?').get(nome).n
    + db.prepare(`SELECT COUNT(*) AS n FROM gps WHERE areas LIKE ?`).get('%"' + nome + '"%').n;
  if (emUso > 0) {
    return res.status(400).json({ error: 'essa area esta em uso por projetos ou GPs e nao pode ser removida' });
  }
  db.prepare('DELETE FROM areas WHERE nome = ?').run(nome);
  res.json({ ok: true });
});

module.exports = router;
