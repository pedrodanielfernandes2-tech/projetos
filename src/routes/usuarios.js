const express = require('express');
const { pool } = require('../db');
const { requireAdminAlways } = require('../adminAuth');
const { gerarTokenSenha, hashSenha, requirePermissao } = require('../usuariosAuth');
const { sendMail } = require('../email');
const router = express.Router();

// Lista leve (so os nomes) dos implantadores cadastrados e ativos - usada pra sugerir
// nomes no campo "Responsável" da WBS. Acessivel a qualquer um com acesso a Projetos,
// nao so ao Admin, ja que quem monta a WBS normalmente e um GP, nao necessariamente admin.
router.get('/implantadores', requirePermissao('pode_projetos'), async (req, res) => {
  const { rows } = await pool.query('SELECT nome FROM usuarios WHERE pode_implantacao = TRUE AND ativo = TRUE ORDER BY nome');
  res.json(rows.map(r => r.nome));
});

router.get('/', requireAdminAlways, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id, nome, email, pode_projetos, pode_implantacao, ativo, criado_em,
      (senha_hash IS NOT NULL) AS senha_definida
    FROM usuarios ORDER BY nome
  `);
  res.json(rows);
});

router.post('/', requireAdminAlways, async (req, res) => {
  const { nome, email, pode_projetos, pode_implantacao, senha } = req.body;
  if (!nome || !nome.trim() || !email || !email.trim()) {
    return res.status(400).json({ error: 'nome e e-mail são obrigatórios' });
  }
  if (senha && senha.length < 6) {
    return res.status(400).json({ error: 'a senha precisa ter pelo menos 6 caracteres' });
  }

  let usuario;
  try {
    const senhaHash = senha ? await hashSenha(senha) : null;
    const { rows } = await pool.query(
      'INSERT INTO usuarios (nome, email, pode_projetos, pode_implantacao, senha_hash) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [nome.trim(), email.toLowerCase().trim(), !!pode_projetos, !!pode_implantacao, senhaHash]
    );
    usuario = rows[0];
  } catch (e) {
    return res.status(400).json({ error: 'já existe um usuário com esse e-mail' });
  }

  // Se o Admin ja definiu a senha direto na tela, o cadastro esta pronto pra uso
  // imediato - nao precisa (nem tenta) mandar e-mail nenhum.
  if (senha) {
    return res.status(201).json({ id: usuario.id, nome: usuario.nome, email: usuario.email, senhaDefinidaDireto: true });
  }

  const token = await gerarTokenSenha(usuario.id);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const link = `${baseUrl}/definir-senha.html?token=${token}`;
  let emailEnviado = true;
  let emailErro = null;
  try {
    await sendMail({
      to: usuario.email,
      subject: 'Bem-vindo(a) ao Painel de Projetos - defina sua senha',
      html: `<p>Olá, ${usuario.nome}!</p><p>Você foi cadastrado(a) no Painel de Projetos. Clique no link abaixo para definir sua senha de acesso (válido por 24h):</p><p><a href="${link}">${link}</a></p>`,
    });
  } catch (e) {
    emailEnviado = false;
    emailErro = e.message;
    console.error('[usuarios] falha ao enviar e-mail de boas-vindas:', e.message);
  }

  res.status(201).json({ id: usuario.id, nome: usuario.nome, email: usuario.email, emailEnviado, emailErro });
});

router.patch('/:id', requireAdminAlways, async (req, res) => {
  const campos = [];
  const valores = [];
  let i = 1;
  ['nome', 'pode_projetos', 'pode_implantacao', 'ativo'].forEach(campo => {
    if (req.body[campo] !== undefined) {
      campos.push(`${campo} = $${i++}`);
      valores.push(req.body[campo]);
    }
  });
  if (campos.length === 0) return res.json({ ok: true });
  valores.push(req.params.id);
  await pool.query(`UPDATE usuarios SET ${campos.join(', ')} WHERE id = $${i}`, valores);
  res.json({ ok: true });
});

router.delete('/:id', requireAdminAlways, async (req, res) => {
  await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Define/redefine a senha de um usuario diretamente pelo Admin, sem precisar de e-mail.
router.patch('/:id/senha', requireAdminAlways, async (req, res) => {
  const { senha } = req.body;
  if (!senha || senha.length < 6) {
    return res.status(400).json({ error: 'a senha precisa ter pelo menos 6 caracteres' });
  }
  const existe = (await pool.query('SELECT id FROM usuarios WHERE id = $1', [req.params.id])).rows[0];
  if (!existe) return res.status(404).json({ error: 'usuário não encontrado' });
  const hash = await hashSenha(senha);
  await pool.query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [hash, req.params.id]);
  res.json({ ok: true });
});

router.post('/:id/reenviar-convite', requireAdminAlways, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.params.id]);
  const usuario = rows[0];
  if (!usuario) return res.status(404).json({ error: 'usuário não encontrado' });
  const token = await gerarTokenSenha(usuario.id);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const link = `${baseUrl}/definir-senha.html?token=${token}`;
  try {
    await sendMail({
      to: usuario.email,
      subject: 'Defina sua senha - Painel de Projetos',
      html: `<p>Olá, ${usuario.nome}!</p><p>Clique no link para definir sua senha (válido por 24h):</p><p><a href="${link}">${link}</a></p>`,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'falha ao enviar e-mail: ' + e.message });
  }
});

module.exports = router;
