const { pool } = require('./db');

// Retorna o gp_id que o usuario deve enxergar/mexer exclusivamente, ou null se nao
// houver restricao nenhuma (usuarios com pode_admin sempre veem tudo; usuarios cujo
// e-mail nao bate com nenhum GP cadastrado tambem nao sao restritos).
async function gpIdRestrito(usuario) {
  if (!usuario || usuario.pode_admin) return null;
  const { rows } = await pool.query('SELECT id FROM gps WHERE LOWER(email) = LOWER($1)', [usuario.email]);
  return rows[0] ? rows[0].id : null;
}

// Middleware para rotas com :id referenciando um projeto - bloqueia de verdade (403) se
// o projeto em questao nao pertencer ao GP vinculado ao usuario logado.
function requireProjetoDoProprioGp() {
  return async (req, res, next) => {
    try {
      const meuGpId = await gpIdRestrito(req.usuario);
      if (meuGpId === null) return next(); // sem restricao pra esse usuario
      const { rows } = await pool.query('SELECT gp_id FROM projects WHERE id = $1', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'projeto não encontrado' });
      if (rows[0].gp_id !== meuGpId) {
        return res.status(403).json({ error: 'você só pode acessar projetos vinculados a você' });
      }
      next();
    } catch (e) {
      res.status(500).json({ error: 'falha ao verificar permissão: ' + e.message });
    }
  };
}

// Variante pra rotas que recebem :itemId de um item da WBS (nao o id do projeto direto) -
// descobre a qual projeto aquele item pertence, e aplica a mesma checagem.
function requireItemWbsDoProprioGp() {
  return async (req, res, next) => {
    try {
      const meuGpId = await gpIdRestrito(req.usuario);
      if (meuGpId === null) return next();
      const { rows } = await pool.query('SELECT project_id FROM wbs_items WHERE id = $1', [req.params.itemId]);
      if (!rows[0]) return res.status(404).json({ error: 'item da WBS não encontrado' });
      const projeto = (await pool.query('SELECT gp_id FROM projects WHERE id = $1', [rows[0].project_id])).rows[0];
      if (!projeto || projeto.gp_id !== meuGpId) {
        return res.status(403).json({ error: 'você só pode acessar projetos vinculados a você' });
      }
      next();
    } catch (e) {
      res.status(500).json({ error: 'falha ao verificar permissão: ' + e.message });
    }
  };
}

module.exports = { gpIdRestrito, requireProjetoDoProprioGp, requireItemWbsDoProprioGp };
