const express = require('express');
const { pool } = require('../db');
const { requireAdminIfSetting } = require('../adminAuth');
const { registrarAuditoria } = require('../audit');
const router = express.Router();

function getAutor(req) {
  return req.header('x-autor') || 'anônimo';
}

router.put('/:itemId', requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const { titulo, area, acao, responsavel, status, data_inicio, data_fim, observacao } = req.body;
  const antigo = (await pool.query('SELECT * FROM wbs_items WHERE id = $1', [req.params.itemId])).rows[0];
  if (!antigo) return res.status(404).json({ error: 'item nao encontrado' });

  await pool.query(
    `UPDATE wbs_items SET titulo=$1, area=$2, acao=$3, responsavel=$4, status=$5, data_inicio=$6, data_fim=$7, observacao=$8 WHERE id=$9`,
    [titulo, area || '', acao || '', responsavel || '', status, data_inicio || null, data_fim || null, observacao || '', req.params.itemId]
  );

  const mudancas = [];
  let envolveData = false;
  if (titulo !== undefined && antigo.titulo !== titulo) mudancas.push(`título: "${antigo.titulo}" → "${titulo}"`);
  if (data_inicio !== undefined && (antigo.data_inicio || '') !== (data_inicio || '')) {
    mudancas.push(`início: ${antigo.data_inicio || 'sem data'} → ${data_inicio || 'sem data'}`);
    envolveData = true;
  }
  if (data_fim !== undefined && (antigo.data_fim || '') !== (data_fim || '')) {
    mudancas.push(`fim: ${antigo.data_fim || 'sem data'} → ${data_fim || 'sem data'}`);
    envolveData = true;
  }
  if (status !== undefined && antigo.status !== status) mudancas.push(`status: ${antigo.status} → ${status}`);

  await registrarAuditoria({
    entidade: 'wbs_item', entidade_id: Number(req.params.itemId), projeto_id: antigo.project_id,
    acao: 'editado', autor: getAutor(req),
    detalhes: `Item WBS "${antigo.titulo}": ` + (mudancas.length > 0 ? mudancas.join('; ') : 'sem alterações detectadas'),
    envolve_data: envolveData,
  });

  res.json({ ok: true });
});

router.delete('/:itemId', requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const item = (await pool.query('SELECT * FROM wbs_items WHERE id = $1', [req.params.itemId])).rows[0];
  await pool.query('DELETE FROM wbs_items WHERE id = $1', [req.params.itemId]);
  if (item) {
    await registrarAuditoria({
      entidade: 'wbs_item', entidade_id: Number(req.params.itemId), projeto_id: item.project_id,
      acao: 'excluido', autor: getAutor(req), detalhes: `Item WBS "${item.titulo}" removido (e seus sub-itens, se houver)`,
    });
  }
  res.json({ ok: true });
});

// Troca a ordem do item com o irmao (mesmo parent) imediatamente acima ou abaixo.
router.post('/:itemId/mover', requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const { direcao } = req.body; // 'up' ou 'down'
  const atual = (await pool.query('SELECT * FROM wbs_items WHERE id = $1', [req.params.itemId])).rows[0];
  if (!atual) return res.status(404).json({ error: 'item nao encontrado' });

  const comparador = direcao === 'up' ? '<' : '>';
  const ordenacao = direcao === 'up' ? 'DESC' : 'ASC';
  const { rows } = await pool.query(
    `SELECT * FROM wbs_items WHERE project_id = $1 AND parent_id IS NOT DISTINCT FROM $2 AND ordem ${comparador} $3 ORDER BY ordem ${ordenacao} LIMIT 1`,
    [atual.project_id, atual.parent_id, atual.ordem]
  );
  const vizinho = rows[0];
  if (!vizinho) return res.json({ ok: true }); // ja esta na ponta, nada a fazer

  await pool.query('UPDATE wbs_items SET ordem = $1 WHERE id = $2', [vizinho.ordem, atual.id]);
  await pool.query('UPDATE wbs_items SET ordem = $1 WHERE id = $2', [atual.ordem, vizinho.id]);
  res.json({ ok: true });
});

module.exports = router;
