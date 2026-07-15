# Painel de Projetos

Plataforma simples para dar visibilidade de projetos entre as áreas de
Desenvolvimento, PDV, Visual Store, Integração, Inovação e Tesouraria: quem é
o GP, quando começa e termina o projeto (e a tarefa de cada área dentro dele),
histórico de atualizações, e envio automático de e-mail de resumo para os GPs
e para admins, com a periodicidade que você configurar.

## Stack (propositalmente simples)

- **Backend**: Node.js + Express
- **Banco de dados**: SQLite embutido no próprio Node (`node:sqlite`) — não
  precisa instalar nem configurar nenhum servidor de banco separado. É um
  arquivo `.db` local, criado automaticamente na primeira execução.
- **E-mail**: Nodemailer, compatível com Gmail, Outlook 365 ou o SMTP da
  empresa.
- **Agendamento**: node-cron, verifica todo dia às 07h se deve disparar o
  e-mail, conforme a periodicidade configurada no painel Admin.
- **Frontend**: HTML + CSS + JavaScript puro, servido pelo próprio backend.
  Sem build, sem framework — fácil de qualquer dev mexer depois.

Requisito: **Node.js 22.5 ou superior** (usa o módulo experimental
`node:sqlite`).

## Como rodar

```bash
npm install
cp .env.example .env
```

Edite o `.env` com:
- As credenciais de SMTP (host, porta, usuário, senha) para o envio de
  e-mail. Se usar Gmail, gere uma "senha de app" em vez da senha normal.
- Uma senha de admin (`ADMIN_PASSWORD`) — hoje ainda não está aplicada como
  autenticação real na interface (ver seção "Próximos passos"), mas já fica
  preparada no `.env`.

Depois:

```bash
npm start
```

Acesse `http://localhost:3000`.

## Estrutura do projeto

```
gp-projetos/
  src/
    server.js        - servidor Express
    db.js             - conexão e schema do SQLite
    email.js          - composição e envio dos e-mails
    scheduler.js       - verifica diariamente se deve disparar o e-mail
    routes/
      projects.js      - CRUD de projetos, tarefas por área e histórico
      gps.js            - CRUD de gerentes de projeto
      adminEmails.js     - CRUD de destinatários admin
      emailConfig.js     - configuração de periodicidade + envio manual
  public/
    index.html, styles.css, app.js  - frontend
  data/
    gp-projetos.db     - banco de dados (criado automaticamente, não versionar)
```

## Como usar

1. Vá em **Admin** e cadastre os GPs (nome, e-mail, áreas que cada um
   acompanha) e os e-mails de admin que devem receber o resumo geral.
2. Configure a periodicidade do envio automático (diária, semanal, quinzenal
   ou mensal) e se deve ir para GPs, admins, ou ambos.
3. Volte para **Projetos** e cadastre um projeto: nome, GP responsável, tipo,
   fase, prazo geral e, para cada área envolvida, o início e fim da tarefa
   específica dela.
4. Cada projeto tem um histórico de atualizações (semelhante ao e-mail que
   os GPs mandam hoje) — qualquer pessoa pode adicionar uma nova linha
   diretamente no card do projeto.
5. Use o botão **"Enviar agora (teste)"** na aba Admin para testar o envio de
   e-mail sem esperar o agendamento automático.

## O que NÃO está implementado ainda (próximos passos sugeridos)

Este é um MVP funcional pensado para validar o processo com o time antes de
evoluir. Pontos importantes para uma versão de produção:

- **Autenticação real** (login por usuário/área, não só uma senha única de
  admin) e controle de permissão (quem pode editar o quê).
- **Edição de projeto existente** pela interface (hoje dá para criar e ver;
  editar status/progresso/tarefas depois de criado precisa ser feito via API
  ou adicionando telas de edição).
- **Alerta automático de dependência entre áreas** (ex: avisar quando uma
  área atrasada vai empurrar o início da área seguinte).
- **Deploy**: hoje roda local. Para uso real da empresa, hospedar em um
  servidor interno ou serviço de nuvem (Render, Railway, um servidor da
  própria empresa, etc.) e trocar o SQLite por um Postgres se o uso crescer
  muito (o SQLite atual aguenta tranquilamente o volume de um time interno).
