const express = require('express');
const { pool } = require('../db');
const { registrarAuditoria } = require('../audit');
const router = express.Router();

router.get('/', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT d.*, p.nome AS projeto_nome, i.nome AS implantador_nome
    FROM demandas_avulsas d
    LEFT JOIN projects p ON p.id = d.project_id
    LEFT JOIN implantadores i ON i.id = d.implantador_id
    ORDER BY d.data_inicio
  `);
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { implantador_id, titulo, cliente_nome, chamado_numero, data_inicio, data_fim, horas_esforco, pct_dedicacao, status, tipo, project_id, trabalha_fim_semana, turno } = req.body;
  if (!implantador_id) return res.status(400).json({ error: 'implantador_id obrigatorio' });
  if (!titulo || !titulo.trim()) return res.status(400).json({ error: 'titulo obrigatorio' });
  if (!data_inicio) return res.status(400).json({ error: 'data_inicio obrigatoria' });
  const pct = Number(pct_dedicacao);
  if (!pct || pct <= 0 || pct > 100) return res.status(400).json({ error: 'pct_dedicacao deve estar entre 1 e 100' });

  const { rows } = await pool.query(
    `INSERT INTO demandas_avulsas
      (implantador_id, titulo, cliente_nome, chamado_numero, data_inicio, data_fim, horas_esforco, pct_dedicacao, status, tipo, project_id, trabalha_fim_semana, turno)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [implantador_id, titulo.trim(), cliente_nome || '', chamado_numero || '', data_inicio, data_fim || null,
     horas_esforco || 0, pct, status || 'Pendente', tipo === 'ausencia' ? 'ausencia' : 'demanda', project_id || null, !!trabalha_fim_semana,
     turno === 'noturno' ? 'noturno' : 'diurno']
  );
  await registrarAuditoria({
    entidade: 'demanda_avulsa', entidade_id: rows[0].id, acao: 'criado',
    autor: req.header('x-autor') || 'anônimo', detalhes: `Demanda "${titulo.trim()}" criada`,
  });
  res.status(201).json(rows[0]);
});

router.put('/:id', async (req, res) => {
  const { titulo, cliente_nome, chamado_numero, data_inicio, data_fim, horas_esforco, pct_dedicacao, status, tipo, project_id, trabalha_fim_semana, turno } = req.body;
  const pct = Number(pct_dedicacao);
  if (!pct || pct <= 0 || pct > 100) return res.status(400).json({ error: 'pct_dedicacao deve estar entre 1 e 100' });
  await pool.query(
    `UPDATE demandas_avulsas SET titulo=$1, cliente_nome=$2, chamado_numero=$3, data_inicio=$4, data_fim=$5,
       horas_esforco=$6, pct_dedicacao=$7, status=$8, tipo=$9, project_id=$10, trabalha_fim_semana=$11, turno=$12
     WHERE id=$13`,
    [titulo, cliente_nome || '', chamado_numero || '', data_inicio, data_fim || null,
     horas_esforco || 0, pct, status, tipo === 'ausencia' ? 'ausencia' : 'demanda', project_id || null, !!trabalha_fim_semana,
     turno === 'noturno' ? 'noturno' : 'diurno', req.params.id]
  );
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const demanda = (await pool.query('SELECT * FROM demandas_avulsas WHERE id = $1', [req.params.id])).rows[0];
  await pool.query('DELETE FROM demandas_avulsas WHERE id = $1', [req.params.id]);
  await registrarAuditoria({
    entidade: 'demanda_avulsa', entidade_id: Number(req.params.id), acao: 'excluido',
    autor: req.header('x-autor') || 'anônimo', detalhes: demanda ? `Demanda "${demanda.titulo}" removida` : 'Demanda removida',
  });
  res.json({ ok: true });
});

module.exports = router;
