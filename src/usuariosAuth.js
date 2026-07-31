const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('./db');

const JWT_EXPIRA_EM = '30d';

function getSegredo() {
  const segredo = process.env.JWT_SECRET;
  if (!segredo) {
    throw new Error('JWT_SECRET nao configurado no servidor');
  }
  return segredo;
}

async function hashSenha(senha) {
  return bcrypt.hash(senha, 10);
}

async function conferirSenha(senha, hash) {
  if (!hash) return false;
  return bcrypt.compare(senha, hash);
}

function gerarSessao(usuario) {
  return jwt.sign(
    {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      pode_projetos: usuario.pode_projetos,
      pode_implantacao: usuario.pode_implantacao,
      pode_chamados: usuario.pode_chamados,
      pode_admin: usuario.pode_admin,
    },
    getSegredo(),
    { expiresIn: JWT_EXPIRA_EM }
  );
}

// Middleware: exige uma sessao valida (usuario logado), independente de quais menus ele acessa.
function requireLogin(req, res, next) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'nao autenticado' });
  try {
    req.usuario = jwt.verify(token, getSegredo());
    next();
  } catch (e) {
    return res.status(401).json({ error: 'sessao invalida ou expirada' });
  }
}

// Middleware: alem de logado, exige a permissao especifica (ex: 'pode_implantacao').
function requirePermissao(campo) {
  return (req, res, next) => {
    requireLogin(req, res, () => {
      if (!req.usuario[campo]) {
        return res.status(403).json({ error: 'sem permissao para acessar esse recurso' });
      }
      next();
    });
  };
}

// Tokens de uso unico para "definir senha" (primeiro acesso) e "esqueci minha senha"
// (mesma mecanica para os dois - so muda o texto do e-mail que convida a usa-lo).
async function gerarTokenSenha(usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiraEm = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h
  await pool.query(
    'INSERT INTO usuarios_tokens (usuario_id, token, expira_em) VALUES ($1, $2, $3)',
    [usuarioId, token, expiraEm]
  );
  return token;
}

async function consumirTokenSenha(token) {
  const { rows } = await pool.query(
    'SELECT * FROM usuarios_tokens WHERE token = $1 AND usado = FALSE AND expira_em > NOW()',
    [token]
  );
  const registro = rows[0];
  if (!registro) return null;
  await pool.query('UPDATE usuarios_tokens SET usado = TRUE WHERE id = $1', [registro.id]);
  return registro.usuario_id;
}

module.exports = {
  hashSenha,
  conferirSenha,
  gerarSessao,
  requireLogin,
  requirePermissao,
  gerarTokenSenha,
  consumirTokenSenha,
};
