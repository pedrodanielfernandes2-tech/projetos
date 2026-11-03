const { pool } = require('./db');

// Horas do pacote = "Total Geral (h)" do chamado (Dev + QA + Gerencial + Margem, ou o ajuste
// manual do Total Geral, ou a soma por recurso). Valor/hora = valor total do chamado / horas.
async function dadosDoChamado(chamadoId) {
  // require aqui dentro evita dependencia circular com routes/chamados.js
  const { carregarChamadosCalculados } = require('./routes/chamados');
  const ch = (await carregarChamadosCalculados(chamadoId))[0];
  if (!ch) throw new Error('chamado nao encontrado');

  const totalGeral = Number(ch.total_geral);
  const horas = totalGeral > 0 ? totalGeral : (Number(ch.total_horas) || Number(ch.horas_dev) || 0);
  const valorTotal = Number(ch.valor_total_projeto) || 0;
  let valorHora = horas > 0 && valorTotal > 0 ? Math.round((valorTotal / horas) * 100) / 100 : 0;
  if (!valorHora) valorHora = Number(ch.valor_hora_aplicado) || 0;
  if (!valorHora) {
    const cfg = (await pool.query('SELECT valor_hora FROM chamados_config WHERE vigente_ate IS NULL ORDER BY id DESC LIMIT 1')).rows[0];
    valorHora = cfg ? Number(cfg.valor_hora) || 0 : 0;
  }
  return { ch, horas, valorHora };
}

// Cria (se ainda nao existir) o rascunho da Proposta Comercial de um chamado, ja com
// titulo, cliente, horas e valor/hora vindos do proprio chamado. Devolve o registro.
async function criarRascunhoProposta(chamadoId) {
  const existente = (await pool.query('SELECT * FROM chamados_propostas WHERE chamado_id = $1', [chamadoId])).rows[0];
  if (existente) return existente;
  const { ch, horas, valorHora } = await dadosDoChamado(chamadoId);
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

// Puxa de novo as horas (Total Geral) e o valor/hora do chamado para a proposta.
// Devolve o registro atualizado (ou null se o chamado nao tem proposta).
async function atualizarHorasDaProposta(chamadoId) {
  const existente = (await pool.query('SELECT id FROM chamados_propostas WHERE chamado_id = $1', [chamadoId])).rows[0];
  if (!existente) return null;
  const { horas, valorHora } = await dadosDoChamado(chamadoId);
  const { rows } = await pool.query(
    'UPDATE chamados_propostas SET horas = $1, valor_hora = $2, atualizado_em = NOW() WHERE id = $3 RETURNING *',
    [horas, valorHora, existente.id]
  );
  return rows[0];
}

module.exports = { criarRascunhoProposta, atualizarHorasDaProposta };
