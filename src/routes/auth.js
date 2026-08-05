const express = require('express');
const { pool } = require('../db');
const { conferirSenha, gerarSessao, gerarTokenSenha, consumirTokenSenha, hashSenha } = require('../usuariosAuth');
const { sendMail } = require('../email');
const router = express.Router();

function usuarioPublico(usuario) {
  return {
    nome: usuario.nome,
    email: usuario.email,
    pode_projetos: usuario.pode_projetos,
    pode_implantacao: usuario.pode_implantacao,
    pode_chamados: usuario.pode_chamados,
    pode_admin: usuario.pode_admin,
  };
}

// Cria o PRIMEIRO usuario do sistema. So funciona enquanto a tabela usuarios
// estiver vazia (se desabilita sozinha depois disso), e exige a senha de Admin
// como uma camada extra de protecao contra qualquer um chegar primeiro.
router.post('/bootstrap', async (req, res) => {
  try {
    const { nome, email, senha, adminPassword } = req.body;
    if (!process.env.ADMIN_PASSWORD || adminPassword !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'senha de admin inválida' });
    }
    const { rows: existentes } = await pool.query('SELECT COUNT(*)::int AS n FROM usuarios');
    if (existentes[0].n > 0) {
      return res.status(400).json({ error: 'já existe usuário cadastrado - peça para um administrador te cadastrar dentro do Admin' });
    }
    if (!nome || !nome.trim() || !email || !email.trim() || !senha || senha.length < 6) {
      return res.status(400).json({ error: 'preencha nome, e-mail e uma senha de pelo menos 6 caracteres' });
    }
    const hash = await hashSenha(senha);
    let usuario;
    try {
      const { rows } = await pool.query(
        'INSERT INTO usuarios (nome, email, senha_hash, pode_projetos, pode_implantacao) VALUES ($1, $2, $3, TRUE, TRUE) RETURNING *',
        [nome.trim(), email.toLowerCase().trim(), hash]
      );
      usuario = rows[0];
    } catch (e) {
      return res.status(400).json({ error: 'já existe um usuário com esse e-mail' });
    }
    const token = gerarSessao(usuario);
    res.json({ token, usuario: usuarioPublico(usuario) });
  } catch (e) {
    console.error('[auth/bootstrap] erro:', e.message);
    res.status(500).json({ error: 'falha ao criar a conta inicial: ' + e.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) return res.status(400).json({ error: 'informe e-mail e senha' });
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND ativo = TRUE', [email.toLowerCase().trim()]);
    const usuario = rows[0];
    if (!usuario || !(await conferirSenha(senha, usuario.senha_hash))) {
      return res.status(401).json({ error: 'e-mail ou senha inválidos' });
    }
    const token = gerarSessao(usuario);
    res.json({ token, usuario: usuarioPublico(usuario) });
  } catch (e) {
    console.error('[auth/login] erro:', e.message);
    res.status(500).json({ error: 'falha ao entrar: ' + e.message });
  }
});

router.post('/esqueci-senha', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'informe o e-mail' });
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND ativo = TRUE', [email.toLowerCase().trim()]);
    const usuario = rows[0];
    // Sempre responde "ok", mesmo se o e-mail nao existir - evita confirmar pra quem tenta adivinhar e-mails cadastrados.
    if (usuario) {
      const token = await gerarTokenSenha(usuario.id);
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const link = `${baseUrl}/definir-senha.html?token=${token}`;
      try {
        await sendMail({
          to: usuario.email,
          subject: 'Redefinir senha - Painel de Projetos',
          html: `<p>Olá, ${usuario.nome}!</p><p>Clique no link abaixo para definir uma nova senha (válido por 24h):</p><p><a href="${link}">${link}</a></p><p>Se você não pediu isso, pode ignorar este e-mail.</p>`,
        });
      } catch (e) {
        console.error('[auth] falha ao enviar e-mail de redefinição:', e.message);
      }
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[auth/esqueci-senha] erro:', e.message);
    res.status(500).json({ error: 'falha ao processar o pedido: ' + e.message });
  }
});

router.post('/definir-senha', async (req, res) => {
  try {
    const { token, senha } = req.body;
    if (!token || !senha) return res.status(400).json({ error: 'token e senha são obrigatórios' });
    if (senha.length < 6) return res.status(400).json({ error: 'a senha precisa ter pelo menos 6 caracteres' });
    const usuarioId = await consumirTokenSenha(token);
    if (!usuarioId) return res.status(400).json({ error: 'link inválido ou expirado' });
    const hash = await hashSenha(senha);
    await pool.query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [hash, usuarioId]);
    const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [usuarioId]);
    const usuario = rows[0];
    const sessionToken = gerarSessao(usuario);
    res.json({ token: sessionToken, usuario: usuarioPublico(usuario) });
  } catch (e) {
    console.error('[auth/definir-senha] erro:', e.message);
    res.status(500).json({ error: 'falha ao definir a senha: ' + e.message });
  }
});

module.exports = router;
