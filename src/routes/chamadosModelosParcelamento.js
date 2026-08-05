const express = require('express');
const { pool } = require('../db');
const { requireChamadosAuth } = require('../chamadosAuth');
const router = express.Router();

router.get('/', requireChamadosAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, nome, parcelas, ativo FROM chamados_modelos_parcelamento ORDER BY nome');
  res.json(rows);
});

function validarParcelas(parcelas) {
  if (!Array.isArray(parcelas) || parcelas.length === 0) return 'informe ao menos uma parcela';
  for (const p of parcelas) {
    if (typeof p.dias !== 'number' || p.dias < 0) return 'cada parcela precisa de um número de dias válido (0 ou mais)';
    if (typeof p.percentual !== 'number' || p.percentual <= 0 || p.percentual > 1) return 'cada parcela precisa de um percentual entre 0% e 100%';
  }
  const somaPercentuais = parcelas.reduce((s, p) => s + p.percentual, 0);
  if (Math.abs(somaPercentuais - 1) > 0.01) return `os percentuais precisam somar 100% (hoje somam ${Math.round(somaPercentuais * 100)}%)`;
  return null;
}

router.post('/', requireChamadosAuth, async (req, res) => {
  const { nome, parcelas } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'nome obrigatorio' });
  const erro = validarParcelas(parcelas);
  if (erro) return res.status(400).json({ error: erro });

  const parcelasOrdenadas = [...parcelas].sort((a, b) => a.dias - b.dias);
  const { rows } = await pool.query(
    'INSERT INTO chamados_modelos_parcelamento (nome, parcelas) VALUES ($1, $2::jsonb) RETURNING id, nome, parcelas, ativo',
    [nome.trim(), JSON.stringify(parcelasOrdenadas)]
  );
  res.status(201).json(rows);
});

router.patch('/:id', requireChamadosAuth, async (req, res) => {
  const { nome, parcelas, ativo } = req.body;
  const campos = [];
  const valores = [];
  let i = 1;

  if (nome !== undefined) {
    if (!nome.trim()) return res.status(400).json({ error: 'nome obrigatorio' });
    campos.push(`nome = $${i++}`);
    valores.push(nome.trim());
  }
  if (parcelas !== undefined) {
    const erro = validarParcelas(parcelas);
    if (erro) return res.status(400).json({ error: erro });
    const parcelasOrdenadas = [...parcelas].sort((a, b) => a.dias - b.dias);
    campos.push(`parcelas = $${i++}::jsonb`);
    valores.push(JSON.stringify(parcelasOrdenadas));
  }
  if (ativo !== undefined) {
    campos.push(`ativo = $${i++}`);
    valores.push(!!ativo);
  }
  if (campos.length === 0) return res.json({ ok: true });
  valores.push(req.params.id);
  await pool.query(`UPDATE chamados_modelos_parcelamento SET ${campos.join(', ')} WHERE id = $${i}`, valores);
  res.json({ ok: true });
});

router.delete('/:id', requireChamadosAuth, async (req, res) => {
  const emUso = (await pool.query('SELECT COUNT(*)::int AS n FROM chamados WHERE modelo_parcelamento_id = $1', [req.params.id])).rows[0].n;
  if (emUso > 0) {
    return res.status(400).json({ error: `esse modelo está em uso em ${emUso} chamado(s) - desative em vez de excluir, ou primeiro troque o modelo desses chamados` });
  }
  await pool.query('DELETE FROM chamados_modelos_parcelamento WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
