const express = require('express');
const { pool } = require('../db');
const { requireChamadosAuth } = require('../chamadosAuth');
const { calcularChamado, calcularChamadoPorRecurso } = require('../chamadosCalculo');
const router = express.Router();

// Calcula o valor financeiro de um chamado de acordo com o modo escolhido - 'unico'
// (um valor de hora so, com QA/Gerencial em %) ou 'por_recurso' (cada papel com seu
// proprio valor de hora, informado diretamente, sem % automatico).
function calcularPorModo(dados) {
  if (dados.modo_precificacao === 'por_recurso') {
    return calcularChamadoPorRecurso({
      recursosHoras: dados.recursos_horas || [],
      pctMargem: dados.pct_margem,
      pctNegociado: dados.pct_negociado,
    });
  }
  return calcularChamado({
    horasDev: dados.horas_dev,
    pctMargem: dados.pct_margem,
    pctNegociado: dados.pct_negociado,
    pctQaAplicado: dados.pct_qa_aplicado,
    pctGerencialAplicado: dados.pct_gerencial_aplicado,
    valorHoraAplicado: dados.valor_hora_aplicado,
  });
}

async function carregarChamadosCalculados() {
  const { rows } = await pool.query(`
    SELECT ch.*, cl.nome AS cliente_nome, an.nome AS analista_nome,
      mp.nome AS modelo_parcelamento_nome, mp.parcelas AS modelo_parcelamento_parcelas,
      tr.nome AS tabela_recurso_nome
    FROM chamados ch
    LEFT JOIN chamados_clientes cl ON cl.id = ch.cliente_id
    LEFT JOIN chamados_analistas an ON an.id = ch.analista_id
    LEFT JOIN chamados_modelos_parcelamento mp ON mp.id = ch.modelo_parcelamento_id
    LEFT JOIN chamados_tabelas_recurso tr ON tr.id = ch.tabela_recurso_id
    ORDER BY ch.criado_em DESC
    LIMIT 1000
  `);
  return rows.map(r => {
    // horas_qa/gerencial/total_horas/etc so fazem sentido no modo "unico" (sao sempre
    // calculados ao vivo, nao gravados); no modo "por_recurso" ficam nulos, ja que o
    // conceito de "um total de horas" nao existe do mesmo jeito.
    // Ja o valor financeiro final usa sempre o campo "_real" gravado, que e a fonte de
    // verdade (pode ter sido ajustado manualmente e nao bater 100% com a formula pura).
    let extras = { qa: null, gerencial: null, total_horas: null, horas_margem: null, total_geral: null };
    if (r.modo_precificacao !== 'por_recurso') {
      const calcAoVivo = calcularChamado({
        horasDev: r.horas_dev,
        pctMargem: r.pct_margem,
        pctNegociado: r.pct_negociado,
        pctQaAplicado: r.pct_qa_aplicado,
        pctGerencialAplicado: r.pct_gerencial_aplicado,
        valorHoraAplicado: r.valor_hora_aplicado,
      });
      extras = {
        qa: calcAoVivo.qa,
        gerencial: calcAoVivo.gerencial,
        total_horas: calcAoVivo.total_horas,
        horas_margem: calcAoVivo.horas_margem,
        total_geral: calcAoVivo.total_geral,
      };
    }
    return {
      ...r,
      ...extras,
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

  const calc = calcularPorModo(b);

  try {
    const { rows } = await pool.query(
      `INSERT INTO chamados
        (numero, cliente_id, analista_id, descricao, status, data_abertura, grupo_trabalho, complexidade, proposta_status,
         data_envio_proposta, data_aprovacao, horas_dev, pct_margem, pct_negociado, qtd_parcelas, modelo_parcelamento_id,
         pct_qa_aplicado, pct_gerencial_aplicado, valor_hora_aplicado,
         modo_precificacao, tabela_recurso_id, recursos_horas,
         valor_projeto_real, desconto_negociado_real, valor_total_projeto_real)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23,$24,$25)
       RETURNING *`,
      [
        b.numero, b.cliente_id || null, b.analista_id || null, b.descricao || '', b.status || '',
        b.data_abertura || new Date().toISOString().slice(0, 10), b.grupo_trabalho || null, b.complexidade || null, b.proposta_status || null,
        b.data_envio_proposta || null, b.data_aprovacao || null,
        b.horas_dev || 0, b.pct_margem || 0, b.pct_negociado || 0, b.qtd_parcelas || 1, b.modelo_parcelamento_id || null,
        b.pct_qa_aplicado || 0, b.pct_gerencial_aplicado || 0, b.valor_hora_aplicado || 0,
        b.modo_precificacao || 'unico', b.tabela_recurso_id || null, JSON.stringify(b.recursos_horas || null),
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
    'numero', 'descricao', 'status', 'analista_id', 'grupo_trabalho', 'complexidade', 'proposta_status',
    'data_envio_proposta', 'data_aprovacao', 'horas_dev', 'pct_margem', 'pct_negociado', 'qtd_parcelas', 'modelo_parcelamento_id',
    'pct_qa_aplicado', 'pct_gerencial_aplicado', 'valor_hora_aplicado', 'cliente_id', 'data_abertura',
    'modo_precificacao', 'tabela_recurso_id', 'recursos_horas',
  ];
  // mescla o que ja existia com o que veio no corpo, pra recalcular o valor financeiro com os dados completos
  const mesclado = { ...antigo };
  camposPermitidos.forEach(campo => {
    if (b[campo] !== undefined) mesclado[campo] = b[campo];
  });

  const calc = calcularPorModo(mesclado);

  const campos = [];
  const valores = [];
  let i = 1;
  camposPermitidos.forEach(campo => {
    if (b[campo] !== undefined) {
      if (campo === 'recursos_horas') {
        campos.push(`${campo} = $${i++}::jsonb`);
        valores.push(JSON.stringify(b[campo]));
      } else {
        campos.push(`${campo} = $${i++}`);
        valores.push(b[campo]);
      }
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

router.delete('/:id', requireChamadosAuth, async (req, res) => {
  const existente = (await pool.query('SELECT id FROM chamados WHERE id = $1', [req.params.id])).rows[0];
  if (!existente) return res.status(404).json({ error: 'chamado nao encontrado' });
  await pool.query('DELETE FROM chamados WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
