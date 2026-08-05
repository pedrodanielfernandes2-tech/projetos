const express = require('express');
const { pool } = require('../db');
const { requireChamadosAuth } = require('../chamadosAuth');
const router = express.Router();

router.get('/', requireChamadosAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT id, nome, papeis, ativo FROM chamados_tabelas_recurso ORDER BY nome');
  res.json(rows);
});

function validarPapeis(papeis) {
  if (!Array.isArray(papeis) || papeis.length === 0) return 'informe ao menos um papel';
  for (const p of papeis) {
    if (!p.papel || !String(p.papel).trim()) return 'cada papel precisa de um nome';
    if (typeof p.valor_hora !== 'number' || p.valor_hora <= 0) return `o papel "${p.papel}" precisa de um valor de hora válido (maior que 0)`;
  }
  return null;
}

router.post('/', requireChamadosAuth, async (req, res) => {
  const { nome, papeis } = req.body;
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'nome obrigatorio' });
  const erro = validarPapeis(papeis);
  if (erro) return res.status(400).json({ error: erro });

  const papeisNormalizados = papeis.map(p => ({ papel: String(p.papel).trim(), valor_hora: Number(p.valor_hora) }));
  const { rows } = await pool.query(
    'INSERT INTO chamados_tabelas_recurso (nome, papeis) VALUES ($1, $2::jsonb) RETURNING id, nome, papeis, ativo',
    [nome.trim(), JSON.stringify(papeisNormalizados)]
  );
  res.status(201).json(rows);
});

router.patch('/:id', requireChamadosAuth, async (req, res) => {
  const { nome, papeis, ativo } = req.body;
  const campos = [];
  const valores = [];
  let i = 1;

  if (nome !== undefined) {
    if (!nome.trim()) return res.status(400).json({ error: 'nome obrigatorio' });
    campos.push(`nome = $${i++}`);
    valores.push(nome.trim());
  }
  if (papeis !== undefined) {
    const erro = validarPapeis(papeis);
    if (erro) return res.status(400).json({ error: erro });
    const papeisNormalizados = papeis.map(p => ({ papel: String(p.papel).trim(), valor_hora: Number(p.valor_hora) }));
    campos.push(`papeis = $${i++}::jsonb`);
    valores.push(JSON.stringify(papeisNormalizados));
  }
  if (ativo !== undefined) {
    campos.push(`ativo = $${i++}`);
    valores.push(!!ativo);
  }
  if (campos.length === 0) return res.json({ ok: true });
  valores.push(req.params.id);
  await pool.query(`UPDATE chamados_tabelas_recurso SET ${campos.join(', ')} WHERE id = $${i}`, valores);
  res.json({ ok: true });
});

router.delete('/:id', requireChamadosAuth, async (req, res) => {
  const emUso = (await pool.query('SELECT COUNT(*)::int AS n FROM chamados WHERE tabela_recurso_id = $1', [req.params.id])).rows[0].n;
  if (emUso > 0) {
    return res.status(400).json({ error: `essa tabela está em uso em ${emUso} chamado(s) - desative em vez de excluir` });
  }
  await pool.query('DELETE FROM chamados_tabelas_recurso WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
