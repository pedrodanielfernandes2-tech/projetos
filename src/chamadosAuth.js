function checarSenhaChamados(req) {
  const senha = req.header('x-chamados-password') || '';
  return senha && senha === process.env.CHAMADOS_PASSWORD;
}

// Bloqueia sempre, independente de configuracao (usado em todas as rotas do modulo Chamados).
function requireChamadosAuth(req, res, next) {
  if (!process.env.CHAMADOS_PASSWORD) {
    return res.status(500).json({ error: 'CHAMADOS_PASSWORD nao configurada no servidor' });
  }
  if (!checarSenhaChamados(req)) {
    return res.status(401).json({ error: 'senha de chamados invalida' });
  }
  next();
}

module.exports = { requireChamadosAuth, checarSenhaChamados };
