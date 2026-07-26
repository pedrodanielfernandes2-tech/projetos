const express = require('express');
const { pool } = require('../db');
const { requireChamadosAuth } = require('../chamadosAuth');
const { calcularChamado } = require('../chamadosCalculo');
const router = express.Router();

async function carregarChamadosCalculados() {
  const { rows } = await pool.query(`
    SELECT ch.*, cl.nome AS cliente_nome, an.nome AS analista_nome
    FROM chamados ch
    LEFT JOIN chamados_clientes cl ON cl.id = ch.cliente_id
    LEFT JOIN chamados_analistas an ON an.id = ch.analista_id
    ORDER BY ch.criado_em DESC
    LIMIT 1000
  `);
  return rows.map(r => {
    // horas_qa/gerencial/total_horas/etc sao sempre calculados ao vivo (nao gravados);
    // ja o valor financeiro final usa o campo "_real" gravado, que e a fonte de verdade
    // (pode ter sido ajustado manualmente e nao bater 100% com a formula pura).
    const calcAoVivo = calcularChamado({
      horasDev: r.horas_dev,
      pctMargem: r.pct_margem,
      pctNegociado: r.pct_negociado,
      pctQaAplicado: r.pct_qa_aplicado,
      pctGerencialAplicado: r.pct_gerencial_aplicado,
      valorHoraAplicado: r.valor_hora_aplicado,
    });
    return {
      ...r,
      qa: calcAoVivo.qa,
      gerencial: calcAoVivo.gerencial,
      total_horas: calcAoVivo.total_horas,
      horas_margem: calcAoVivo.horas_margem,
      total_geral: calcAoVivo.total_geral,
      valor_projeto: r.valor_projeto_real,
      desconto_negociado: r.desconto_negociado_real,
      valor_total_projeto: r.valor_total_projeto_real,
    };
  });
}

router.get('/', requireChamadosAuth, async (req, res) => {
  res.json(await carregarChamadosCalculados());
});

router.get('/:id', requireChamadosAuth, async (req, res) => {
  const todos = await carregarChamadosCalculados();
  const item = todos.find(c => String(c.id) === req.params.id);
  if (!item) return res.status(404).json({ error: 'chamado nao encontrado' });
  res.json([item]);
});

router.post('/', requireChamadosAuth, async (req, res) => {
  const b = req.body;
  if (!b.numero) return res.status(400).json({ error: 'numero obrigatorio' });

  const calc = calcularChamado({
    horasDev: b.horas_dev,
    pctMargem: b.pct_margem,
    pctNegociado: b.pct_negociado,
    pctQaAplicado: b.pct_qa_aplicado,
    pctGerencialAplicado: b.pct_gerencial_aplicado,
    valorHoraAplicado: b.valor_hora_aplicado,
  });

  try {
    const { rows } = await pool.query(
      `INSERT INTO chamados
        (numero, cliente_id, analista_id, descricao, status, data_abertura, grupo_trabalho, complexidade, proposta_status,
         data_envio_proposta, data_aprovacao, horas_dev, pct_margem, pct_negociado, qtd_parcelas,
         pct_qa_aplicado, pct_gerencial_aplicado, valor_hora_aplicado,
         valor_projeto_real, desconto_negociado_real, valor_total_projeto_real)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING *`,
      [
        b.numero, b.cliente_id || null, b.analista_id || null, b.descricao || '', b.status || '',
        b.data_abertura || new Date().toISOString().slice(0, 10), b.grupo_trabalho || null, b.complexidade || null, b.proposta_status || null,
        b.data_envio_proposta || null, b.data_aprovacao || null,
        b.horas_dev || 0, b.pct_margem || 0, b.pct_negociado || 0, b.qtd_parcelas || 1,
        b.pct_qa_aplicado || 0, b.pct_gerencial_aplicado || 0, b.valor_hora_aplicado || 0,
        calc.valor_projeto, calc.desconto_negociado, calc.valor_total_projeto,
      ]
    );
    res.status(201).json(rows);
  } catch (e) {
    res.status(400).json({ error: 'falha ao criar chamado: ' + e.message });
  }
});

router.patch('/:id', requireChamadosAuth, async (req, res) => {
  const antigo = (await pool.query('SELECT * FROM chamados WHERE id = $1', [req.params.id])).rows[0];
  if (!antigo) return res.status(404).json({ error: 'chamado nao encontrado' });

  const b = req.body;
  const camposPermitidos = [
    'descricao', 'status', 'analista_id', 'grupo_trabalho', 'complexidade', 'proposta_status',
    'data_envio_proposta', 'data_aprovacao', 'horas_dev', 'pct_margem', 'pct_negociado', 'qtd_parcelas',
    'pct_qa_aplicado', 'pct_gerencial_aplicado', 'valor_hora_aplicado', 'cliente_id', 'data_abertura',
  ];
  // mescla o que ja existia com o que veio no corpo, pra recalcular o valor financeiro com os dados completos
  const mesclado = { ...antigo };
  camposPermitidos.forEach(campo => {
    if (b[campo] !== undefined) mesclado[campo] = b[campo];
  });

  const calc = calcularChamado({
    horasDev: mesclado.horas_dev,
    pctMargem: mesclado.pct_margem,
    pctNegociado: mesclado.pct_negociado,
    pctQaAplicado: mesclado.pct_qa_aplicado,
    pctGerencialAplicado: mesclado.pct_gerencial_aplicado,
    valorHoraAplicado: mesclado.valor_hora_aplicado,
  });

  const campos = [];
  const valores = [];
  let i = 1;
  camposPermitidos.forEach(campo => {
    if (b[campo] !== undefined) {
      campos.push(`${campo} = $${i++}`);
      valores.push(b[campo]);
    }
  });
  campos.push(`valor_projeto_real = $${i++}`); valores.push(calc.valor_projeto);
  campos.push(`desconto_negociado_real = $${i++}`); valores.push(calc.desconto_negociado);
  campos.push(`valor_total_projeto_real = $${i++}`); valores.push(calc.valor_total_projeto);
  campos.push(`atualizado_em = NOW()`);

  valores.push(req.params.id);
  await pool.query(`UPDATE chamados SET ${campos.join(', ')} WHERE id = $${i}`, valores);
  res.json({ ok: true });
});

module.exports = router;
