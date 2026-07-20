const { pool } = require('./db');

function checarSenha(req) {
  const senha = req.header('x-admin-password') || '';
  return senha && senha === process.env.ADMIN_PASSWORD;
}

// Bloqueia sempre, independente de configuracao (usado nas rotas do painel Admin).
function requireAdminAlways(req, res, next) {
  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD nao configurada no servidor' });
  }
  if (!checarSenha(req)) {
    return res.status(401).json({ error: 'senha de admin invalida' });
  }
  next();
}

// So bloqueia se a configuracao correspondente (settingKey) estiver ativada.
function requireAdminIfSetting(settingKey) {
  return async (req, res, next) => {
    try {
      const { rows } = await pool.query('SELECT * FROM app_settings WHERE id = 1');
      const settings = rows[0] || {};
      if (!settings[settingKey]) return next();
      if (!process.env.ADMIN_PASSWORD) {
        return res.status(500).json({ error: 'ADMIN_PASSWORD nao configurada no servidor' });
      }
      if (!checarSenha(req)) {
        return res.status(401).json({ error: 'essa acao exige senha de admin' });
      }
      next();
    } catch (e) {
      res.status(500).json({ error: 'falha ao checar permissoes: ' + e.message });
    }
  };
}

module.exports = { requireAdminAlways, requireAdminIfSetting, checarSenha };
