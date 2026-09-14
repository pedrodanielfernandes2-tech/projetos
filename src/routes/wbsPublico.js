const express = require('express');
const { pool } = require('../db');
const router = express.Router();

// Mesma logica de montar a arvore que a rota autenticada usa - duplicada aqui de
// proposito (em vez de importar de wbs.js) pra manter essa rota publica totalmente
// isolada e simples de auditar, sem depender de mudar os exports de outro arquivo.
function buildTree(rows) {
  const byId = {};
  rows.forEach(r => { byId[r.id] = { ...r, filhos: [] }; });
  const roots = [];
  rows.forEach(r => {
    if (r.parent_id && byId[r.parent_id]) {
      byId[r.parent_id].filhos.push(byId[r.id]);
    } else {
      roots.push(byId[r.id]);
    }
  });
  function sortRec(list) {
    list.sort((a, b) => a.ordem - b.ordem);
    list.forEach(n => sortRec(n.filhos));
  }
  sortRec(roots);
  function numerar(list, prefixo) {
    list.forEach((n, i) => {
      n.numero = prefixo ? `${prefixo}.${i + 1}` : `${i + 1}`;
      numerar(n.filhos, n.numero);
    });
  }
  numerar(roots, '');
  return roots;
}

// Rota publica, sem exigir login nenhum - so quem tem o link (com o token certo)
// consegue ver. Mostra a WBS completa (area, responsavel, datas, observacao,
// status), so leitura - nenhuma opcao de editar existe aqui.
router.get('/:token', async (req, res) => {
  const projeto = (await pool.query(
    'SELECT id, nome, chamado, cliente_id FROM projects WHERE wbs_publico_token = $1',
    [req.params.token]
  )).rows[0];
  if (!projeto) return res.status(404).json({ error: 'link inválido ou expirado' });

  let clienteNome = null;
  if (projeto.cliente_id) {
    const cliente = (await pool.query('SELECT nome FROM clientes WHERE id = $1', [projeto.cliente_id])).rows[0];
    clienteNome = cliente ? cliente.nome : null;
  }

  const { rows } = await pool.query(
    'SELECT * FROM wbs_items WHERE project_id = $1 ORDER BY ordem',
    [projeto.id]
  );

  res.json({
    projeto: { nome: projeto.nome, chamado: projeto.chamado, cliente_nome: clienteNome },
    tree: buildTree(rows),
  });
});

module.exports = router;
