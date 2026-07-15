const { Pool, types } = require('pg');

// Sem isso, o driver converte colunas DATE em objetos Date (com fuso e hora),
// o que quebra o formato "AAAA-MM-DD" que o frontend espera.
types.setTypeParser(1082, val => val);


if (!process.env.DATABASE_URL) {
  console.error('ERRO: variavel DATABASE_URL nao definida. Configure no .env (veja .env.example).');
  process.exit(1);
}

const useSSL = process.env.PGSSLMODE !== 'disable';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS areas (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS gps (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admin_emails (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      gp_id INTEGER REFERENCES gps(id) ON DELETE SET NULL,
      tipo TEXT DEFAULT 'Melhoria',
      fase TEXT DEFAULT 'Levantamento',
      status_prazo TEXT DEFAULT 'em dia',
      resumo TEXT DEFAULT '',
      data_inicio DATE,
      data_fim DATE,
      progresso INTEGER DEFAULT 0,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS area_tasks (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      area TEXT NOT NULL,
      inicio DATE,
      fim DATE,
      status TEXT DEFAULT 'planejamento'
    );

    CREATE TABLE IF NOT EXISTS historico (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      data DATE NOT NULL,
      texto TEXT NOT NULL,
      autor TEXT DEFAULT '',
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS email_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      frequencia TEXT DEFAULT 'semanal',
      dia_semana INTEGER DEFAULT 5,
      hora INTEGER DEFAULT 8,
      enviar_gps BOOLEAN DEFAULT TRUE,
      enviar_admins BOOLEAN DEFAULT TRUE,
      ultimo_envio TIMESTAMP,
      CONSTRAINT email_config_singleton CHECK (id = 1)
    );

    INSERT INTO email_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  `);

  // Migracao: remove a coluna "areas" de bancos criados por uma versao anterior,
  // ja que o GP agora e vinculado diretamente ao projeto (gp_id), nao mais por area.
  await pool.query('ALTER TABLE gps DROP COLUMN IF EXISTS areas;');

  const areasIniciais = ['Desenvolvimento', 'PDV', 'Visual Store', 'Integração', 'Inovação', 'Tesouraria'];
  for (const nome of areasIniciais) {
    await pool.query('INSERT INTO areas (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING', [nome]);
  }
}

const ready = init().catch(err => {
  console.error('Falha ao inicializar o banco de dados:', err.message);
  process.exit(1);
});

module.exports = { pool, ready };
