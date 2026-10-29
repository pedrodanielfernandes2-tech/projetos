const express = require('express');
const { pool } = require('../db');
const { requireChamadosAuth } = require('../chamadosAuth');
const { criarRascunhoProposta } = require('../propostaRascunho');
const { gerarDocx } = require('../propostaDocx');
const { gerarPdf } = require('../propostaPdf');
const router = express.Router();

// A Proposta Comercial tem senha propria (PROPOSTA_PASSWORD). Se ela nao estiver
// configurada no servidor, vale a senha do Chamados.
function senhaProposta() { return process.env.PROPOSTA_PASSWORD || process.env.CHAMADOS_PASSWORD; }
function requirePropostaAuth(req, res, next) {
  const senha = req.header('x-proposta-password') || '';
  if (!senhaProposta() || senha !== senhaProposta()) {
    return res.status(401).json({ error: 'senha da proposta comercial invalida' });
  }
  next();
}
const gate = [requireChamadosAuth, requirePropostaAuth];

router.post('/login', requireChamadosAuth, (req, res) => {
  if (!senhaProposta()) return res.status(500).json({ error: 'senha nao configurada no servidor' });
  if ((req.body.senha || '') === senhaProposta()) return res.json({ ok: true });
  res.status(401).json({ error: 'senha incorreta' });
});

const SELECT_LISTA = `
  SELECT p.*, ch.status AS chamado_status, ch.proposta_status AS chamado_proposta_status
  FROM chamados_propostas p
  LEFT JOIN chamados ch ON ch.id = p.chamado_id`;

router.get('/', gate, async (req, res) => {
  const { rows } = await pool.query(`${SELECT_LISTA} ORDER BY p.atualizado_em DESC LIMIT 500`);
  res.json(rows);
});

// Chamados concluidos que ainda nao tem proposta (pra gerar rascunho dos antigos)
router.get('/pendentes', gate, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT ch.id, ch.numero, ch.descricao, cl.nome AS cliente_nome
    FROM chamados ch
    LEFT JOIN chamados_clientes cl ON cl.id = ch.cliente_id
    WHERE ch.status = 'Concluido' AND NOT EXISTS (SELECT 1 FROM chamados_propostas p WHERE p.chamado_id = ch.id)
    ORDER BY ch.criado_em DESC LIMIT 300`);
  res.json(rows);
});

router.post('/', gate, async (req, res) => {
  const chamadoId = Number(req.body.chamado_id);
  if (!chamadoId) return res.status(400).json({ error: 'chamado_id obrigatorio' });
  try {
    res.status(201).json(await criarRascunhoProposta(chamadoId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/:id(\\d+)', gate, async (req, res) => {
  const { rows } = await pool.query(`${SELECT_LISTA} WHERE p.id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'proposta nao encontrada' });
  res.json(rows[0]);
});

const CAMPOS = ['numero', 'titulo', 'cliente_nome', 'contato', 'data_publicacao', 'horas', 'valor_hora', 'parcelas',
  'dias_primeira', 'dias_intervalo', 'aprovado_ate', 'inicio_previsto', 'texto_extra', 'status'];
const NULAVEIS = new Set(['data_publicacao', 'aprovado_ate', 'inicio_previsto']);

router.patch('/:id(\\d+)', gate, async (req, res) => {
  const sets = [], vals = [];
  CAMPOS.forEach((c) => {
    if (req.body[c] === undefined) return;
    let v = req.body[c];
    if (NULAVEIS.has(c) && v === '') v = null;
    vals.push(v); sets.push(`${c} = $${vals.length}`);
  });
  if (!sets.length) return res.json({ ok: true });
  vals.push(req.params.id);
  try {
    const { rowCount } = await pool.query(`UPDATE chamados_propostas SET ${sets.join(', ')}, atualizado_em = NOW() WHERE id = $${vals.length}`, vals);
    if (!rowCount) return res.status(404).json({ error: 'proposta nao encontrada' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:id(\\d+)', gate, async (req, res) => {
  await pool.query('DELETE FROM chamados_propostas WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

async function baixar(req, res, tipo) {
  const p = (await pool.query('SELECT * FROM chamados_propostas WHERE id = $1', [req.params.id])).rows[0];
  if (!p) return res.status(404).json({ error: 'proposta nao encontrada' });
  try {
    const nome = `Proposta comercial - ${p.numero}.${tipo}`;
    const buf = tipo === 'docx' ? await gerarDocx(p) : await gerarPdf(p);
    res.setHeader('Content-Type', tipo === 'docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"; filename*=UTF-8''${encodeURIComponent(nome)}`);
    res.send(buf);
  } catch (e) {
    console.error('proposta', tipo, e);
    res.status(500).json({ error: 'falha ao gerar ' + tipo + ': ' + e.message });
  }
}
router.get('/:id(\\d+)/docx', gate, (req, res) => baixar(req, res, 'docx'));
router.get('/:id(\\d+)/pdf', gate, (req, res) => baixar(req, res, 'pdf'));

module.exports = router;
