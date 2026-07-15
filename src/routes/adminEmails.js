const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM admin_emails ORDER BY email').all());
});

router.post('/', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email obrigatorio' });
  try {
    const info = db.prepare('INSERT INTO admin_emails (email) VALUES (?)').run(email);
    res.status(201).json({ id: info.lastInsertRowid, email });
  } catch (e) {
    res.status(400).json({ error: 'esse e-mail ja esta cadastrado' });
  }
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM admin_emails WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
