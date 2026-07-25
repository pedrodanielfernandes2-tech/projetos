const express = require('express');
const { pool } = require('../chamadosDb');
const { requireChamadosAuth } = require('../chamadosAuth');
const router = express.Router();

// todas as rotas de chamados exigem a senha, sem exceção (nem leitura é livre)
router.use(requireChamadosAuth);

// Lista chamados já com os valores calculados (usa a mesma view que já existia
// no Supabase: chamados_calculado). Continua funcionando igual, só que agora
// quem consulta é o servidor, não mais o navegador direto.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM chamados_calculado ORDER BY criado_em DESC LIMIT 1000'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'falha ao buscar chamados: ' + e.message });
  }
});

router.post('/', async (req, res) => {
  const c = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO chamados (
        numero, cliente_id, descricao, status, analista_id, grupo_trabalho, complexidade,
        proposta_status, data_envio_proposta, data_aprovacao, horas_dev, pct_margem,
        pct_negociado, qtd_parcelas, pct_qa_aplicado, pct_gerencial_aplicado, valor_hora_aplicado
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *`,
      [
        c.numero, c.cliente_id, c.descricao || null, c.status, c.analista_id || null,
        c.grupo_trabalho || null, c.complexidade || null, c.proposta_status || null,
        c.data_envio_proposta || null, c.data_aprovacao || null, c.horas_dev,
        c.pct_margem, c.pct_negociado, c.qtd_parcelas || 1,
        c.pct_qa_aplicado, c.pct_gerencial_aplicado, c.valor_hora_aplicado,
      ]
    );
    res.status(201).json(rows);
  } catch (e) {
    res.status(500).json({ error: 'falha ao criar chamado: ' + e.message });
  }
});

router.patch('/:id', async (req, res) => {
  const campos = req.body;
  const colunasPermitidas = [
    'descricao', 'status', 'analista_id', 'grupo_trabalho', 'complexidade',
    'proposta_status', 'data_envio_proposta', 'data_aprovacao', 'horas_dev',
    'pct_margem', 'pct_negociado', 'qtd_parcelas', 'pct_qa_aplicado',
    'pct_gerencial_aplicado', 'valor_hora_aplicado',
  ];
  const sets = [];
  const valores = [];
  for (const col of colunasPermitidas) {
    if (campos[col] !== undefined) {
      valores.push(campos[col]);
      sets.push(`${col} = $${valores.length}`);
    }
  }
  if (sets.length === 0) return res.status(400).json({ error: 'nenhum campo para atualizar' });
  valores.push(req.params.id);
  try {
    const { rows } = await pool.query(
      `UPDATE chamados SET ${sets.join(', ')}, atualizado_em = now() WHERE id = $${valores.length} RETURNING *`,
      valores
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'falha ao atualizar chamado: ' + e.message });
  }
});

module.exports = router;
