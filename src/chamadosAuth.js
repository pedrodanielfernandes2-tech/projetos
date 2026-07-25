// Espelha exatamente o padrão de adminAuth.js: uma senha única (não é login
// por usuário), guardada no navegador durante a sessão, enviada em todo
// request via header. Aqui é `x-chamados-password` em vez de `x-admin-password`,
// e a variável de ambiente é `CHAMADOS_PASSWORD` em vez de `ADMIN_PASSWORD`.

function checarSenhaChamados(req) {
  const senha = req.header('x-chamados-password') || '';
  return senha && senha === process.env.CHAMADOS_PASSWORD;
}

// Bloqueia sempre, em toda rota de chamados (diferente do Admin, aqui não tem
// leitura pública — nem GET funciona sem a senha, já que é justamente valor
// financeiro que não pode vazar pra quem não tem a senha).
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
