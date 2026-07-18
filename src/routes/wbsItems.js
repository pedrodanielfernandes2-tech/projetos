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

// Duplica um item e toda a sua subarvore, inserindo a copia como ultimo irmao.
router.post('/:itemId/duplicar', requireAdminIfSetting('restringir_edicao_prazos'), async (req, res) => {
  const original = (await pool.query('SELECT * FROM wbs_items WHERE id = $1', [req.params.itemId])).rows[0];
  if (!original) return res.status(404).json({ error: 'item nao encontrado' });

  const { rows: todasDoProjeto } = await pool.query('SELECT * FROM wbs_items WHERE project_id = $1', [original.project_id]);

  function subarvoreDe(parentId) {
    return todasDoProjeto
      .filter(r => r.parent_id === parentId)
      .sort((a, b) => a.ordem - b.ordem)
      .map(r => ({ ...r, filhos: subarvoreDe(r.id) }));
  }
  const filhosOriginais = subarvoreDe(original.id);

  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(ordem), -1) AS maxordem FROM wbs_items WHERE project_id = $1 AND parent_id IS NOT DISTINCT FROM $2',
    [original.project_id, original.parent_id]
  );
  const novaOrdem = maxRows[0].maxordem + 1;

  async function inserirCopia(item, parentId, ordem, ehRaiz) {
    const { rows } = await pool.query(
      `INSERT INTO wbs_items (project_id, parent_id, titulo, area, acao, responsavel, status, data_inicio, data_fim, observacao, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [item.project_id, parentId, ehRaiz ? `${item.titulo} (cópia)` : item.titulo, item.area, item.acao, item.responsavel, item.status, item.data_inicio, item.data_fim, item.observacao, ordem]
    );
    const novoId = rows[0].id;
    let i = 0;
    for (const filho of item.filhos) {
      await inserirCopia(filho, novoId, i, false);
      i++;
    }
    return novoId;
  }

  const novoIdRaiz = await inserirCopia({ ...original, filhos: filhosOriginais }, original.parent_id, novaOrdem, true);

  await registrarAuditoria({
    entidade: 'wbs_item', entidade_id: novoIdRaiz, projeto_id: original.project_id,
    acao: 'criado', autor: getAutor(req), detalhes: `Item "${original.titulo}" duplicado (com sub-itens, se houver)`,
  });

  res.status(201).json({ ok: true, id: novoIdRaiz });
});

module.exports = router;
