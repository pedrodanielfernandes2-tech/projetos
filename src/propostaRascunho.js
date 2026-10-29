const { pool } = require('./db');

// Cria (se ainda nao existir) o rascunho da Proposta Comercial de um chamado, ja com
// titulo, cliente, horas e valor/hora vindos do proprio chamado. Devolve o registro.
async function criarRascunhoProposta(chamadoId) {
  const existente = (await pool.query('SELECT * FROM chamados_propostas WHERE chamado_id = $1', [chamadoId])).rows[0];
  if (existente) return existente;

  // require aqui dentro evita dependencia circular com routes/chamados.js
  const { carregarChamadosCalculados } = require('./routes/chamados');
  const ch = (await carregarChamadosCalculados(chamadoId))[0];
  if (!ch) throw new Error('chamado nao encontrado');

  const horas = Number(ch.total_geral) || Number(ch.horas_dev) || 0;
  const valorTotal = Number(ch.valor_total_projeto) || 0;
  let valorHora = horas > 0 && valorTotal > 0 ? Math.round((valorTotal / horas) * 100) / 100 : 0;
  if (!valorHora) valorHora = Number(ch.valor_hora_aplicado) || 0;
  if (!valorHora) {
    const cfg = (await pool.query('SELECT valor_hora FROM chamados_config WHERE vigente_ate IS NULL ORDER BY id DESC LIMIT 1')).rows[0];
    valorHora = cfg ? Number(cfg.valor_hora) || 0 : 0;
  }
  const { rows } = await pool.query(
    `INSERT INTO chamados_propostas (chamado_id, numero, titulo, cliente_nome, data_publicacao, horas, valor_hora, parcelas)
     VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6,$7)
     ON CONFLICT (chamado_id) DO NOTHING
     RETURNING *`,
    [chamadoId, ch.numero, ch.descricao || '', ch.cliente_nome || '', horas, valorHora, Number(ch.qtd_parcelas) || 1]
  );
  if (rows[0]) return rows[0];
  return (await pool.query('SELECT * FROM chamados_propostas WHERE chamado_id = $1', [chamadoId])).rows[0];
}

module.exports = { criarRascunhoProposta };
