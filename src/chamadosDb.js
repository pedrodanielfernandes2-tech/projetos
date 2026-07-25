// Segunda conexão Postgres, separada da conexão principal (que continua sendo
// a do Postgres de Projetos, no Render). Esta aqui aponta para o Supabase,
// onde os dados de Chamados AN já existem — não precisa migrar nada.
//
// O parser de DATE (tipo 1082) já foi trocado globalmente no db.js principal
// (`types.setTypeParser(1082, val => val)`), e como isso é global no módulo
// `pg`, vale também para este segundo Pool — não precisa repetir aqui.
const { Pool } = require('pg');

if (!process.env.CHAMADOS_DATABASE_URL) {
  console.error('ERRO: variavel CHAMADOS_DATABASE_URL nao definida. Configure no .env (veja .env.example).');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.CHAMADOS_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = { pool };
