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
// Tambem inclui, num grupo virtual separado, as demandas avulsas atribuidas a essa pessoa
// (casando pelo nome com o cadastro de implantadores - mesmo criterio usado na WBS).
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

  const { rows: demandas } = await pool.query(`
    SELECT d.*
    FROM demandas_avulsas d
    JOIN implantadores i ON i.id = d.implantador_id
    WHERE LOWER(TRIM(i.nome)) = $1
    ORDER BY d.data_inicio
  `, [meuNome]);

  const grupos = Object.values(projetosMap);
  if (demandas.length > 0) {
    grupos.push({
      project_id: null,
      nome: 'Demandas Avulsas',
      chamado: null,
      cliente_nome: null,
      itens: demandas.map(d => ({
        id: d.id,
        tipo: 'avulsa',
        project_id: null,
        titulo: d.titulo,
        status: d.status,
        observacao: '',
        data_inicio: d.data_inicio,
        data_fim: d.data_fim,
        cliente_nome: d.cliente_nome,
        chamado_numero: d.chamado_numero,
      })),
    });
  }

  res.json(grupos);
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
    `INSERT INTO wbs_items (project_id, titulo, responsavel, status, observacao, data_inicio, data_fim, ordem, concluido_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [req.params.projectId, titulo.trim(), req.usuario.nome, status || 'Pendente', observacao || '', data_inicio || null, data_fim || null, ordem, status === 'Concluído' ? new Date() : null]
  );

  await registrarAuditoria({
    entidade: 'wbs_item', entidade_id: rows[0].id, projeto_id: Number(req.params.projectId),
    acao: 'criado', autor: req.usuario.nome, detalhes: `Item de checklist "${titulo.trim()}" criado via Implantação`,
  });

  res.status(201).json(rows[0]);
});

// Edita um item - so o proprio implantador que criou (responsavel = ele) pode mexer,
// e so nos campos status (via os botoes de acao rapida) e observacao. Titulo e prazo
// sao definidos na criacao e, depois disso, so um GP (dentro da WBS completa) altera.
router.patch('/itens/:itemId', gate, async (req, res) => {
  const item = (await pool.query('SELECT * FROM wbs_items WHERE id = $1', [req.params.itemId])).rows[0];
  if (!item) return res.status(404).json({ error: 'item nao encontrado' });
  if (normalizar(item.responsavel) !== normalizar(req.usuario.nome)) {
    return res.status(403).json({ error: 'você só pode editar os itens que você mesmo criou' });
  }

  const campos = [];
  const valores = [];
  let i = 1;
  ['status', 'observacao'].forEach(campo => {
    if (req.body[campo] !== undefined) {
      campos.push(`${campo} = $${i++}`);
      valores.push(req.body[campo] || null);
    }
  });
  // Registra o momento exato da conclusao (usado pra calcular a sequencia/streak);
  // se o item for reaberto depois, limpa esse registro - so conta como "concluido"
  // enquanto o status realmente estiver Concluido.
  if (req.body.status !== undefined) {
    if (req.body.status === 'Concluído') {
      campos.push('concluido_em = NOW()');
    } else {
      campos.push('concluido_em = NULL');
    }
  }
  if (campos.length === 0) return res.json({ ok: true });
  valores.push(req.params.itemId);
  await pool.query(`UPDATE wbs_items SET ${campos.join(', ')} WHERE id = $${i}`, valores);

  await registrarAuditoria({
    entidade: 'wbs_item', entidade_id: item.id, projeto_id: item.project_id,
    acao: 'editado', autor: req.usuario.nome, detalhes: `Item "${item.titulo}" atualizado via Implantação`,
  });

  res.json({ ok: true });
});

// Calcula a sequencia (streak) de dias consecutivos em que o implantador concluiu
// pelo menos um item, e o recorde historico dele.
router.get('/sequencia', gate, async (req, res) => {
  try {
    const meuNome = normalizar(req.usuario.nome);
    const { rows } = await pool.query(`
      SELECT DISTINCT (concluido_em AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date AS dia
      FROM wbs_items
      WHERE LOWER(TRIM(responsavel)) = $1 AND concluido_em IS NOT NULL
      ORDER BY dia
    `, [meuNome]);

    // O driver do Postgres pode devolver a data ja como string (YYYY-MM-DD) ou como
    // objeto Date, dependendo da configuracao - trata os dois casos com seguranca.
    const dias = rows.map(r => (r.dia instanceof Date ? r.dia.toISOString() : String(r.dia)).slice(0, 10));
    if (dias.length === 0) return res.json({ atual: 0, recorde: 0 });

    const umDiaMs = 24 * 60 * 60 * 1000;
    let recorde = 1;
    let sequenciaCorrida = 1;
    for (let idx = 1; idx < dias.length; idx++) {
      const diff = Math.round((new Date(dias[idx]) - new Date(dias[idx - 1])) / umDiaMs);
      sequenciaCorrida = diff === 1 ? sequenciaCorrida + 1 : 1;
      recorde = Math.max(recorde, sequenciaCorrida);
    }

    const hojeStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }); // formato YYYY-MM-DD
    const ontemStr = new Date(Date.now() - umDiaMs).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const ultimoDia = dias[dias.length - 1];

    let atual = 0;
    if (ultimoDia === hojeStr || ultimoDia === ontemStr) {
      atual = 1;
      for (let idx = dias.length - 1; idx > 0; idx--) {
        const diff = Math.round((new Date(dias[idx]) - new Date(dias[idx - 1])) / umDiaMs);
        if (diff === 1) atual++; else break;
      }
    }

    res.json({ atual, recorde });
  } catch (e) {
    console.error('[implantacao/sequencia] erro:', e.message);
    res.status(500).json({ error: 'falha ao calcular a sequência: ' + e.message });
  }
});

// Deixa o proprio implantador (nao precisa ser admin) atualizar o status de uma demanda
// avulsa atribuida a ele - so o status pode mudar por aqui, o resto (datas, cliente,
// % de dedicacao) continua exclusivo da tela Equipe, gerenciado pelo GP.
router.patch('/demandas/:demandaId', gate, async (req, res) => {
  const demanda = (await pool.query(`
    SELECT d.*, i.nome AS implantador_nome
    FROM demandas_avulsas d
    JOIN implantadores i ON i.id = d.implantador_id
    WHERE d.id = $1
  `, [req.params.demandaId])).rows[0];
  if (!demanda) return res.status(404).json({ error: 'demanda não encontrada' });
  if (normalizar(demanda.implantador_nome) !== normalizar(req.usuario.nome)) {
    return res.status(403).json({ error: 'você só pode atualizar demandas atribuídas a você' });
  }
  const statusValidos = ['Pendente', 'Em Andamento', 'Suspensa', 'Concluído'];
  if (!statusValidos.includes(req.body.status)) {
    return res.status(400).json({ error: 'status inválido' });
  }
  await pool.query(
    `UPDATE demandas_avulsas SET status = $1, concluido_em = ${req.body.status === 'Concluído' ? 'NOW()' : 'NULL'} WHERE id = $2`,
    [req.body.status, req.params.demandaId]
  );
  await registrarAuditoria({
    entidade: 'demanda_avulsa', entidade_id: demanda.id,
    acao: 'editado', autor: req.usuario.nome, detalhes: `Demanda "${demanda.titulo}" marcada como ${req.body.status} via Implantação`,
  });
  res.json({ ok: true });
});

module.exports = router;
