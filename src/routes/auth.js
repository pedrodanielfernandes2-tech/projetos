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
  };
}

router.post('/login', async (req, res) => {
  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ error: 'informe e-mail e senha' });
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE email = $1 AND ativo = TRUE', [email.toLowerCase().trim()]);
  const usuario = rows[0];
  if (!usuario || !(await conferirSenha(senha, usuario.senha_hash))) {
    return res.status(401).json({ error: 'e-mail ou senha inválidos' });
  }
  const token = gerarSessao(usuario);
  res.json({ token, usuario: usuarioPublico(usuario) });
});

router.post('/esqueci-senha', async (req, res) => {
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
});

router.post('/definir-senha', async (req, res) => {
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
});

module.exports = router;
