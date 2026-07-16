# Painel de Projetos

Plataforma simples para dar visibilidade de projetos entre as áreas de
Desenvolvimento, PDV, Visual Store, Integração, Inovação e Tesouraria: quem é
o GP, quando começa e termina o projeto (e a tarefa de cada área dentro dele),
histórico de atualizações, e envio automático de e-mail de resumo para os GPs
e para admins, com a periodicidade que você configurar.

## Stack (propositalmente simples)

- **Backend**: Node.js + Express
- **Banco de dados**: PostgreSQL. Funciona com qualquer Postgres — Render,
  Supabase, Neon, ou um Postgres local para desenvolvimento.
- **E-mail**: Nodemailer, compatível com Gmail, Outlook 365 ou o SMTP da
  empresa.
- **Agendamento**: node-cron, verifica todo dia às 07h se deve disparar o
  e-mail, conforme a periodicidade configurada no painel Admin.
- **Frontend**: HTML + CSS + JavaScript puro, servido pelo próprio backend.
  Sem build, sem framework — fácil de qualquer dev mexer depois.

Requisito: **Node.js 18 ou superior** e um banco **Postgres** acessível (local
ou na nuvem).

## Como rodar

```bash
npm install
cp .env.example .env
```

Edite o `.env` com:
- `DATABASE_URL`: a string de conexão do seu Postgres. Se estiver usando o
  Postgres gratuito do Render, vá no seu banco → aba **Connections** → copie
  a **External Database URL** (ou a **Internal Database URL** se o app
  também estiver hospedado no Render — é mais rápido e não sai da rede
  interna deles).
- As credenciais de SMTP (host, porta, usuário, senha) para o envio de
  e-mail. Se usar Gmail, gere uma "senha de app" em vez da senha normal.
- Uma senha de admin (`ADMIN_PASSWORD`) — protege o acesso à aba **Admin** e,
  opcionalmente (ver "Permissões" no Admin), também protege excluir projetos
  e editar projetos/prazos por área.

Depois:

```bash
npm start
```

Acesse `http://localhost:3000`. As tabelas são criadas automaticamente na
primeira execução (não precisa rodar nenhuma migração manual).

### Criando um banco Postgres gratuito no Render

1. No dashboard do Render, clique em **New → PostgreSQL**.
2. Dê um nome, escolha a região e o plano gratuito.
3. Depois de criado, vá na aba do banco → **Connections** → copie a
   **Internal Database URL** (se o app estiver no mesmo Render) e cole na
   variável de ambiente `DATABASE_URL` do seu **Web Service** (aba
   **Environment**).

## Estrutura do projeto

```
gp-projetos/
  src/
    server.js        - servidor Express
    db.js             - conexão com o Postgres e criação automática do schema
    email.js          - composição e envio dos e-mails
    scheduler.js       - verifica diariamente se deve disparar o e-mail
    routes/
      projects.js      - CRUD de projetos, tarefas por área e histórico
      gps.js            - CRUD de gerentes de projeto
      adminEmails.js     - CRUD de destinatários admin
      emailConfig.js     - configuração de periodicidade + envio manual
      areas.js           - CRUD de áreas da empresa
  public/
    index.html, styles.css, app.js  - frontend
```

## Como usar

1. Vá em **Admin** e cadastre as áreas da empresa, os GPs (nome e e-mail) e
   os e-mails de admin que devem receber o resumo geral.
2. Configure a periodicidade do envio automático (diária, semanal, quinzenal
   ou mensal) e se deve ir para GPs, admins, ou ambos.
3. Volte para **Projetos** e cadastre um projeto: nome, GP responsável, tipo,
   fase, prazo geral e, para cada área envolvida, o início e fim da tarefa
   específica dela.
4. Cada GP recebe automaticamente o resumo apenas dos projetos em que ele é o
   responsável (vínculo direto, feito na hora de cadastrar o projeto) — não
   depende mais de nenhuma área vinculada ao GP.
5. Cada projeto tem um histórico de atualizações (semelhante ao e-mail que
   os GPs mandam hoje) — qualquer pessoa pode adicionar uma nova linha
   diretamente no card do projeto.
6. Use o botão **"Enviar agora (teste)"** na aba Admin para testar o envio de
   e-mail sem esperar o agendamento automático.

## O que já tem de controle de acesso

- A aba **Admin** sempre exige a senha definida em `ADMIN_PASSWORD`.
- Em **Admin → Permissões**, você decide se **excluir projetos** e se
  **editar projetos/prazos por área** também exigem essa senha, ou se
  qualquer pessoa com acesso à tela pode fazer isso livremente.
- É uma senha única (não é login por usuário), guardada no navegador durante
  a sessão — suficiente para um time pequeno, mas não substitui um sistema de
  contas de usuário de verdade.

## O que NÃO está implementado ainda (próximos passos sugeridos)

Este é um MVP funcional pensado para validar o processo com o time antes de
evoluir. Pontos importantes para uma versão de produção:

- **Autenticação por usuário** (login individual por pessoa/área, com
  histórico de quem fez o quê) em vez de uma senha única de admin.
- **Alerta automático de dependência entre áreas** (ex: avisar quando uma
  área atrasada vai empurrar o início da área seguinte).
- **Deploy**: hoje o app em si roda onde você hospedar (ex: Render); o banco
  Postgres você já pode apontar para produção desde já. Com Postgres, o
  projeto aguenta crescer bem além do uso de um time interno.
