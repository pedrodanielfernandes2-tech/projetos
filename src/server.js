require('dotenv').config();
const express = require('express');
const path = require('path');
const { ready } = require('./db');
const { startScheduler } = require('./scheduler');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/gps', require('./routes/gps'));
app.use('/api/admin-emails', require('./routes/adminEmails'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/email-config', require('./routes/emailConfig'));
app.use('/api/areas', require('./routes/areas'));

const PORT = process.env.PORT || 3000;

ready.then(() => {
  app.listen(PORT, () => {
    console.log(`Painel de projetos rodando em http://localhost:${PORT}`);
    startScheduler();
  });
});
