const express = require('express');
const { pool } = require('../db');
const { requireAdminAlways } = require('../adminAuth');
const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM admin_emails ORDER BY email');
  res.json(rows);
});

router.post('/', requireAdminAlways, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email obrigatorio' });
  try {
    const { rows } = await pool.query('INSERT INTO admin_emails (email) VALUES ($1) RETURNING *', [email]);
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(400).json({ error: 'esse e-mail ja esta cadastrado' });
  }
});

router.delete('/:id', requireAdminAlways, async (req, res) => {
  await pool.query('DELETE FROM admin_emails WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
