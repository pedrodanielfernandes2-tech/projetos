require('dotenv').config();
const express = require('express');
const path = require('path');
const { ready } = require('./db');
const { startScheduler } = require('./scheduler');
const { requirePermissao } = require('./usuariosAuth');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- rotas publicas (nao exigem login de usuario) ----------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/adminAuth')); // login do Admin em si (senha unica)
app.use('/api/chamados-auth', require('./routes/chamadosLogin')); // login do Chamados (senha unica)
app.use('/api/cron', require('./routes/cron')); // protegido por token proprio (CRON_SECRET), nao por login

// Rota leve, sem tocar no banco de dados, feita pra um servico externo (tipo
// cron-job.org ou UptimeRobot) chamar periodicamente e manter o Render acordado
// no plano gratuito - sem isso, o node-cron interno para de disparar quando o
// processo "dorme" por inatividade.
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', horario: new Date().toISOString() });
});

// ---------- gerenciamento de usuarios (protegido pela senha de Admin) ----------
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/implantacao', require('./routes/implantacao'));

// ---------- modulo Chamados (mantem seu proprio gate por senha unica, por enquanto) ----------
app.use('/api/chamados', require('./routes/chamados'));
app.use('/api/chamados-clientes', require('./routes/chamadosClientes'));
app.use('/api/chamados-analistas', require('./routes/chamadosAnalistas'));
app.use('/api/chamados-config', require('./routes/chamadosConfig'));
app.use('/api/chamados-status-ocultos', require('./routes/chamadosStatusOcultos'));
app.use('/api/chamados-modelos-parcelamento', require('./routes/chamadosModelosParcelamento'));
app.use('/api/chamados-tabelas-recurso', require('./routes/chamadosTabelasRecurso'));

// ---------- modulo Projetos: exige login de usuario com permissao "pode_projetos" ----------
const gateProjetos = requirePermissao('pode_projetos');
const gateEquipe = requirePermissao('pode_equipe');
const { requireProjetoDoProprioGp } = require('./gpRestricao');
app.use('/api/gps', gateProjetos, require('./routes/gps'));
app.use('/api/implantadores', gateProjetos, require('./routes/implantadores'));
app.use('/api/demandas-avulsas', gateEquipe, require('./routes/demandasAvulsas'));
app.use('/api/visao-equipe', gateEquipe, require('./routes/visaoEquipe'));
app.use('/api/admin-emails', gateProjetos, require('./routes/adminEmails'));
app.use('/api/projects', gateProjetos, require('./routes/projects'));
app.use('/api/email-config', gateProjetos, require('./routes/emailConfig'));
app.use('/api/areas', gateProjetos, require('./routes/areas'));
app.use('/api/acoes', gateProjetos, require('./routes/acoes'));
app.use('/api/fases', gateProjetos, require('./routes/fases'));
app.use('/api/wbs-status', gateProjetos, require('./routes/wbsStatus'));
app.use('/api/clientes', gateProjetos, require('./routes/clientes'));
app.use('/api/settings', gateProjetos, require('./routes/settings'));
app.use('/api/audit-log', gateProjetos, require('./routes/auditLog'));
app.use('/api/projects/:id/wbs', gateProjetos, requireProjetoDoProprioGp(), require('./routes/wbs'));
app.use('/api/wbs', gateProjetos, require('./routes/wbsItems'));
app.use('/api/wbs-templates', gateProjetos, require('./routes/wbsTemplates'));

// Rede de seguranca: se qualquer rota deixar passar um erro (via next(err) ou
// alguma promise rejeitada capturada pelo Express), devolve um JSON de erro
// legivel em vez do navegador receber uma resposta vazia/quebrada.
app.use((err, req, res, next) => {
  console.error('[erro nao tratado]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'erro interno no servidor' });
});

const PORT = process.env.PORT || 3000;

ready.then(() => {
  app.listen(PORT, () => {
    console.log(`Painel de projetos rodando em http://localhost:${PORT}`);
    startScheduler();
  });
});
