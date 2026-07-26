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

    CREATE TABLE IF NOT EXISTS clientes (
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
      chamado TEXT DEFAULT '',
      cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
      gp_id INTEGER REFERENCES gps(id) ON DELETE SET NULL,
      tipo TEXT DEFAULT 'Melhoria',
      fase TEXT DEFAULT 'Levantamento',
      status_prazo TEXT DEFAULT 'em dia',
      resumo TEXT DEFAULT '',
      data_inicio DATE,
      data_fim DATE,
      progresso INTEGER DEFAULT 0,
      criado_em TIMESTAMP DEFAULT NOW(),
      ultimo_status_notificado TEXT,
      priorizacao_ativa BOOLEAN DEFAULT FALSE
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

    CREATE TABLE IF NOT EXISTS project_links (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      titulo TEXT NOT NULL,
      url TEXT NOT NULL,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS email_config (
      id INTEGER PRIMARY KEY DEFAULT 1,
      frequencia TEXT DEFAULT 'semanal',
      dia_semana INTEGER DEFAULT 5,
      hora INTEGER DEFAULT 8,
      enviar_gps BOOLEAN DEFAULT TRUE,
      enviar_admins BOOLEAN DEFAULT TRUE,
      enviar_teams BOOLEAN DEFAULT FALSE,
      ultimo_envio TIMESTAMP,
      CONSTRAINT email_config_singleton CHECK (id = 1)
    );

    INSERT INTO email_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      restringir_exclusao BOOLEAN DEFAULT FALSE,
      restringir_edicao_prazos BOOLEAN DEFAULT FALSE,
      CONSTRAINT app_settings_singleton CHECK (id = 1)
    );

    INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      entidade TEXT NOT NULL,
      entidade_id INTEGER,
      projeto_id INTEGER,
      projeto_nome TEXT DEFAULT '',
      acao TEXT NOT NULL,
      autor TEXT DEFAULT '',
      detalhes TEXT DEFAULT '',
      envolve_data BOOLEAN DEFAULT FALSE,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wbs_items (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES wbs_items(id) ON DELETE CASCADE,
      titulo TEXT NOT NULL,
      area TEXT DEFAULT '',
      acao TEXT DEFAULT '',
      responsavel TEXT DEFAULT '',
      status TEXT DEFAULT 'Pendente',
      data_inicio DATE,
      data_fim DATE,
      observacao TEXT DEFAULT '',
      ordem INTEGER DEFAULT 0,
      criado_em TIMESTAMP DEFAULT NOW(),
      impacto NUMERIC DEFAULT 0,
      esforco NUMERIC DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS acoes (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS fases (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE,
      ordem INTEGER DEFAULT 0,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wbs_status (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL UNIQUE,
      ordem INTEGER DEFAULT 0,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wbs_templates (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wbs_template_items (
      id SERIAL PRIMARY KEY,
      template_id INTEGER NOT NULL REFERENCES wbs_templates(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES wbs_template_items(id) ON DELETE CASCADE,
      titulo TEXT NOT NULL,
      area TEXT DEFAULT '',
      acao TEXT DEFAULT '',
      ordem INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chamados_clientes (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      ativo BOOLEAN DEFAULT TRUE,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chamados_analistas (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      ativo BOOLEAN DEFAULT TRUE,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chamados_config (
      id SERIAL PRIMARY KEY,
      pct_qa NUMERIC NOT NULL DEFAULT 0.6,
      pct_gerencial NUMERIC NOT NULL DEFAULT 0.2,
      valor_hora NUMERIC NOT NULL DEFAULT 0,
      vigente_desde TIMESTAMP DEFAULT NOW(),
      vigente_ate TIMESTAMP,
      criado_por TEXT DEFAULT '',
      criado_em TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS chamados_status_ocultos (
      status TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS chamados (
      id SERIAL PRIMARY KEY,
      numero INTEGER NOT NULL,
      cliente_id INTEGER REFERENCES chamados_clientes(id) ON DELETE SET NULL,
      analista_id INTEGER REFERENCES chamados_analistas(id) ON DELETE SET NULL,
      descricao TEXT DEFAULT '',
      status TEXT DEFAULT '',
      data_abertura DATE,
      grupo_trabalho TEXT,
      complexidade TEXT,
      proposta_status TEXT,
      data_envio_proposta DATE,
      data_aprovacao DATE,
      horas_dev NUMERIC DEFAULT 0,
      pct_margem NUMERIC DEFAULT 0,
      pct_negociado NUMERIC DEFAULT 0,
      qtd_parcelas INTEGER DEFAULT 1,
      pct_qa_aplicado NUMERIC DEFAULT 0,
      pct_gerencial_aplicado NUMERIC DEFAULT 0,
      valor_hora_aplicado NUMERIC DEFAULT 0,
      valor_projeto_real NUMERIC,
      desconto_negociado_real NUMERIC,
      valor_total_projeto_real NUMERIC,
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );
  `);

  // Migracao: remove a coluna "areas" de bancos criados por uma versao anterior,
  // ja que o GP agora e vinculado diretamente ao projeto (gp_id), nao mais por area.
  await pool.query('ALTER TABLE gps DROP COLUMN IF EXISTS areas;');

  // Migracao: adiciona colunas novas em bancos criados por uma versao anterior.
  await pool.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS chamado TEXT DEFAULT '';");
  await pool.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL;');
  await pool.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS ultimo_status_notificado TEXT;');
  await pool.query('ALTER TABLE email_config ADD COLUMN IF NOT EXISTS enviar_teams BOOLEAN DEFAULT FALSE;');
  await pool.query("ALTER TABLE wbs_items ADD COLUMN IF NOT EXISTS acao TEXT DEFAULT '';");
  await pool.query('ALTER TABLE projects ADD COLUMN IF NOT EXISTS priorizacao_ativa BOOLEAN DEFAULT FALSE;');
  await pool.query('ALTER TABLE wbs_items ADD COLUMN IF NOT EXISTS impacto NUMERIC DEFAULT 0;');
  await pool.query('ALTER TABLE wbs_items ADD COLUMN IF NOT EXISTS esforco NUMERIC DEFAULT 0;');

  // Renomeia o status "Impasse" para "Suspensa" em instalacoes ja existentes
  // (tanto no cadastro quanto nos itens de WBS que ja usavam esse status).
  await pool.query("UPDATE wbs_status SET nome = 'Suspensa' WHERE nome = 'Impasse'");
  await pool.query("UPDATE wbs_items SET status = 'Suspensa' WHERE status = 'Impasse'");

  // Popula as areas padrao apenas na primeira vez (tabela vazia). Depois disso,
  // respeita qualquer area que o usuario tenha removido de proposito.
  const { rows: areaCountRows } = await pool.query('SELECT COUNT(*)::int AS n FROM areas');
  if (areaCountRows[0].n === 0) {
    const areasIniciais = ['Desenvolvimento', 'PDV', 'Visual Store', 'Integração', 'Inovação', 'Tesouraria'];
    for (const nome of areasIniciais) {
      await pool.query('INSERT INTO areas (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING', [nome]);
    }
  }

  // Mesma logica para acoes: popula apenas na primeira vez.
  const { rows: acaoCountRows } = await pool.query('SELECT COUNT(*)::int AS n FROM acoes');
  if (acaoCountRows[0].n === 0) {
    const acoesIniciais = ['Desenvolvimento', 'Análise'];
    for (const nome of acoesIniciais) {
      await pool.query('INSERT INTO acoes (nome) VALUES ($1) ON CONFLICT (nome) DO NOTHING', [nome]);
    }
  }

  // Mesma logica para fases: popula apenas na primeira vez.
  const { rows: faseCountRows } = await pool.query('SELECT COUNT(*)::int AS n FROM fases');
  if (faseCountRows[0].n === 0) {
    const fasesIniciais = ['Planejamento', 'Levantamento', 'Desenvolvimento', 'Homologação', 'Concluído'];
    for (let i = 0; i < fasesIniciais.length; i++) {
      await pool.query('INSERT INTO fases (nome, ordem) VALUES ($1, $2) ON CONFLICT (nome) DO NOTHING', [fasesIniciais[i], i]);
    }
  }

  // Mesma logica para status da WBS: popula apenas na primeira vez.
  const { rows: wbsStatusCountRows } = await pool.query('SELECT COUNT(*)::int AS n FROM wbs_status');
  if (wbsStatusCountRows[0].n === 0) {
    const statusIniciais = ['Pendente', 'Em Andamento', 'Em Elaboração', 'Homolog./Cliente', 'Concluído', 'Suspensa'];
    for (let i = 0; i < statusIniciais.length; i++) {
      await pool.query('INSERT INTO wbs_status (nome, ordem) VALUES ($1, $2) ON CONFLICT (nome) DO NOTHING', [statusIniciais[i], i]);
    }
  }

  // Config inicial de calculo do modulo Chamados, so na primeira vez.
  const { rows: chamadosConfigCountRows } = await pool.query('SELECT COUNT(*)::int AS n FROM chamados_config WHERE vigente_ate IS NULL');
  if (chamadosConfigCountRows[0].n === 0) {
    await pool.query('INSERT INTO chamados_config (pct_qa, pct_gerencial, valor_hora) VALUES (0.6, 0.2, 162.94)');
  }

  // Migracao: ajusta o esquema de chamados criado na Fase 1 (antes de conhecermos
  // a estrutura real dos dados do Supabase) para bater com os campos reais.
  await pool.query('ALTER TABLE chamados_clientes ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE;');
  await pool.query('ALTER TABLE chamados_config ADD COLUMN IF NOT EXISTS vigente_desde TIMESTAMP DEFAULT NOW();');
  await pool.query("ALTER TABLE chamados_config ADD COLUMN IF NOT EXISTS criado_por TEXT DEFAULT '';");
  await pool.query('ALTER TABLE chamados ADD COLUMN IF NOT EXISTS data_abertura DATE;');
  await pool.query('ALTER TABLE chamados ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP DEFAULT NOW();');
  await pool.query('ALTER TABLE chamados ADD COLUMN IF NOT EXISTS valor_projeto_real NUMERIC;');
  await pool.query('ALTER TABLE chamados ADD COLUMN IF NOT EXISTS desconto_negociado_real NUMERIC;');
  await pool.query('ALTER TABLE chamados ADD COLUMN IF NOT EXISTS valor_total_projeto_real NUMERIC;');
  // Remove a restricao de numero unico: os dados reais migrados de 34 planilhas
  // tem numeros de chamado legitimamente repetidos entre si.
  await pool.query('ALTER TABLE chamados DROP CONSTRAINT IF EXISTS chamados_numero_key;');
}

const ready = (async () => {
  const MAX_TENTATIVAS = 8;
  const ESPERA_BASE_MS = 3000; // 3s, 6s, 9s... ate ~1min no total

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      await init();
      if (tentativa > 1) console.log(`[db] conectado ao banco na tentativa ${tentativa}.`);
      return;
    } catch (err) {
      const ultimaTentativa = tentativa === MAX_TENTATIVAS;
      console.error(`[db] falha ao conectar (tentativa ${tentativa}/${MAX_TENTATIVAS}): ${err.message}`);
      if (ultimaTentativa) {
        console.error('[db] numero maximo de tentativas atingido, encerrando o processo.');
        process.exit(1);
      }
      await new Promise(resolve => setTimeout(resolve, ESPERA_BASE_MS * tentativa));
    }
  }
})();

module.exports = { pool, ready };
