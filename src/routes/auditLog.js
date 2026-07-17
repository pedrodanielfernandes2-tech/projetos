const express = require('express');
const { pool } = require('../db');
const { requireAdminAlways } = require('../adminAuth');
const router = express.Router();

router.get('/', requireAdminAlways, async (req, res) => {
  const { projeto_id, apenas_datas } = req.query;
  const conditions = [];
  const params = [];
  if (projeto_id) {
    params.push(projeto_id);
    conditions.push(`projeto_id = $${params.length}`);
  }
  if (apenas_datas === 'true') {
    conditions.push('envolve_data = true');
  }
  let query = 'SELECT * FROM audit_log';
  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY criado_em DESC LIMIT 300';
  const { rows } = await pool.query(query, params);
  res.json(rows);
});

module.exports = router;
