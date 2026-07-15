const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM gps ORDER BY nome').all();
  res.json(rows.map(r => ({ ...r, areas: JSON.parse(r.areas) })));
});

router.post('/', (req, res) => {
  const { nome, email, areas } = req.body;
  if (!nome || !email || !Array.isArray(areas) || areas.length === 0) {
    return res.status(400).json({ error: 'nome, email e ao menos uma area sao obrigatorios' });
  }
  try {
    const stmt = db.prepare('INSERT INTO gps (nome, email, areas) VALUES (?, ?, ?)');
    const info = stmt.run(nome, email, JSON.stringify(areas));
    res.status(201).json({ id: info.lastInsertRowid, nome, email, areas });
  } catch (e) {
    res.status(400).json({ error: 'ja existe um GP com esse e-mail' });
  }
});

router.put('/:id', (req, res) => {
  const { nome, email, areas } = req.body;
  db.prepare('UPDATE gps SET nome = ?, email = ?, areas = ? WHERE id = ?')
    .run(nome, email, JSON.stringify(areas || []), req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM gps WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
