const express = require('express');
const { pool } = require('../db');
const { requireAdminAlways } = require('../adminAuth');
const router = express.Router();

// Junta, por implantador, as tarefas vindas da WBS (casando pelo nome em
// wbs_items.responsavel, sempre 100% de dedicacao) com as demandas avulsas
// (que tem % proprio) - devolve um formato unico pro Gantt da tela desenhar.
router.get('/', requireAdminAlways, async (req, res) => {
  const { inicio, fim } = req.query;
  if (!inicio || !fim) return res.status(400).json({ error: 'informe inicio e fim (YYYY-MM-DD)' });

  const { rows: implantadores } = await pool.query('SELECT * FROM implantadores WHERE ativo = TRUE ORDER BY nome');

  const { rows: itensWbs } = await pool.query(`
    SELECT wi.id, wi.titulo, wi.responsavel, wi.status, wi.data_inicio, wi.data_fim, wi.horas_esforco,
           p.id AS projeto_id, p.nome AS projeto_nome, p.chamado AS chamado_numero, c.nome AS cliente_nome
    FROM wbs_items wi
    JOIN projects p ON p.id = wi.project_id
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE wi.responsavel != '' AND wi.data_inicio IS NOT NULL
      AND wi.data_fim IS NOT NULL AND wi.data_inicio <= $2 AND wi.data_fim >= $1
      AND wi.status NOT IN ('Concluído', 'Concluido')
  `, [inicio, fim]);

  const { rows: demandas } = await pool.query(`
    SELECT d.*, p.nome AS projeto_nome
    FROM demandas_avulsas d
    LEFT JOIN projects p ON p.id = d.project_id
    WHERE d.data_inicio IS NOT NULL
      AND COALESCE(d.data_fim, d.data_inicio) >= $1 AND d.data_inicio <= $2
  `, [inicio, fim]);

  const resultado = implantadores.map((imp) => {
    const nomeNormalizado = imp.nome.trim().toLowerCase();
    const tarefasWbs = itensWbs
      .filter((it) => it.responsavel.trim().toLowerCase() === nomeNormalizado)
      .map((it) => ({
        tipo: 'wbs',
        titulo: it.titulo,
        cliente_nome: it.cliente_nome || '',
        chamado_numero: it.chamado_numero || '',
        data_inicio: it.data_inicio,
        data_fim: it.data_fim,
        horas_esforco: Number(it.horas_esforco) || 0,
        pct_dedicacao: 100,
        status: it.status,
        projeto_id: it.projeto_id,
        projeto_nome: it.projeto_nome,
      }));

    const tarefasAvulsas = demandas
      .filter((d) => d.implantador_id === imp.id)
      .map((d) => ({
        id: d.id,
        tipo: d.tipo,
        titulo: d.titulo,
        cliente_nome: d.cliente_nome || '',
        chamado_numero: d.chamado_numero || '',
        data_inicio: d.data_inicio,
        data_fim: d.data_fim,
        horas_esforco: Number(d.horas_esforco) || 0,
        pct_dedicacao: Number(d.pct_dedicacao) || 100,
        status: d.status,
        projeto_id: d.project_id,
        projeto_nome: d.projeto_nome,
      }));

    return { id: imp.id, nome: imp.nome, tarefas: [...tarefasWbs, ...tarefasAvulsas] };
  });

  res.json({ implantadores: resultado });
});

module.exports = router;
