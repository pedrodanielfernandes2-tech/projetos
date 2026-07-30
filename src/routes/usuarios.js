const express = require('express');
const { pool } = require('../db');
const { requireAdminAlways } = require('../adminAuth');
const { gerarTokenSenha } = require('../usuariosAuth');
const { sendMail } = require('../email');
const router = express.Router();

router.get('/', requireAdminAlways, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT id, nome, email, pode_projetos, pode_implantacao, ativo, criado_em,
      (senha_hash IS NOT NULL) AS senha_definida
    FROM usuarios ORDER BY nome
  `);
  res.json(rows);
});

router.post('/', requireAdminAlways, async (req, res) => {
  const { nome, email, pode_projetos, pode_implantacao } = req.body;
  if (!nome || !nome.trim() || !email || !email.trim()) {
    return res.status(400).json({ error: 'nome e e-mail são obrigatórios' });
  }

  let usuario;
  try {
    const { rows } = await pool.query(
      'INSERT INTO usuarios (nome, email, pode_projetos, pode_implantacao) VALUES ($1, $2, $3, $4) RETURNING *',
      [nome.trim(), email.toLowerCase().trim(), !!pode_projetos, !!pode_implantacao]
    );
    usuario = rows[0];
  } catch (e) {
    return res.status(400).json({ error: 'já existe um usuário com esse e-mail' });
  }

  const token = await gerarTokenSenha(usuario.id);
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const link = `${baseUrl}/definir-senha.html?token=${token}`;
  try {
    await sendMail({
      to: usuario.email,
      subject: 'Bem-vindo(a) ao Painel de Projetos - defina sua senha',
      html: `<p>Olá, ${usuario.nome}!</p><p>Você foi cadastrado(a) no Painel de Projetos. Clique no link abaixo para definir sua senha de acesso (válido por 24h):</p><p><a href="${link}">${link}</a></p>`,
    });
  } catch (e) {
    console.error('[usuarios] falha ao enviar e-mail de boas-vindas:', e.message);
  }

  res.status(201).json({ id: usuario.id, nome: usuario.nome, email: usuario.email });
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
