const express = require('express');
const { pool } = require('../db');
const router = express.Router();

// Junta as tarefas da WBS de TODOS os projetos (sem restricao de GP, de proposito -
// esse calendario e pensado pra visao geral de quem tem acesso a Projetos) que tem
// alguma parte passando pelo periodo pedido, agrupadas por projeto. Um projeto so
// aparece se tiver pelo menos uma tarefa cruzando essa janela de datas.
router.get('/', async (req, res) => {
  const { inicio, fim } = req.query;
  if (!inicio || !fim) return res.status(400).json({ error: 'informe inicio e fim (YYYY-MM-DD)' });

  const { rows } = await pool.query(`
    SELECT wi.id, wi.titulo, wi.area, wi.responsavel, wi.status, wi.data_inicio, wi.data_fim,
           p.id AS project_id, p.nome AS projeto_nome, p.chamado, c.nome AS cliente_nome
    FROM wbs_items wi
    JOIN projects p ON p.id = wi.project_id
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE wi.data_inicio IS NOT NULL AND wi.data_fim IS NOT NULL
      AND wi.data_inicio <= $2 AND wi.data_fim >= $1
    ORDER BY p.nome, wi.data_inicio
  `, [inicio, fim]);

  const projetosMap = {};
  rows.forEach((item) => {
    if (!projetosMap[item.project_id]) {
      projetosMap[item.project_id] = {
        project_id: item.project_id,
        nome: item.projeto_nome,
        chamado: item.chamado,
        cliente_nome: item.cliente_nome,
        itens: [],
      };
    }
    projetosMap[item.project_id].itens.push({
      id: item.id,
      titulo: item.titulo,
      area: item.area,
      responsavel: item.responsavel,
      status: item.status,
      data_inicio: item.data_inicio,
      data_fim: item.data_fim,
    });
  });

  res.json({ projetos: Object.values(projetosMap) });
});

module.exports = router;
