const { pool } = require('./db');

async function registrarAuditoria({ entidade, entidade_id, projeto_id, projeto_nome, acao, autor, detalhes, envolve_data }) {
  try {
    await pool.query(
      `INSERT INTO audit_log (entidade, entidade_id, projeto_id, projeto_nome, acao, autor, detalhes, envolve_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entidade, entidade_id || null, projeto_id || null, projeto_nome || '', acao, autor || 'anônimo', detalhes || '', !!envolve_data]
    );
  } catch (e) {
    // Auditoria e best-effort: uma falha aqui nunca deve impedir a acao principal.
    console.error('[audit] falha ao registrar auditoria:', e.message);
  }
}

module.exports = { registrarAuditoria };
