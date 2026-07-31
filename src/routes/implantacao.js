const express = require('express');
const { pool } = require('../db');
const { requirePermissao } = require('../usuariosAuth');
const { registrarAuditoria } = require('../audit');
const router = express.Router();

const gate = requirePermissao('pode_implantacao');

function normalizar(nome) {
  return (nome || '').trim().toLowerCase();
}

// Lista compacta de todos os projetos, pra busca no botao "Incluir".
router.get('/projetos', gate, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT p.id, p.nome, p.chamado, c.nome AS cliente_nome
    FROM projects p
    LEFT JOIN clientes c ON c.id = p.cliente_id
    ORDER BY p.nome
  `);
  res.json(rows);
});

// Projetos onde o implantador logado ja tem algum item atribuido (responsavel = seu nome),
// agrupados com os proprios itens - essa e a lista "automatica" da tela de Implantacao.
router.get('/meus-itens', gate, async (req, res) => {
  const meuNome = normalizar(req.usuario.nome);
  const { rows } = await pool.query(`
    SELECT wi.*, p.nome AS projeto_nome, p.chamado AS projeto_chamado, c.nome AS cliente_nome
    FROM wbs_items wi
    JOIN projects p ON p.id = wi.project_id
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE LOWER(TRIM(wi.responsavel)) = $1
    ORDER BY p.nome, wi.ordem
  `, [meuNome]);

  const projetosMap = {};
  rows.forEach(item => {
    if (!projetosMap[item.project_id]) {
      projetosMap[item.project_id] = {
        project_id: item.project_id,
        nome: item.projeto_nome,
        chamado: item.projeto_chamado,
        cliente_nome: item.cliente_nome,
        itens: [],
      };
    }
    projetosMap[item.project_id].itens.push(item);
  });
  res.json(Object.values(projetosMap));
});

// Cria um item novo de checklist num projeto, ja atribuido ao implantador logado.
router.post('/projetos/:projectId/itens', gate, async (req, res) => {
  const { titulo, status, observacao, data_inicio, data_fim } = req.body;
  if (!titulo || !titulo.trim()) return res.status(400).json({ error: 'titulo obrigatorio' });

  const projeto = (await pool.query('SELECT id FROM projects WHERE id = $1', [req.params.projectId])).rows[0];
  if (!projeto) return res.status(404).json({ error: 'projeto nao encontrado' });

  const { rows: maxRows } = await pool.query(
    'SELECT COALESCE(MAX(ordem), -1) AS maxordem FROM wbs_items WHERE project_id = $1 AND parent_id IS NULL',
    [req.params.projectId]
  );
  const ordem = maxRows[0].maxordem + 1;

  const { rows } = await pool.query(
    `INSERT INTO wbs_items (project_id, titulo, responsavel, status, observacao, data_inicio, data_fim, ordem)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [req.params.projectId, titulo.trim(), req.usuario.nome, status || 'Pendente', observacao || '', data_inicio || null, data_fim || null, ordem]
  );

  await registrarAuditoria({
    entidade: 'wbs_item', entidade_id: rows[0].id, projeto_id: Number(req.params.projectId),
    acao: 'criado', autor: req.usuario.nome, detalhes: `Item de checklist "${titulo.trim()}" criado via Implantação`,
  });

  res.status(201).json(rows[0]);
});

// Edita um item - so o proprio implantador que criou (responsavel = ele) pode mexer.
router.patch('/itens/:itemId', gate, async (req, res) => {
  const item = (await pool.query('SELECT * FROM wbs_items WHERE id = $1', [req.params.itemId])).rows[0];
  if (!item) return res.status(404).json({ error: 'item nao encontrado' });
  if (normalizar(item.responsavel) !== normalizar(req.usuario.nome)) {
    return res.status(403).json({ error: 'você só pode editar os itens que você mesmo criou' });
  }

  const campos = [];
  const valores = [];
  let i = 1;
  ['titulo', 'status', 'observacao', 'data_inicio', 'data_fim'].forEach(campo => {
    if (req.body[campo] !== undefined) {
      campos.push(`${campo} = $${i++}`);
      valores.push(req.body[campo] || null);
    }
  });
  if (campos.length === 0) return res.json({ ok: true });
  valores.push(req.params.itemId);
  await pool.query(`UPDATE wbs_items SET ${campos.join(', ')} WHERE id = $${i}`, valores);

  await registrarAuditoria({
    entidade: 'wbs_item', entidade_id: item.id, projeto_id: item.project_id,
    acao: 'editado', autor: req.usuario.nome, detalhes: `Item "${item.titulo}" atualizado via Implantação`,
  });

  res.json({ ok: true });
});

// Exclui um item - mesma regra: so o proprio dono.
router.delete('/itens/:itemId', gate, async (req, res) => {
  const item = (await pool.query('SELECT * FROM wbs_items WHERE id = $1', [req.params.itemId])).rows[0];
  if (!item) return res.status(404).json({ error: 'item nao encontrado' });
  if (normalizar(item.responsavel) !== normalizar(req.usuario.nome)) {
    return res.status(403).json({ error: 'você só pode excluir os itens que você mesmo criou' });
  }
  await pool.query('DELETE FROM wbs_items WHERE id = $1', [req.params.itemId]);
  await registrarAuditoria({
    entidade: 'wbs_item', projeto_id: item.project_id,
    acao: 'excluido', autor: req.usuario.nome, detalhes: `Item "${item.titulo}" excluído via Implantação`,
  });
  res.json({ ok: true });
});

module.exports = router;
