const express = require('express');
const { pool } = require('../db');
const { requireAdminAlways } = require('../adminAuth');
const { registrarAuditoria } = require('../audit');
const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT t.id, t.nome, t.criado_em, COUNT(i.id)::int AS total_itens
    FROM wbs_templates t
    LEFT JOIN wbs_template_items i ON i.template_id = t.id
    GROUP BY t.id
    ORDER BY t.nome
  `);
  res.json(rows);
});

router.delete('/:id', requireAdminAlways, async (req, res) => {
  const tpl = (await pool.query('SELECT * FROM wbs_templates WHERE id = $1', [req.params.id])).rows[0];
  await pool.query('DELETE FROM wbs_templates WHERE id = $1', [req.params.id]);
  if (tpl) {
    await registrarAuditoria({
      entidade: 'wbs_template', entidade_id: Number(req.params.id),
      acao: 'excluido', autor: req.header('x-autor') || 'anônimo', detalhes: `Modelo de WBS "${tpl.nome}" removido`,
    });
  }
  res.json({ ok: true });
});

module.exports = router;
