const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './data/gp-projetos.db';
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS gps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    areas TEXT NOT NULL DEFAULT '[]',
    criado_em TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admin_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    gp_id INTEGER,
    tipo TEXT DEFAULT 'Melhoria',
    fase TEXT DEFAULT 'Levantamento',
    status_prazo TEXT DEFAULT 'em dia',
    resumo TEXT DEFAULT '',
    data_inicio TEXT,
    data_fim TEXT,
    progresso INTEGER DEFAULT 0,
    criado_em TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (gp_id) REFERENCES gps(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS area_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    area TEXT NOT NULL,
    inicio TEXT,
    fim TEXT,
    status TEXT DEFAULT 'planejamento',
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS historico (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    data TEXT NOT NULL,
    texto TEXT NOT NULL,
    autor TEXT DEFAULT '',
    criado_em TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS email_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    frequencia TEXT DEFAULT 'semanal',
    dia_semana INTEGER DEFAULT 5,
    hora INTEGER DEFAULT 8,
    enviar_gps INTEGER DEFAULT 1,
    enviar_admins INTEGER DEFAULT 1,
    ultimo_envio TEXT
  );

  INSERT OR IGNORE INTO email_config (id) VALUES (1);
`);

module.exports = db;
