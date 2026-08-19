const SAUDE_IMPLANTACAO_LABEL = {
  saudavel: 'em dia',
  atencao: 'atenção',
  critico: 'crítico',
};
const SAUDE_IMPLANTACAO_DESCRICAO = {
  saudavel: 'Nenhum item do checklist de implantação está atrasado ou suspenso.',
  atencao: 'O checklist de implantação tem item em risco (prazo perto do fim) ou suspenso por impeditivo.',
  critico: 'O checklist de implantação tem pelo menos um item com o prazo vencido.',
};

const state = {
  areas: [],
  acoes: [],
  fases: [],
  wbsStatusList: [],
  allProjects: [], // lista completa, sem filtro (fonte da verdade)
  projects: [], // lista apos filtro/busca/ordenacao (o que e renderizado)
  gps: [],
  adminEmails: [],
  clientes: [],
  settings: { restringir_exclusao: false, restringir_edicao_prazos: false },
  activeFilter: null,
  gpFilter: null,
  mostrarConcluidos: false,
  equipePaginaAtual: 0,
  semanalPaginaAtual: 0,
  searchText: '',
  sortBy: 'prazo',
  isAdmin: false,
  adminPassword: null,
  isChamados: false,
  chamadosPassword: null,
  autorNome: '',
  usuarioToken: null,
  usuario: null,
  expanded: {}, // projectId -> 'tarefas' | 'historico' | 'links' | null
  newProjectAreas: {}, // area -> {inicio, fim}
  calendarMonth: new Date().getMonth(),
  calendarYear: new Date().getFullYear(),
  calendarAreaFilter: null,
  calendarProjects: [],
};

// ---------- helpers ----------
function slug(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
}
function fmtDate(d) {
  if (!d) return '-';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}
function fmtDateFull(d) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('pt-BR');
}
function progressColor(progresso) {
  if (progresso < 30) return 'var(--success)';
  if (progresso < 70) return 'var(--warning)';
  return 'var(--danger)';
}
// Diferente de progressColor: aqui mais % e melhor (mais itens concluidos), entao a logica
// nao e invertida - baixo = vermelho, alto = verde.
function completionColor(percent) {
  if (percent < 30) return 'var(--danger)';
  if (percent < 70) return 'var(--warning)';
  return 'var(--success)';
}
function barWidth(progresso) {
  // largura minima visivel, para a cor sempre aparecer mesmo em 0%
  return Math.max(progresso, 4);
}
function elapsedPercent(inicio, fim) {
  if (!inicio || !fim) return null;
  const hoje = new Date();
  const start = new Date(inicio + 'T00:00:00');
  const end = new Date(fim + 'T00:00:00');
  if (hoje <= start) return 0;
  if (hoje >= end) return 100;
  const total = end - start;
  if (total <= 0) return 100;
  return Math.round(((hoje - start) / total) * 100);
}

// Sinaliza a saude do prazo de um item da WBS: 'atrasado' | 'risco' | 'ok' | null (nao avaliavel).
function wbsPrazoStatus(item) {
  if (item.status === 'Concluído' || item.status === 'Suspensa') return null;
  if (!item.data_fim) return null;
  const hojeStr = new Date().toISOString().slice(0, 10);
  if (hojeStr > item.data_fim) return 'atrasado';
  if (item.data_inicio) {
    const elapsed = elapsedPercent(item.data_inicio, item.data_fim);
    if (elapsed !== null && elapsed >= 80) return 'risco';
  } else {
    const diasRestantes = (new Date(item.data_fim + 'T00:00:00') - new Date()) / (1000 * 60 * 60 * 24);
    if (diasRestantes <= 3) return 'risco';
  }
  return 'ok';
}
function taskBarInfo(t) {
  const s = (t.status || '').toLowerCase();
  if (s === 'atrasado') return { percent: 100, color: 'var(--danger)' };
  if (s === 'bloqueado') return { percent: 100, color: 'var(--warning)' };
  if (s === 'concluído' || s === 'concluido') return { percent: 100, color: 'var(--success)' };
  const elapsed = elapsedPercent(t.inicio, t.fim);
  return { percent: elapsed, color: progressColor(elapsed) };
}
function statusClass(s) {
  return 'badge-' + slug(s || 'planejamento');
}
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.adminPassword) headers['x-admin-password'] = state.adminPassword;
  if (state.autorNome) headers['x-autor'] = state.autorNome;
  if (state.usuarioToken) headers['Authorization'] = 'Bearer ' + state.usuarioToken;
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { ...headers, ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'erro desconhecido' }));
    if (res.status === 401) {
      state.isAdmin = false;
      state.adminPassword = null;
      sessionStorage.removeItem('adminPassword');
      if (err.error === 'sessao invalida ou expirada' || err.error === 'nao autenticado') {
        logout();
      }
    }
    throw new Error(err.error || 'falha na requisicao');
  }
  return res.status === 204 ? null : res.json();
}

// ---------- login de usuario ----------
function loadUsuarioSession() {
  try {
    const token = localStorage.getItem('usuarioToken');
    const infoRaw = localStorage.getItem('usuarioInfo');
    if (token && infoRaw) {
      state.usuarioToken = token;
      state.usuario = JSON.parse(infoRaw);
      return true;
    }
    return false;
  } catch (e) {
    // localStorage bloqueado (modo privado, politica corporativa, etc.) - segue sem sessao salva
    return false;
  }
}

function aplicarPermissoesMenu() {
  document.querySelectorAll('.sidebar-nav-btn[data-requer]').forEach(btn => {
    const permissao = btn.dataset.requer;
    const temPermissao = state.usuario && state.usuario[permissao];
    btn.classList.toggle('hidden', !temPermissao);
  });
  const nomeEl = document.getElementById('sidebar-usuario-nome');
  if (nomeEl) nomeEl.textContent = state.usuario ? state.usuario.nome : '';
}

function mostrarPortaoLogin() {
  document.getElementById('login-gate').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
}
function esconderPortaoLogin() {
  document.getElementById('login-gate').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
}

function mostrarSemAcessoProjetos() {
  const lista = document.getElementById('project-list');
  const stats = document.getElementById('stats-grid');
  if (lista) lista.innerHTML = '<p class="muted">Você ainda não tem acesso a este módulo. Peça para o Admin liberar seu acesso em "Projetos".</p>';
  if (stats) stats.innerHTML = '';
}

function resetarTodasAsViews() {
  // Esconde tudo, sem assumir nenhuma tela como padrao - quem decide qual mostrar
  // e sempre uma chamada explicita a activateTab() logo em seguida. Isso evita
  // o "flash" de mostrar Projetos por uma fracao de segundo antes de trocar pra
  // outra tela, pra quem nao tem acesso a Projetos.
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.sidebar-nav-btn').forEach(b => b.classList.remove('active'));
}

function logout() {
  localStorage.removeItem('usuarioToken');
  localStorage.removeItem('usuarioInfo');
  state.usuarioToken = null;
  state.usuario = null;
  // Zera tambem as sessoes de Admin e Chamados - sem isso, uma permissao concedida
  // numa sessao anterior (nessa mesma aba do navegador) vazaria pro proximo login.
  state.isAdmin = false;
  state.adminPassword = null;
  sessionStorage.removeItem('adminPassword');
  state.isChamados = false;
  state.chamadosPassword = null;
  sessionStorage.removeItem('chamadosPassword');
  resetarTodasAsViews();
  mostrarPortaoLogin();
}
document.getElementById('btn-logout').addEventListener('click', logout);

// Espera o navegador terminar de desenhar a troca de "portao de login" pro app
// (dois requestAnimationFrame = garante que passou por um ciclo de pintura completo)
// antes de ativar a aba - sem isso, telas que medem o proprio tamanho (como o Gantt
// da Equipe, pra calcular a paginacao) podem medir com o layout ainda "escondido",
// e so acertam depois que a pessoa clica de novo em algum lugar.
function proximoFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function aposLogin() {
  resetarTodasAsViews();
  esconderPortaoLogin();
  aplicarPermissoesMenu();
  loadAdminSession();
  loadChamadosSession();
  await proximoFrame();
  if (state.usuario.pode_projetos) {
    activateTab(document.querySelector('[data-tab="projetos"]'));
    await loadAll();
  } else if (state.usuario.pode_implantacao) {
    activateTab(document.querySelector('[data-tab="implantacao"]'));
  } else if (state.usuario.pode_equipe) {
    activateTab(document.querySelector('[data-tab="equipe"]'));
  } else if (state.usuario.pode_chamados) {
    if (state.isChamados) {
      window.location.href = '/chamados.html';
    } else {
      requestChamadosLogin(() => { window.location.href = '/chamados.html'; });
    }
  } else if (state.usuario.pode_admin) {
    requestAdminLogin(() => activateTab(document.querySelector('[data-tab="admin"]')));
  } else {
    activateTab(document.querySelector('[data-tab="projetos"]'));
    mostrarSemAcessoProjetos();
  }
}

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const senha = document.getElementById('login-senha').value;
  const erroEl = document.getElementById('login-erro');
  erroEl.classList.add('hidden');
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'falha ao entrar');
    state.usuarioToken = data.token;
    state.usuario = data.usuario;
    localStorage.setItem('usuarioToken', data.token);
    localStorage.setItem('usuarioInfo', JSON.stringify(data.usuario));
    await aposLogin();
  } catch (err) {
    erroEl.textContent = err.message;
    erroEl.classList.remove('hidden');
  }
});

document.getElementById('link-esqueci-senha').addEventListener('click', () => {
  document.getElementById('login-form-wrap').classList.add('hidden');
  document.getElementById('esqueci-form-wrap').classList.remove('hidden');
});

// ---------- recolher/expandir o menu lateral (lembra a escolha entre sessoes) ----------
// Colocado DEPOIS do login estar conectado de proposito, e protegido com try/catch: se
// algo aqui falhar (localStorage bloqueado, elemento faltando por um deploy incompleto,
// etc.) isso nunca pode travar o app.js antes do login funcionar.
try {
  const sidebar = document.getElementById('app-sidebar');
  const btn = document.getElementById('btn-sidebar-collapse');
  if (sidebar && btn) {
    let salvo = false;
    try { salvo = localStorage.getItem('sidebarColapsado') === 'true'; } catch (e) { /* localStorage indisponivel - segue sem lembrar a escolha */ }
    if (salvo) {
      sidebar.classList.add('collapsed');
      btn.setAttribute('title', 'Expandir menu');
      btn.setAttribute('aria-label', 'Expandir menu');
    }
    btn.addEventListener('click', () => {
      const colapsado = sidebar.classList.toggle('collapsed');
      try { localStorage.setItem('sidebarColapsado', String(colapsado)); } catch (e) { /* localStorage indisponivel - so nao lembra da proxima vez */ }
      btn.setAttribute('title', colapsado ? 'Expandir menu' : 'Recolher menu');
      btn.setAttribute('aria-label', colapsado ? 'Expandir menu' : 'Recolher menu');
    });
  }
} catch (e) {
  console.error('[sidebar-colapsar] falha ao iniciar (nao critico):', e.message);
}
document.getElementById('link-voltar-login').addEventListener('click', () => {
  document.getElementById('esqueci-form-wrap').classList.add('hidden');
  document.getElementById('login-form-wrap').classList.remove('hidden');
});
document.getElementById('form-esqueci-senha').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('esqueci-email').value.trim();
  const statusEl = document.getElementById('esqueci-status');
  statusEl.classList.remove('hidden');
  statusEl.textContent = 'Enviando...';
  try {
    await fetch('/api/auth/esqueci-senha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    statusEl.textContent = 'Se esse e-mail existir no sistema, um link foi enviado.';
  } catch (err) {
    statusEl.textContent = 'Algo deu errado, tenta de novo em instantes.';
  }
});

// ---------- admin login ----------
function loadAdminSession() {
  const stored = sessionStorage.getItem('adminPassword');
  if (stored) {
    state.adminPassword = stored;
    state.isAdmin = true;
  }
}

// ---------- modal de senha estilizado (substitui o prompt() nativo feio) ----------
function pedirSenhaModal(titulo, subtitulo, erroInicial) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-senha-generica');
    const input = document.getElementById('senha-generica-input');
    const erroEl = document.getElementById('senha-generica-erro');
    const form = document.getElementById('form-senha-generica');
    const btnCancelar = document.getElementById('btn-cancelar-senha-generica');

    document.getElementById('senha-generica-titulo').textContent = titulo;
    document.getElementById('senha-generica-subtitulo').textContent = subtitulo || '';
    input.value = '';
    if (erroInicial) {
      erroEl.textContent = erroInicial;
      erroEl.classList.remove('hidden');
    } else {
      erroEl.classList.add('hidden');
    }
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 50);

    function limpar() {
      modal.classList.add('hidden');
      form.removeEventListener('submit', aoConfirmar);
      btnCancelar.removeEventListener('click', aoCancelar);
    }
    function aoConfirmar(e) {
      e.preventDefault();
      limpar();
      resolve(input.value);
    }
    function aoCancelar() {
      limpar();
      resolve(null);
    }
    form.addEventListener('submit', aoConfirmar);
    btnCancelar.addEventListener('click', aoCancelar);
  });
}

async function requestAdminLogin(onSuccess) {
  let erro = '';
  while (true) {
    const senha = await pedirSenhaModal('Acesso de Administrador', 'Digite a senha de administrador para continuar.', erro);
    if (senha === null || senha === '') return;
    state.adminPassword = senha;
    try {
      await api('/admin/login', { method: 'POST', body: JSON.stringify({ senha }) });
      state.isAdmin = true;
      sessionStorage.setItem('adminPassword', senha);
      if (onSuccess) onSuccess();
      return;
    } catch (err) {
      erro = 'Senha incorreta. Tente novamente.';
    }
  }
}

// ---------- chamados login ----------
function loadChamadosSession() {
  const stored = sessionStorage.getItem('chamadosPassword');
  if (stored) {
    state.chamadosPassword = stored;
    state.isChamados = true;
  }
}
async function requestChamadosLogin(onSuccess) {
  let erro = '';
  while (true) {
    const senha = await pedirSenhaModal('Acesso ao Chamados', 'Digite a senha de acesso ao módulo de Chamados.', erro);
    if (senha === null || senha === '') return;
    try {
      const res = await fetch('/api/chamados-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha }),
      });
      if (!res.ok) throw new Error('senha incorreta');
      state.chamadosPassword = senha;
      state.isChamados = true;
      sessionStorage.setItem('chamadosPassword', senha);
      if (onSuccess) onSuccess();
      return;
    } catch (err) {
      erro = 'Senha incorreta. Tente novamente.';
    }
  }
}

// ---------- tabs ----------
function activateTab(btn) {
  document.querySelectorAll('.sidebar-nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('view-projetos').classList.toggle('hidden', btn.dataset.tab !== 'projetos');
  document.getElementById('view-dashboard').classList.toggle('hidden', btn.dataset.tab !== 'dashboard');
  document.getElementById('view-admin').classList.toggle('hidden', btn.dataset.tab !== 'admin');
  document.getElementById('view-implantacao').classList.toggle('hidden', btn.dataset.tab !== 'implantacao');
  // A tela de WBS e uma "sub-tela" a parte (aberta via botao no card do projeto, nao
  // pelo menu lateral) - se estava aberta, precisa fechar sempre que trocar de aba
  // pelo menu, senao ela fica "grudada" embaixo da tela nova.
  document.getElementById('view-wbs').classList.add('hidden');
  if (btn.dataset.tab === 'dashboard') renderDashboard();
  if (btn.dataset.tab === 'admin') { renderAuditLog(); refreshUsuarios(); refreshImplantadores(); }
  if (btn.dataset.tab === 'implantacao') refreshImplantacao();
  if (btn.dataset.tab === 'equipe') refreshEquipe();
  document.getElementById('view-equipe').classList.toggle('hidden', btn.dataset.tab !== 'equipe');
}
document.querySelectorAll('.sidebar-nav-btn[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'admin' && !state.isAdmin) {
      requestAdminLogin(() => activateTab(btn));
      return;
    }
    if (btn.dataset.tab === 'chamados') {
      if (state.isChamados) {
        window.location.href = '/chamados.html';
      } else {
        requestChamadosLogin(() => { window.location.href = '/chamados.html'; });
      }
      return;
    }
    activateTab(btn);
  });
});

// ---------- load all data ----------
async function loadAll() {
  loadAdminSession();
  loadChamadosSession();
  const [areas, acoes, fases, wbsStatusList, gps, adminEmails, emailConfig, clientes, settings] = await Promise.all([
    api('/areas'),
    api('/acoes'),
    api('/fases'),
    api('/wbs-status'),
    api('/gps'),
    api('/admin-emails'),
    api('/email-config'),
    api('/clientes'),
    api('/settings'),
  ]);
  state.areas = areas;
  state.acoes = acoes;
  state.fases = fases;
  state.wbsStatusList = wbsStatusList;
  state.gps = gps;
  state.adminEmails = adminEmails;
  state.emailConfig = emailConfig;
  state.clientes = clientes;
  state.settings = settings;

  await refreshProjects();

  renderAreaFilters();
  renderGpFilters();
  renderAreaList();
  renderAcaoList();
  renderFaseList();
  renderWbsStatusList();
  renderGpList();
  renderAdminList();
  renderEmailConfig();
  renderPermissoes();
  populateGpSelect();
  populateFaseSelect();
  renderNewProjectAreaChips();
  renderClienteList();
  populateClienteSelect();
}

// ---------- projetos: busca central + filtros + ordenacao ----------
async function refreshProjects() {
  state.allProjects = await api('/projects');
  applyProjectFilters();
}
function sortProjects(list, sortBy) {
  const copy = [...list];
  if (sortBy === 'nome') {
    copy.sort((a, b) => a.nome.localeCompare(b.nome));
  } else if (sortBy === 'status') {
    const ordem = { atrasado: 0, bloqueado: 1, 'não iniciado': 2, 'em dia': 3, concluído: 4, concluido: 4 };
    copy.sort((a, b) => (ordem[(a.status_prazo || '').toLowerCase()] ?? 9) - (ordem[(b.status_prazo || '').toLowerCase()] ?? 9));
  } else {
    copy.sort((a, b) => (a.data_fim || '').localeCompare(b.data_fim || ''));
  }
  return copy;
}
function applyProjectFilters() {
  let list = state.allProjects;
  if (!state.mostrarConcluidos) {
    list = list.filter(p => {
      const s = (p.status_prazo || '').toLowerCase();
      return s !== 'concluído' && s !== 'concluido';
    });
  }
  if (state.activeFilter) list = list.filter(p => p.tarefas.some(t => t.area === state.activeFilter));
  if (state.gpFilter) list = list.filter(p => String(p.gp_id) === String(state.gpFilter));
  if (state.searchText) {
    const q = state.searchText.toLowerCase();
    list = list.filter(p =>
      (p.nome || '').toLowerCase().includes(q) ||
      (p.chamado || '').toLowerCase().includes(q) ||
      (p.cliente_nome || '').toLowerCase().includes(q)
    );
  }
  state.projects = sortProjects(list, state.sortBy);
  renderProjectList();
  renderStats();
  renderDependencyAlerts();
  updateNavBadge();
  atualizarBotaoMostrarConcluidos();
}
document.getElementById('search-projetos').addEventListener('input', (e) => {
  state.searchText = e.target.value.trim();
  applyProjectFilters();
});
document.getElementById('sort-projetos').addEventListener('change', (e) => {
  state.sortBy = e.target.value;
  applyProjectFilters();
});
function atualizarBotaoMostrarConcluidos() {
  const btn = document.getElementById('chk-mostrar-concluidos');
  btn.classList.toggle('selected', state.mostrarConcluidos);
  btn.setAttribute('aria-pressed', String(state.mostrarConcluidos));
  btn.textContent = state.mostrarConcluidos ? '☑ Mostrar concluídos' : '☐ Mostrar concluídos';

  const ocultosCount = state.allProjects.filter(p => {
    const s = (p.status_prazo || '').toLowerCase();
    return s === 'concluído' || s === 'concluido';
  }).length;
  const msg = document.getElementById('msg-oculto-concluidos');
  msg.textContent = (!state.mostrarConcluidos && ocultosCount > 0)
    ? `${ocultosCount} projeto${ocultosCount > 1 ? 's' : ''} concluído${ocultosCount > 1 ? 's' : ''} oculto${ocultosCount > 1 ? 's' : ''}.`
    : '';
}
document.getElementById('chk-mostrar-concluidos').addEventListener('click', () => {
  state.mostrarConcluidos = !state.mostrarConcluidos;
  applyProjectFilters();
});

// ---------- notificacao (badge na sidebar) ----------
function updateNavBadge() {
  const urgentes = state.allProjects.filter(p => {
    const s = (p.status_prazo || '').toLowerCase();
    return s === 'atrasado' || s === 'bloqueado';
  }).length;
  const badge = document.getElementById('nav-badge-projetos');
  if (urgentes > 0) {
    badge.textContent = urgentes;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ---------- alerta de dependencia entre areas (propaga em cadeia) ----------
function calcularAlertasDependencia(project) {
  const tarefas = project.tarefas
    .filter(t => t.inicio && t.fim)
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  const alerts = [];
  let bloqueioFim = null; // ate quando a cadeia de atraso empurra o inicio das proximas areas
  let origem = null; // area que originou o atraso da cadeia atual
  for (let i = 0; i < tarefas.length - 1; i++) {
    const atual = tarefas[i], proxima = tarefas[i + 1];
    if ((atual.status || '').toLowerCase() === 'atrasado') {
      bloqueioFim = atual.fim;
      origem = atual.area;
    }
    if (atual.area === proxima.area) continue;
    if (bloqueioFim && proxima.inicio < bloqueioFim) {
      alerts.push(`Atraso em ${origem} pode empurrar o início de ${proxima.area} (previsto para ${fmtDate(proxima.inicio)})`);
      // propaga a cadeia: a proxima area tambem passa a ser considerada atrasada
      bloqueioFim = proxima.fim > bloqueioFim ? proxima.fim : bloqueioFim;
    } else {
      bloqueioFim = null;
      origem = null;
    }
  }
  return alerts;
}
function renderDependencyAlerts() {
  const el = document.getElementById('alerta-dependencias');
  const comAlerta = state.allProjects.filter(p => calcularAlertasDependencia(p).length > 0);
  if (comAlerta.length === 0) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <div class="dependency-alert">
      <span class="dependency-alert-icon">⚠️</span>
      <span>${comAlerta.length} projeto(s) com risco de atraso em cadeia entre áreas — veja o aviso dentro do card de cada um.</span>
    </div>
  `;
}

// ---------- Areas admin ----------
function renderAreaList() {
  const el = document.getElementById('area-list');
  el.innerHTML = '';
  state.areas.forEach(nome => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<span>${nome}</span><button class="icon-btn" aria-label="Remover área">✕</button>`;
    row.querySelector('button').onclick = async () => {
      try {
        await api(`/areas/${encodeURIComponent(nome)}`, { method: 'DELETE' });
        await refreshAreas();
      } catch (err) {
        alert(err.message);
      }
    };
    el.appendChild(row);
  });
}
async function refreshAreas() {
  state.areas = await api('/areas');
  renderAreaList();
  renderAreaFilters();
  renderNewProjectAreaChips();
}
document.getElementById('form-area').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('area-nome');
  if (!input.value.trim()) return;
  try {
    await api('/areas', { method: 'POST', body: JSON.stringify({ nome: input.value.trim() }) });
    input.value = '';
    await refreshAreas();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Acoes admin ----------
function renderAcaoList() {
  const el = document.getElementById('acao-list');
  el.innerHTML = '';
  state.acoes.forEach(nome => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<span>${nome}</span><button class="icon-btn" aria-label="Remover ação">✕</button>`;
    row.querySelector('button').onclick = async () => {
      try {
        await api(`/acoes/${encodeURIComponent(nome)}`, { method: 'DELETE' });
        await refreshAcoes();
      } catch (err) {
        alert(err.message);
      }
    };
    el.appendChild(row);
  });
}
async function refreshAcoes() {
  state.acoes = await api('/acoes');
  renderAcaoList();
}
document.getElementById('form-acao').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('acao-nome');
  if (!input.value.trim()) return;
  try {
    await api('/acoes', { method: 'POST', body: JSON.stringify({ nome: input.value.trim() }) });
    input.value = '';
    await refreshAcoes();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Fases admin ----------
function renderFaseList() {
  const el = document.getElementById('fase-list');
  el.innerHTML = '';
  state.fases.forEach(nome => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<span>${nome}</span><button class="icon-btn" aria-label="Remover fase">✕</button>`;
    row.querySelector('button').onclick = async () => {
      try {
        await api(`/fases/${encodeURIComponent(nome)}`, { method: 'DELETE' });
        await refreshFases();
      } catch (err) {
        alert(err.message);
      }
    };
    el.appendChild(row);
  });
}
async function refreshFases() {
  state.fases = await api('/fases');
  renderFaseList();
  populateFaseSelect();
}
function populateFaseSelect() {
  const options = state.fases.map(f => `<option>${f}</option>`).join('');
  document.getElementById('np-fase').innerHTML = options;
  const editSel = document.getElementById('edit-fase');
  if (editSel) editSel.innerHTML = options;
}
document.getElementById('form-fase').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('fase-nome');
  if (!input.value.trim()) return;
  try {
    await api('/fases', { method: 'POST', body: JSON.stringify({ nome: input.value.trim() }) });
    input.value = '';
    await refreshFases();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Status da WBS admin ----------
function renderWbsStatusList() {
  const el = document.getElementById('wbs-status-list');
  el.innerHTML = '';
  state.wbsStatusList.forEach(nome => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<span>${nome}</span><button class="icon-btn" aria-label="Remover status">✕</button>`;
    row.querySelector('button').onclick = async () => {
      try {
        await api(`/wbs-status/${encodeURIComponent(nome)}`, { method: 'DELETE' });
        await refreshWbsStatusList();
      } catch (err) {
        alert(err.message);
      }
    };
    el.appendChild(row);
  });
}
async function refreshWbsStatusList() {
  state.wbsStatusList = await api('/wbs-status');
  renderWbsStatusList();
}
document.getElementById('form-wbs-status').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('wbs-status-nome');
  if (!input.value.trim()) return;
  try {
    await api('/wbs-status', { method: 'POST', body: JSON.stringify({ nome: input.value.trim() }) });
    input.value = '';
    await refreshWbsStatusList();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- stats ----------
function renderStats() {
  const total = state.projects.length;
  const atrasados = state.projects.filter(p => p.status_prazo === 'atrasado').length;
  const bloqueados = state.projects.filter(p => p.status_prazo === 'bloqueado').length;
  const pendentes = state.projects.filter(p => p.status_prazo === 'pendente').length;
  const el = document.getElementById('stats-grid');
  el.innerHTML = `
    <div class="stat-card"><p class="stat-label">Projetos ativos</p><p class="stat-value">${total}</p></div>
    <div class="stat-card"><p class="stat-label">Prazo atrasado</p><p class="stat-value" style="color:var(--danger)">${atrasados}</p></div>
    <div class="stat-card"><p class="stat-label">Bloqueados</p><p class="stat-value" style="color:var(--warning)">${bloqueados}</p></div>
    <div class="stat-card"><p class="stat-label">Sem datas definidas</p><p class="stat-value" style="color:var(--pending)">${pendentes}</p></div>
  `;
}

// ---------- area filters ----------
function renderAreaFilters() {
  const el = document.getElementById('area-filters');
  el.innerHTML = '';
  const label = document.createElement('span');
  label.style.cssText = 'font-size:12px;color:var(--text-muted);align-self:center;margin-right:2px;';
  label.textContent = 'Produto:';
  el.appendChild(label);
  const allChip = document.createElement('button');
  allChip.className = 'chip' + (state.activeFilter ? '' : ' selected');
  allChip.textContent = 'Todas';
  allChip.onclick = () => { state.activeFilter = null; renderAreaFilters(); applyProjectFilters(); };
  el.appendChild(allChip);
  state.areas.forEach(a => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.activeFilter === a ? ' selected' : '');
    chip.textContent = a;
    chip.onclick = () => { state.activeFilter = state.activeFilter === a ? null : a; renderAreaFilters(); applyProjectFilters(); };
    el.appendChild(chip);
  });
}

// ---------- gp filters ----------
function renderGpFilters() {
  const el = document.getElementById('gp-filters');
  el.innerHTML = '';
  const label = document.createElement('span');
  label.style.cssText = 'font-size:12px;color:var(--text-muted);align-self:center;margin-right:2px;';
  label.textContent = 'GP:';
  el.appendChild(label);
  const allChip = document.createElement('button');
  allChip.className = 'chip' + (state.gpFilter ? '' : ' selected');
  allChip.textContent = 'Todos';
  allChip.onclick = () => { state.gpFilter = null; renderGpFilters(); applyProjectFilters(); };
  el.appendChild(allChip);
  state.gps.forEach(gp => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (String(state.gpFilter) === String(gp.id) ? ' selected' : '');
    chip.textContent = gp.nome;
    chip.onclick = () => { state.gpFilter = String(state.gpFilter) === String(gp.id) ? null : gp.id; renderGpFilters(); applyProjectFilters(); };
    el.appendChild(chip);
  });
}

// ---------- project list ----------
function renderProjectList() {
  const el = document.getElementById('project-list');
  el.innerHTML = '';
  if (state.projects.length === 0) {
    el.innerHTML = '<p class="muted">Nenhum projeto encontrado.</p>';
    return;
  }
  state.projects.forEach(p => {
    const card = document.createElement('div');
    const statusAtencao = (p.status_prazo || '').toLowerCase();
    const cardAttentionClass = statusAtencao === 'atrasado' ? ' card-atrasado'
      : statusAtencao === 'bloqueado' ? ' card-bloqueado'
      : statusAtencao === 'pendente' ? ' card-pendente'
      : '';
    card.className = 'card' + cardAttentionClass;
    const areaTagsHtml = p.tarefas.map(t => `<span class="badge ${statusClass(t.status)}" title="${t.area}: ${t.status}">${t.area}</span>`).join(' ');
    const areasPendentes = p.tarefas.filter(t => !t.inicio || !t.fim);
    const areasPendentesHtml = areasPendentes.length > 0
      ? `<p class="card-sub" style="color:var(--pending);font-weight:600;margin-bottom:8px;">📌 ${areasPendentes.length} área(s) envolvida(s) aguardando definição de data de entrega: ${areasPendentes.map(t => t.area).join(', ')}</p>`
      : '';
    const open = state.expanded[p.id];
    const alertasDep = calcularAlertasDependencia(p);
    const alertaHtml = alertasDep.length > 0
      ? `<div class="dependency-alert" style="margin-bottom:10px;"><span class="dependency-alert-icon">⚠️</span><span>${alertasDep.join('<br>')}</span></div>`
      : '';
    const elapsed = elapsedPercent(p.data_inicio, p.data_fim);
    let diasAtraso = null;
    let diasAtrasoTexto = '';
    if (statusAtencao === 'atrasado' && p.data_fim) {
      // ainda em andamento - conta "ao vivo" contra hoje
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const fim = new Date(p.data_fim + 'T00:00:00');
      const diff = Math.floor((hoje - fim) / (1000 * 60 * 60 * 24));
      if (diff > 0) { diasAtraso = diff; diasAtrasoTexto = `${diff} dia${diff > 1 ? 's' : ''} de atraso`; }
    } else if ((statusAtencao === 'concluído' || statusAtencao === 'concluido') && p.data_fim && p.concluido_em) {
      // ja concluido - "congela" usando a data em que foi marcado concluido, nao hoje,
      // pra servir de registro historico de quanto atraso teve na entrega
      const concluidoEm = new Date(p.concluido_em);
      concluidoEm.setHours(0, 0, 0, 0);
      const fim = new Date(p.data_fim + 'T00:00:00');
      const diff = Math.floor((concluidoEm - fim) / (1000 * 60 * 60 * 24));
      if (diff > 0) { diasAtraso = diff; diasAtrasoTexto = `Entregue com ${diff} dia${diff > 1 ? 's' : ''} de atraso`; }
    }
    const prazoGeralHtml = elapsed === null
      ? `<p class="card-sub" style="color:var(--pending);font-weight:600;">📌 Datas do projeto ainda não definidas</p>`
      : `
        <div class="card-sub" style="display:flex;justify-content:space-between;">
          <span>Prazo geral: ${fmtDate(p.data_inicio)} → ${fmtDate(p.data_fim)}</span>
          <span>${elapsed}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${barWidth(elapsed)}%;background:${progressColor(elapsed)}"></div></div>
      `;
    card.innerHTML = `
      <div class="card-head">
        <div>
          <p class="card-title">${p.nome}${p.chamado ? ' <span style="color:var(--text-muted);font-weight:400;">· Chamado ' + p.chamado + '</span>' : ''}</p>
          <p class="card-sub">GP: ${p.gerente_nome || '-'}${p.cliente_nome ? ' · Cliente: ' + p.cliente_nome : ''} · ${p.tipo} · fase: ${p.fase}</p>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
          <span class="badge ${statusClass(p.status_prazo)}">prazo: ${p.status_prazo}</span>
          ${diasAtraso ? `<span class="dias-atraso-tag">${diasAtrasoTexto}</span>` : ''}
          <button class="icon-btn" data-edit-project aria-label="Editar projeto">✎</button>
          <button class="icon-btn" data-delete-project aria-label="Excluir projeto">🗑</button>
          <button class="icon-btn" data-notify-teams aria-label="Notificar no Teams">📣</button>
          ${p.saude_implantacao ? `<span class="badge badge-saude-${p.saude_implantacao}" title="${SAUDE_IMPLANTACAO_DESCRICAO[p.saude_implantacao]}">Checklist: ${SAUDE_IMPLANTACAO_LABEL[p.saude_implantacao]}</span>` : ''}
          <button class="btn${p.wbs_total_itens > 0 ? ' wbs-btn-has-items' : ''}" data-open-wbs style="font-size:12px;padding:6px 10px;" title="${p.wbs_total_itens > 0 ? p.wbs_total_itens + ' item(ns) cadastrados na WBS' : 'Nenhum item de WBS ainda'}">WBS</button>
        </div>
      </div>
      ${alertaHtml}
      <p class="card-resumo">${p.resumo || ''}</p>
      <div class="chip-row" style="margin-bottom:8px;">${areaTagsHtml}</div>
      ${areasPendentesHtml}
      ${prazoGeralHtml}
      <div class="toggle-row">
        <button class="toggle-btn" data-toggle="tarefas">${open === 'tarefas' ? 'Ocultar prazos por área' : 'Prazos por área'}</button>
        <button class="toggle-btn" data-toggle="historico">${open === 'historico' ? 'Ocultar histórico' : 'Histórico (' + p.historico.length + ')'}</button>
        <button class="toggle-btn" data-toggle="links">${open === 'links' ? 'Ocultar links' : 'Links (' + (p.links ? p.links.length : 0) + ')'}</button>
      </div>
      <div class="detail-block" data-detail="tarefas" style="display:${open === 'tarefas' ? 'flex' : 'none'}"></div>
      <div class="detail-block" data-detail="historico" style="display:${open === 'historico' ? 'flex' : 'none'}"></div>
      <div class="detail-block" data-detail="links" style="display:${open === 'links' ? 'flex' : 'none'}"></div>
    `;

    // ----- tarefas por area -----
    const tarefasHost = card.querySelector('[data-detail="tarefas"]');
    p.tarefas.forEach(t => {
      const row = document.createElement('div');
      row.className = 'detail-row';
      const temDatas = t.inicio && t.fim;
      row.innerHTML = `
        <span class="area-tag">${t.area}</span>
        <span data-view-dates>${temDatas ? fmtDate(t.inicio) + ' → ' + fmtDate(t.fim) : '📌 Datas pendentes'}</span>
        <span class="badge ${statusClass(t.status)}">${t.status}</span>
        <div style="display:flex;gap:4px;">
          <button class="icon-btn" data-edit-task aria-label="Editar tarefa">✎</button>
          <button class="icon-btn" data-delete-task aria-label="Remover tarefa">✕</button>
        </div>
      `;
      tarefasHost.appendChild(row);
      if (temDatas) {
        const barInfo = taskBarInfo(t);
        const bar = document.createElement('div');
        bar.style.cssText = 'height:4px;background:#ebeae4;border-radius:3px;overflow:hidden;margin:2px 0 4px;';
        bar.innerHTML = `<div style="height:100%;width:${barWidth(barInfo.percent)}%;background:${barInfo.color}"></div>`;
        tarefasHost.appendChild(bar);
      }

      row.querySelector('[data-edit-task]').onclick = () => {
        const doEdit = () => {
          row.innerHTML = `
            <input type="date" value="${t.inicio || ''}" data-edit-inicio style="width:135px;" />
            <input type="date" value="${t.fim || ''}" data-edit-fim style="width:135px;" />
            <select data-edit-status style="width:150px;">
              ${['planejamento', 'em andamento', 'atrasado', 'bloqueado', 'concluído'].map(s => `<option value="${s}" ${s === t.status ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
            <div style="display:flex;gap:4px;">
              <button class="btn" data-save-task>Salvar</button>
              <button class="btn" data-cancel-task>Cancelar</button>
            </div>
          `;
          row.querySelector('[data-save-task]').onclick = async () => {
            const inicio = row.querySelector('[data-edit-inicio]').value;
            const fim = row.querySelector('[data-edit-fim]').value;
            const status = row.querySelector('[data-edit-status]').value;
            try {
              await api(`/projects/${p.id}/tarefas/${t.id}`, { method: 'PUT', body: JSON.stringify({ area: t.area, inicio, fim, status }) });
              state.expanded[p.id] = 'tarefas';
              await refreshProjects();
            } catch (err) {
              alert(err.message);
            }
          };
          row.querySelector('[data-cancel-task]').onclick = () => renderProjectList();
        };
        if (state.settings.restringir_edicao_prazos && !state.isAdmin) return requestAdminLogin(doEdit);
        doEdit();
      };

      row.querySelector('[data-delete-task]').onclick = () => {
        const doDelete = async () => {
          if (!confirm(`Remover a tarefa da área "${t.area}" deste projeto?`)) return;
          try {
            await api(`/projects/${p.id}/tarefas/${t.id}`, { method: 'DELETE' });
            state.expanded[p.id] = 'tarefas';
            await refreshProjects();
          } catch (err) {
            alert(err.message);
          }
        };
        if (state.settings.restringir_edicao_prazos && !state.isAdmin) return requestAdminLogin(doDelete);
        doDelete();
      };
    });

    const addTaskRow = document.createElement('div');
    addTaskRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:8px;';
    addTaskRow.innerHTML = `
      <select data-new-task-area style="min-width:140px;">${state.areas.map(a => `<option value="${a}">${a}</option>`).join('')}</select>
      <input type="date" data-new-task-inicio style="width:135px;" />
      <input type="date" data-new-task-fim style="width:135px;" />
      <button class="btn" data-add-task>+ Área ao projeto</button>
    `;
    tarefasHost.appendChild(addTaskRow);
    addTaskRow.querySelector('[data-add-task]').onclick = () => {
      const doAdd = async () => {
        const area = addTaskRow.querySelector('[data-new-task-area]').value;
        const inicio = addTaskRow.querySelector('[data-new-task-inicio]').value || null;
        const fim = addTaskRow.querySelector('[data-new-task-fim]').value || null;
        try {
          await api(`/projects/${p.id}/tarefas`, { method: 'POST', body: JSON.stringify({ area, inicio, fim, status: 'planejamento' }) });
          state.expanded[p.id] = 'tarefas';
          await refreshProjects();
        } catch (err) {
          alert(err.message);
        }
      };
      if (state.settings.restringir_edicao_prazos && !state.isAdmin) return requestAdminLogin(doAdd);
      doAdd();
    };

    // ----- historico -----
    const histHost = card.querySelector('[data-detail="historico"]');
    function renderHistRow(h) {
      const row = document.createElement('div');
      row.className = 'hist-row';
      row.innerHTML = `
        <span class="hist-date">${fmtDateFull(h.data)}</span> — <span class="hist-texto">${h.texto}</span>
        <span class="hist-acoes">
          <button class="icon-btn" data-editar-hist aria-label="Editar registro do histórico">✎</button>
          <button class="icon-btn" data-excluir-hist aria-label="Excluir registro do histórico">🗑</button>
        </span>
      `;
      row.querySelector('[data-editar-hist]').onclick = () => {
        row.innerHTML = `
          <input type="text" class="hist-edit-input" value="${h.texto.replace(/"/g, '&quot;')}" />
          <button class="btn" data-salvar-hist>Salvar</button>
          <button class="btn" data-cancelar-hist>Cancelar</button>
        `;
        const inputEdit = row.querySelector('.hist-edit-input');
        inputEdit.focus();
        row.querySelector('[data-salvar-hist]').onclick = async () => {
          if (!inputEdit.value.trim()) return;
          try {
            await api(`/projects/${p.id}/historico/${h.id}`, { method: 'PATCH', body: JSON.stringify({ texto: inputEdit.value.trim() }) });
            state.expanded[p.id] = 'historico';
            await refreshProjects();
          } catch (err) {
            alert('Não foi possível salvar: ' + err.message);
          }
        };
        row.querySelector('[data-cancelar-hist]').onclick = () => {
          row.replaceWith(renderHistRow(h));
        };
      };
      row.querySelector('[data-excluir-hist]').onclick = async () => {
        if (!confirm('Excluir esse registro de histórico?')) return;
        try {
          await api(`/projects/${p.id}/historico/${h.id}`, { method: 'DELETE' });
          state.expanded[p.id] = 'historico';
          await refreshProjects();
        } catch (err) {
          alert('Não foi possível excluir: ' + err.message);
        }
      };
      return row;
    }
    p.historico.forEach(h => {
      histHost.appendChild(renderHistRow(h));
    });
    const addRow = document.createElement('div');
    addRow.className = 'hist-add';
    addRow.innerHTML = `<input type="text" placeholder="Nova atualização de histórico..." /><button class="btn">Adicionar</button>`;
    const input = addRow.querySelector('input');
    addRow.querySelector('button').onclick = async () => {
      if (!input.value.trim()) return;
      await api(`/projects/${p.id}/historico`, { method: 'POST', body: JSON.stringify({ texto: input.value.trim() }) });
      state.expanded[p.id] = 'historico';
      await refreshProjects();
    };
    histHost.appendChild(addRow);

    // ----- links -----
    const linksHost = card.querySelector('[data-detail="links"]');
    (p.links || []).forEach(link => {
      const row = document.createElement('div');
      row.className = 'hist-row';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.innerHTML = `
        <a href="${link.url}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);font-weight:600;text-decoration:none;">🔗 ${link.titulo}</a>
        <button class="icon-btn" aria-label="Remover link">✕</button>
      `;
      row.querySelector('button').onclick = async () => {
        if (!confirm(`Remover o link "${link.titulo}"?`)) return;
        try {
          await api(`/projects/${p.id}/links/${link.id}`, { method: 'DELETE' });
          state.expanded[p.id] = 'links';
          await refreshProjects();
        } catch (err) {
          alert(err.message);
        }
      };
      linksHost.appendChild(row);
    });
    const addLinkRow = document.createElement('div');
    addLinkRow.className = 'hist-add';
    addLinkRow.innerHTML = `
      <input type="text" placeholder="Título (ex: Especificação)" style="max-width:180px;" data-link-titulo />
      <input type="text" placeholder="https://..." data-link-url />
      <button class="btn">Adicionar</button>
    `;
    addLinkRow.querySelector('button').onclick = async () => {
      const titulo = addLinkRow.querySelector('[data-link-titulo]').value.trim();
      const url = addLinkRow.querySelector('[data-link-url]').value.trim();
      if (!url) { alert('Informe a URL do link.'); return; }
      try {
        await api(`/projects/${p.id}/links`, { method: 'POST', body: JSON.stringify({ titulo, url }) });
        state.expanded[p.id] = 'links';
        await refreshProjects();
      } catch (err) {
        alert(err.message);
      }
    };
    linksHost.appendChild(addLinkRow);

    // ----- toggles -----
    card.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.onclick = () => {
        const which = btn.dataset.toggle;
        state.expanded[p.id] = state.expanded[p.id] === which ? null : which;
        renderProjectList();
      };
    });
    card.querySelector('[data-edit-project]').onclick = () => {
      if (state.settings.restringir_edicao_prazos && !state.isAdmin) {
        return requestAdminLogin(() => openEditModal(p));
      }
      openEditModal(p);
    };
    card.querySelector('[data-delete-project]').onclick = () => {
      const doDelete = async () => {
        if (!confirm(`Excluir o projeto "${p.nome}"? Essa ação não pode ser desfeita.`)) return;
        try {
          await api(`/projects/${p.id}`, { method: 'DELETE' });
          await refreshProjects();
        } catch (err) {
          alert(err.message);
        }
      };
      if (state.settings.restringir_exclusao && !state.isAdmin) {
        return requestAdminLogin(doDelete);
      }
      doDelete();
    };
    card.querySelector('[data-notify-teams]').onclick = async (e) => {
      const btn = e.currentTarget;
      const textoOriginal = btn.textContent;
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await api(`/projects/${p.id}/notificar-teams`, { method: 'POST' });
        alert(`Notificação de "${p.nome}" enviada para o Teams.`);
      } catch (err) {
        alert('Erro ao notificar no Teams: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = textoOriginal;
      }
    };
    card.querySelector('[data-open-wbs]').onclick = () => openWbsView(p);
    el.appendChild(card);
  });
}

// ---------- Clientes admin ----------
function renderClienteList() {
  const el = document.getElementById('cliente-list');
  el.innerHTML = '';
  state.clientes.forEach(c => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<span>${c.nome}</span><button class="icon-btn" aria-label="Remover cliente">✕</button>`;
    row.querySelector('button').onclick = async () => {
      try {
        await api(`/clientes/${c.id}`, { method: 'DELETE' });
        await refreshClientes();
      } catch (err) {
        alert(err.message);
      }
    };
    el.appendChild(row);
  });
}
async function refreshClientes() {
  state.clientes = await api('/clientes');
  renderClienteList();
  populateClienteSelect();
}
function populateClienteSelect() {
  const options = '<option value="">Sem cliente definido</option>' +
    state.clientes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
  document.getElementById('np-cliente').innerHTML = options;
  const editSel = document.getElementById('edit-cliente');
  if (editSel) editSel.innerHTML = options;
}
document.getElementById('form-cliente').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('cliente-nome');
  if (!input.value.trim()) return;
  try {
    await api('/clientes', { method: 'POST', body: JSON.stringify({ nome: input.value.trim() }) });
    input.value = '';
    await refreshClientes();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- GP admin ----------
function renderGpList() {
  const el = document.getElementById('gp-list');
  el.innerHTML = '';
  state.gps.forEach(gp => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="list-row-main">
        <p class="list-row-name">${gp.nome}</p>
        <p class="list-row-sub">${gp.email}</p>
      </div>
      <button class="icon-btn" aria-label="Remover GP">✕</button>
    `;
    row.querySelector('.icon-btn').onclick = async () => {
      await api(`/gps/${gp.id}`, { method: 'DELETE' });
      await refreshGpsAndProjects();
    };
    el.appendChild(row);
  });
}
document.getElementById('form-gp').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('gp-nome').value.trim();
  const email = document.getElementById('gp-email').value.trim();
  if (!nome || !email) {
    alert('Preencha nome e e-mail.');
    return;
  }
  try {
    await api('/gps', { method: 'POST', body: JSON.stringify({ nome, email }) });
    document.getElementById('gp-nome').value = '';
    document.getElementById('gp-email').value = '';
    await refreshGpsAndProjects();
  } catch (err) {
    alert(err.message);
  }
});
async function refreshGpsAndProjects() {
  state.gps = await api('/gps');
  await refreshProjects();
  renderGpList();
  renderGpFilters();
  populateGpSelect();
}

// ---------- Admin emails ----------
function renderAdminList() {
  const el = document.getElementById('admin-list');
  el.innerHTML = '';
  state.adminEmails.forEach(a => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<span>${a.email}</span><button class="icon-btn" aria-label="Remover">✕</button>`;
    row.querySelector('button').onclick = async () => {
      await api(`/admin-emails/${a.id}`, { method: 'DELETE' });
      state.adminEmails = await api('/admin-emails');
      renderAdminList();
    };
    el.appendChild(row);
  });
}
document.getElementById('form-admin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const emailInput = document.getElementById('admin-email');
  if (!emailInput.value.trim()) return;
  try {
    await api('/admin-emails', { method: 'POST', body: JSON.stringify({ email: emailInput.value.trim() }) });
    emailInput.value = '';
    state.adminEmails = await api('/admin-emails');
    renderAdminList();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Email config ----------
function popularSelectHoras() {
  const sel = document.getElementById('cfg-hora');
  if (sel.options.length > 0) return; // ja populado
  for (let h = 0; h < 24; h++) {
    const opt = document.createElement('option');
    opt.value = h;
    opt.textContent = `${String(h).padStart(2, '0')}:00`;
    sel.appendChild(opt);
  }
}
function renderEmailConfig() {
  popularSelectHoras();
  const c = state.emailConfig;
  document.getElementById('cfg-frequencia').value = c.frequencia;
  document.getElementById('cfg-dia-semana').value = c.dia_semana;
  document.getElementById('cfg-hora').value = c.hora ?? 8;
  document.getElementById('cfg-enviar-gps').checked = !!c.enviar_gps;
  document.getElementById('cfg-enviar-admins').checked = !!c.enviar_admins;
  document.getElementById('cfg-enviar-teams').checked = !!c.enviar_teams;
}
document.getElementById('form-email-config').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    frequencia: document.getElementById('cfg-frequencia').value,
    dia_semana: Number(document.getElementById('cfg-dia-semana').value),
    hora: Number(document.getElementById('cfg-hora').value),
    enviar_gps: document.getElementById('cfg-enviar-gps').checked,
    enviar_admins: document.getElementById('cfg-enviar-admins').checked,
    enviar_teams: document.getElementById('cfg-enviar-teams').checked,
  };
  await api('/email-config', { method: 'PUT', body: JSON.stringify(body) });
  const status = document.getElementById('email-status');
  status.textContent = 'Configuração salva.';
  status.classList.remove('hidden');
  setTimeout(() => status.classList.add('hidden'), 3000);
});
document.getElementById('btn-send-now').addEventListener('click', async () => {
  const status = document.getElementById('email-status');
  status.style.color = '';
  status.textContent = 'Enviando...';
  status.classList.remove('hidden');
  try {
    const result = await api('/email-config/enviar-agora', { method: 'POST' });
    const partes = [];
    if (result.emailErro) {
      partes.push('Erro no e-mail: ' + result.emailErro);
    } else {
      partes.push(result.enviados.length
        ? `E-mails enviados para: ${result.enviados.join(', ')}`
        : 'Nenhum e-mail enviado (nenhum destinatário com projetos).');
    }
    if (result.teams) partes.push(`Teams: ${result.teams}`);
    status.textContent = partes.join(' · ');
    if (result.emailErro) status.style.color = 'var(--danger)';
  } catch (err) {
    status.textContent = 'Erro ao enviar: ' + err.message;
    status.style.color = 'var(--danger)';
  }
});


// ---------- Permissoes ----------
function renderPermissoes() {
  document.getElementById('perm-exclusao').checked = !!state.settings.restringir_exclusao;
  document.getElementById('perm-prazos').checked = !!state.settings.restringir_edicao_prazos;
}
document.getElementById('form-permissoes').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    restringir_exclusao: document.getElementById('perm-exclusao').checked,
    restringir_edicao_prazos: document.getElementById('perm-prazos').checked,
  };
  try {
    await api('/settings', { method: 'PUT', body: JSON.stringify(body) });
    state.settings = body;
    const status = document.getElementById('perm-status');
    status.textContent = 'Permissões salvas.';
    status.classList.remove('hidden');
    setTimeout(() => status.classList.add('hidden'), 3000);
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Historico de alteracoes (auditoria) ----------
async function renderAuditLog() {
  const host = document.getElementById('audit-log-list');
  const apenasDatas = document.getElementById('audit-apenas-datas').checked;
  let entries;
  try {
    entries = await api('/audit-log' + (apenasDatas ? '?apenas_datas=true' : ''));
  } catch (err) {
    host.innerHTML = `<p class="muted">${err.message}</p>`;
    return;
  }
  if (entries.length === 0) {
    host.innerHTML = '<p class="muted">Nenhum registro ainda.</p>';
    return;
  }
  const acaoLabel = { criado: 'criou', editado: 'editou', excluido: 'excluiu' };
  host.innerHTML = entries.map(e => `
    <div class="hist-row${e.envolve_data ? ' envolve-data' : ''}">
      <span class="hist-date">${new Date(e.criado_em).toLocaleString('pt-BR')}</span> —
      <strong>${e.autor || 'anônimo'}</strong> ${acaoLabel[e.acao] || e.acao} ${e.entidade}${e.projeto_nome ? ' em "' + e.projeto_nome + '"' : ''}
      ${e.detalhes ? `<p class="audit-detalhes">${e.detalhes}</p>` : ''}
    </div>
  `).join('');
}
document.getElementById('audit-apenas-datas').addEventListener('change', renderAuditLog);

// ---------- Usuarios admin ----------
async function refreshUsuarios() {
  const host = document.getElementById('usuarios-list');
  try {
    state.usuariosCache = await api('/usuarios');
  } catch (err) {
    host.innerHTML = `<p class="muted">${err.message}</p>`;
    return;
  }
  renderUsuariosListFiltrada();
}

function renderUsuariosListFiltrada() {
  const host = document.getElementById('usuarios-list');
  const todos = state.usuariosCache || [];
  if (todos.length === 0) {
    host.innerHTML = '<p class="muted">Nenhum usuário cadastrado ainda.</p>';
    return;
  }

  const buscaTexto = (state.usuariosBusca || '').trim().toLowerCase();
  const filtroAtivo = state.usuariosFiltroAtivo || 'todos';
  const usuarios = todos.filter(u => {
    if (buscaTexto && !u.nome.toLowerCase().includes(buscaTexto) && !u.email.toLowerCase().includes(buscaTexto)) return false;
    if (filtroAtivo !== 'todos' && !u[filtroAtivo]) return false;
    return true;
  });

  if (usuarios.length === 0) {
    host.innerHTML = '<p class="muted">Nenhum usuário encontrado com esse filtro.</p>';
    return;
  }
  host.innerHTML = '';
  usuarios.forEach(u => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="list-row-main">
        <p class="list-row-name">${u.nome}${!u.ativo ? ' <span style="color:var(--danger);font-weight:400;">(inativo)</span>' : ''}</p>
        <p class="list-row-sub">${u.email} · ${u.senha_definida ? 'senha definida' : '⏳ aguardando definir senha'}</p>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px;font-size:12.5px;color:var(--text-muted);align-items:center;">
          <label style="display:flex;align-items:center;gap:5px;"><input type="checkbox" data-permissao="pode_projetos" style="width:auto;" ${u.pode_projetos ? 'checked' : ''}/> Projetos</label>
          <label style="display:flex;align-items:center;gap:5px;"><input type="checkbox" data-permissao="pode_implantacao" style="width:auto;" ${u.pode_implantacao ? 'checked' : ''}/> Implantação</label>
          <label style="display:flex;align-items:center;gap:5px;"><input type="checkbox" data-permissao="pode_equipe" style="width:auto;" ${u.pode_equipe ? 'checked' : ''}/> Equipe</label>
          <label style="display:flex;align-items:center;gap:5px;"><input type="checkbox" data-permissao="pode_chamados" style="width:auto;" ${u.pode_chamados ? 'checked' : ''}/> Chamados</label>
          <label style="display:flex;align-items:center;gap:5px;"><input type="checkbox" data-permissao="pode_admin" style="width:auto;" ${u.pode_admin ? 'checked' : ''}/> Admin</label>
          <span style="color:var(--border);">|</span>
          <label style="display:flex;align-items:center;gap:5px;" title="Papel (não é acesso ao sistema)"><input type="checkbox" data-permissao="eh_gp" style="width:auto;" ${u.eh_gp ? 'checked' : ''}/> É GP</label>
          <label style="display:flex;align-items:center;gap:5px;" title="Papel (não é acesso ao sistema)"><input type="checkbox" data-permissao="eh_implantador" style="width:auto;" ${u.eh_implantador ? 'checked' : ''}/> É Implantador</label>
          <span class="permissao-status" style="font-size:11.5px;opacity:0;transition:opacity 0.2s;">✓ Salvo</span>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${!u.senha_definida ? '<button class="btn" data-reenviar>Reenviar convite</button>' : ''}
        <button class="btn" data-definir-senha>${u.senha_definida ? 'Redefinir senha' : 'Definir senha agora'}</button>
        <button class="btn" data-alternar-ativo>${u.ativo ? 'Desativar' : 'Reativar'}</button>
        <button class="icon-btn" data-excluir-usuario aria-label="Excluir usuário">✕</button>
      </div>
    `;
    const statusEl = row.querySelector('.permissao-status');
    row.querySelectorAll('[data-permissao]').forEach(chk => {
      chk.onchange = async () => {
        try {
          await api(`/usuarios/${u.id}`, { method: 'PATCH', body: JSON.stringify({ [chk.dataset.permissao]: chk.checked }) });
          statusEl.style.color = 'var(--success)';
          statusEl.textContent = '✓ Salvo';
          statusEl.style.opacity = '1';
          setTimeout(() => { statusEl.style.opacity = '0'; }, 1800);
        } catch (err) {
          statusEl.style.color = 'var(--danger)';
          statusEl.textContent = '✕ Falhou ao salvar';
          statusEl.style.opacity = '1';
          alert(err.message);
          chk.checked = !chk.checked;
        }
      };
    });
    if (!u.senha_definida) {
      row.querySelector('[data-reenviar]').onclick = async () => {
        try {
          await api(`/usuarios/${u.id}/reenviar-convite`, { method: 'POST' });
          alert(`Convite reenviado para ${u.email}.`);
        } catch (err) {
          alert(err.message);
        }
      };
    }
    row.querySelector('[data-definir-senha]').onclick = async () => {
      const novaSenha = prompt(`Nova senha para ${u.nome} (mínimo 6 caracteres):`);
      if (!novaSenha) return;
      if (novaSenha.length < 6) {
        alert('A senha precisa ter pelo menos 6 caracteres.');
        return;
      }
      try {
        await api(`/usuarios/${u.id}/senha`, { method: 'PATCH', body: JSON.stringify({ senha: novaSenha }) });
        alert(`Senha de ${u.nome} definida. Avise a pessoa por fora (WhatsApp, pessoalmente, etc.).`);
        await refreshUsuarios();
      } catch (err) {
        alert(err.message);
      }
    };
    row.querySelector('[data-alternar-ativo]').onclick = async () => {
      try {
        await api(`/usuarios/${u.id}`, { method: 'PATCH', body: JSON.stringify({ ativo: !u.ativo }) });
        await refreshUsuarios();
      } catch (err) {
        alert(err.message);
      }
    };
    row.querySelector('[data-excluir-usuario]').onclick = async () => {
      if (!confirm(`Excluir o usuário "${u.nome}"? Essa ação não pode ser desfeita.`)) return;
      try {
        await api(`/usuarios/${u.id}`, { method: 'DELETE' });
        await refreshUsuarios();
      } catch (err) {
        alert(err.message);
      }
    };
    host.appendChild(row);
  });
}

document.getElementById('usuarios-busca').addEventListener('input', (e) => {
  state.usuariosBusca = e.target.value;
  renderUsuariosListFiltrada();
});
document.getElementById('usuarios-filtros').addEventListener('click', (e) => {
  const chip = e.target.closest('[data-filtro-usuario]');
  if (!chip) return;
  state.usuariosFiltroAtivo = chip.dataset.filtroUsuario;
  document.querySelectorAll('#usuarios-filtros [data-filtro-usuario]').forEach(c => c.classList.toggle('selected', c === chip));
  renderUsuariosListFiltrada();
});

document.getElementById('form-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('usuario-nome').value.trim();
  const email = document.getElementById('usuario-email').value.trim();
  const senha = document.getElementById('usuario-senha').value;
  const pode_projetos = document.getElementById('usuario-pode-projetos').checked;
  const pode_implantacao = document.getElementById('usuario-pode-implantacao').checked;
  const pode_equipe = document.getElementById('usuario-pode-equipe').checked;
  const pode_chamados = document.getElementById('usuario-pode-chamados').checked;
  const pode_admin = document.getElementById('usuario-pode-admin').checked;
  const eh_gp = document.getElementById('usuario-eh-gp').checked;
  const eh_implantador = document.getElementById('usuario-eh-implantador').checked;
  if (!nome || !email) return;
  if (senha && senha.length < 6) {
    alert('A senha precisa ter pelo menos 6 caracteres (ou deixe em branco pra convidar por e-mail).');
    return;
  }
  try {
    const body = { nome, email, pode_projetos, pode_implantacao, pode_equipe, pode_chamados, pode_admin, eh_gp, eh_implantador };
    if (senha) body.senha = senha;
    const resultado = await api('/usuarios', { method: 'POST', body: JSON.stringify(body) });
    e.target.reset();
    if (resultado.senhaDefinidaDireto) {
      alert(`Usuário "${nome}" cadastrado com a senha que você definiu. Já pode avisar a pessoa e ela entra direto.`);
    } else if (resultado.emailEnviado) {
      alert(`Usuário "${nome}" cadastrado. Um e-mail foi enviado para ${email} com o link para definir a senha.`);
    } else {
      alert(`Usuário "${nome}" foi cadastrado, mas o e-mail NÃO pôde ser enviado (motivo: ${resultado.emailErro}). Use o botão "Definir senha agora" ou "Reenviar convite" na lista.`);
    }
    await refreshUsuarios();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- dashboard ----------
function buildDonutSvg(segments) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const size = 148, stroke = 20, radius = (size / 2) - stroke / 2;
  const circumference = 2 * Math.PI * radius;
  let offsetAccum = 0;
  const circles = segments.filter(s => s.value > 0).map(seg => {
    const fraction = seg.value / total;
    const dash = fraction * circumference;
    const gap = circumference - dash;
    const circle = `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${seg.color}" stroke-width="${stroke}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${-offsetAccum}" transform="rotate(-90 ${size / 2} ${size / 2})" />`;
    offsetAccum += dash;
    return circle;
  }).join('');
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="var(--surface-alt)" stroke-width="${stroke}" />
      ${circles}
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" font-size="24" font-weight="700" fill="var(--text)">${total}</text>
    </svg>
  `;
}

function statusColorHex(status) {
  const s = (status || '').toLowerCase();
  if (s === 'atrasado') return 'var(--danger)';
  if (s === 'bloqueado') return 'var(--warning)';
  if (s === 'não iniciado') return '#9AA6B8';
  if (s === 'concluído' || s === 'concluido') return 'var(--success)';
  return 'var(--brand-blue)';
}

function renderGanttChart(projects) {
  const host = document.getElementById('dash-gantt');
  const comDatas = projects.filter(p => p.data_inicio && p.data_fim);
  if (comDatas.length === 0) {
    host.innerHTML = '<p class="muted">Nenhum projeto com datas cadastradas.</p>';
    return;
  }
  const limitados = [...comDatas].sort((a, b) => (a.data_fim || '').localeCompare(b.data_fim || '')).slice(0, 15);
  const inicios = limitados.map(p => new Date(p.data_inicio + 'T00:00:00').getTime());
  const fins = limitados.map(p => new Date(p.data_fim + 'T00:00:00').getTime());
  const minDate = Math.min(...inicios);
  const maxDate = Math.max(...fins);
  const span = Math.max(maxDate - minDate, 1);
  const hoje = Date.now();
  const hojePercent = Math.min(100, Math.max(0, ((hoje - minDate) / span) * 100));

  const rows = limitados.map(p => {
    const start = new Date(p.data_inicio + 'T00:00:00').getTime();
    const end = new Date(p.data_fim + 'T00:00:00').getTime();
    const left = ((start - minDate) / span) * 100;
    const width = Math.max(((end - start) / span) * 100, 1.5);
    return `
      <div class="gantt-row">
        <span class="gantt-label" title="${p.nome}">${p.nome}</span>
        <div class="gantt-track">
          <div class="gantt-bar" style="left:${left}%;width:${width}%;background:${statusColorHex(p.status_prazo)}"></div>
          ${hojePercent >= 0 && hojePercent <= 100 ? `<div class="gantt-today-line" style="left:${hojePercent}%"></div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  host.innerHTML = `
    ${rows}
    <div class="gantt-axis"><span>${fmtDate(new Date(minDate).toISOString().slice(0, 10))}</span><span>hoje</span><span>${fmtDate(new Date(maxDate).toISOString().slice(0, 10))}</span></div>
  `;
}

// ---------- calendario de entregas ----------
function renderCalendarAreaFilters() {
  const el = document.getElementById('cal-area-filters');
  el.innerHTML = '';
  const allChip = document.createElement('button');
  allChip.className = 'chip' + (state.calendarAreaFilter ? '' : ' selected');
  allChip.textContent = 'Todas as áreas';
  allChip.onclick = () => { state.calendarAreaFilter = null; renderCalendarAreaFilters(); renderCalendar(); };
  el.appendChild(allChip);
  state.areas.forEach(a => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.calendarAreaFilter === a ? ' selected' : '');
    chip.textContent = a;
    chip.onclick = () => { state.calendarAreaFilter = state.calendarAreaFilter === a ? null : a; renderCalendarAreaFilters(); renderCalendar(); };
    el.appendChild(chip);
  });
}

function renderCalendar(targetGridId = 'cal-grid', targetLabelId = 'cal-label') {
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  document.getElementById(targetLabelId).textContent = `${monthNames[state.calendarMonth]} ${state.calendarYear}`;

  const diasMap = {};
  state.calendarProjects.forEach(p => {
    p.tarefas.forEach(t => {
      if (!t.fim) return;
      if (state.calendarAreaFilter && t.area !== state.calendarAreaFilter) return;
      const d = new Date(t.fim + 'T00:00:00');
      if (d.getMonth() === state.calendarMonth && d.getFullYear() === state.calendarYear) {
        const dia = d.getDate();
        if (!diasMap[dia]) diasMap[dia] = [];
        diasMap[dia].push({ area: t.area, nome: p.nome, chamado: p.chamado, status: t.status, cliente_nome: p.cliente_nome, gerente_nome: p.gerente_nome });
      }
    });
  });

  const primeiroDiaSemana = new Date(state.calendarYear, state.calendarMonth, 1).getDay();
  const diasNoMes = new Date(state.calendarYear, state.calendarMonth + 1, 0).getDate();
  const hoje = new Date();
  const ehMesAtual = hoje.getMonth() === state.calendarMonth && hoje.getFullYear() === state.calendarYear;
  const dows = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  let html = dows.map(d => `<div class="calendar-dow">${d}</div>`).join('');
  for (let i = 0; i < primeiroDiaSemana; i++) {
    html += `<div class="calendar-day outside"></div>`;
  }
  for (let dia = 1; dia <= diasNoMes; dia++) {
    const itens = diasMap[dia] || [];
    const isHoje = ehMesAtual && hoje.getDate() === dia;
    const diaSemana = new Date(state.calendarYear, state.calendarMonth, dia).getDay();
    const isFimDeSemana = diaSemana === 0 || diaSemana === 6;
    const visiveis = itens.slice(0, 3);
    const extra = itens.length - visiveis.length;
    html += `
      <div class="calendar-day${isHoje ? ' today' : ''}${isFimDeSemana ? ' weekend' : ''}${itens.length > 0 ? ' has-items' : ''}" data-dia="${dia}">
        <span class="calendar-day-num">${dia}</span>
        ${visiveis.map(it => {
          return `<span class="calendar-item badge ${statusClass(it.status)}" title="${it.area} — ${it.nome} (${it.status})">${it.area}${it.chamado ? ' · ' + it.chamado : ''}</span>`;
        }).join('')}
        ${extra > 0 ? `<span class="calendar-more">+${extra} mais</span>` : ''}
      </div>
    `;
  }
  const gridEl = document.getElementById(targetGridId);
  gridEl.innerHTML = html;

  gridEl.querySelectorAll('.calendar-day[data-dia]').forEach(cell => {
    const dia = Number(cell.dataset.dia);
    const itens = diasMap[dia] || [];
    if (itens.length === 0) return;
    cell.onclick = () => openDayModal(dia, itens);
  });
}

function openDayModal(dia, itens) {
  const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  document.getElementById('day-modal-title').textContent = `Entregas em ${dia} de ${monthNames[state.calendarMonth]} (${itens.length})`;
  const list = document.getElementById('day-modal-list');
  list.innerHTML = itens.map(it => `
    <div class="deadline-row">
      <div>
        <p class="deadline-name">${it.nome}${it.chamado ? ' · Chamado ' + it.chamado : ''}</p>
        <p class="deadline-meta">${it.area}${it.cliente_nome ? ' · Cliente: ' + it.cliente_nome : ''}${it.gerente_nome ? ' · GP: ' + it.gerente_nome : ''}</p>
      </div>
      <span class="badge ${statusClass(it.status)}">${it.status}</span>
    </div>
  `).join('');
  document.getElementById('modal-day-details').classList.remove('hidden');
}
document.getElementById('btn-close-day-modal').addEventListener('click', () => {
  document.getElementById('modal-day-details').classList.add('hidden');
});

document.getElementById('cal-prev').addEventListener('click', () => {
  state.calendarMonth--;
  if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear--; }
  renderCalendar();
});
document.getElementById('cal-next').addEventListener('click', () => {
  state.calendarMonth++;
  if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear++; }
  renderCalendar();
});
document.getElementById('cal-hoje').addEventListener('click', () => {
  const hoje = new Date();
  state.calendarMonth = hoje.getMonth();
  state.calendarYear = hoje.getFullYear();
  renderCalendar();
});

// ---------- velocimetro (tempo gasto na demanda) ----------
function buildGaugeSvg(valorHoras, maxHoras) {
  const size = 280, cx = size / 2, cy = size / 2;
  const rPanel = 122, rTicks = 102, rZone = 84, rNeedle = 90;
  const max = maxHoras > 0 ? maxHoras : 1;
  const percent = Math.min(Math.max((valorHoras / max) * 100, 0), 100);

  // varredura de 270 graus (estilo velocimetro), com folga de 90 graus na parte de baixo.
  // convencao: 0=direita, 90=baixo, 180=esquerda, 270=topo (sentido horario)
  const START = 135, END = 405;
  function angleFor(pct) { return START + (pct / 100) * (END - START); }
  function pt(angleDeg, raio) {
    const rad = angleDeg * Math.PI / 180;
    return { x: cx + raio * Math.cos(rad), y: cy + raio * Math.sin(rad) };
  }
  function arcPath(pctStart, pctEnd, raio) {
    const a1 = angleFor(pctStart), a2 = angleFor(pctEnd);
    const p1 = pt(a1, raio), p2 = pt(a2, raio);
    const largeArc = (a2 - a1) > 180 ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${raio} ${raio} 0 ${largeArc} 1 ${p2.x} ${p2.y}`;
  }

  // marcacoes ao redor (a cada 10%, maiores a cada 20% com numero em horas)
  let ticksHtml = '';
  for (let i = 0; i <= 10; i++) {
    const pct = i * 10;
    const ang = angleFor(pct);
    const isMajor = i % 2 === 0;
    const p1 = pt(ang, isMajor ? rTicks - 11 : rTicks - 6);
    const p2 = pt(ang, rTicks);
    ticksHtml += `<line x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}" stroke="${isMajor ? 'var(--brand-blue)' : 'var(--border)'}" stroke-width="${isMajor ? 2.5 : 1.5}" stroke-linecap="round" />`;
    if (isMajor) {
      const lp = pt(ang, rTicks + 16);
      ticksHtml += `<text x="${lp.x}" y="${lp.y}" text-anchor="middle" dominant-baseline="middle" font-size="10.5" fill="var(--text-muted)">${Math.round(max * pct / 100)}</text>`;
    }
  }

  // ordem invertida: verde (uso baixo/tranquilo) -> amarelo -> vermelho (uso alto/proximo do limite)
  const zoneGreen = arcPath(0, 30, rZone);
  const zoneYellow = arcPath(30, 70, rZone);
  const zoneRed = arcPath(70, 100, rZone);

  const needleAngle = angleFor(percent);
  const tip = pt(needleAngle, rNeedle);
  const baseLeft = pt(needleAngle + 90, 5.5);
  const baseRight = pt(needleAngle - 90, 5.5);

  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <radialGradient id="gaugeBg-${cx}" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="100%" stop-color="#eef2f7" />
        </radialGradient>
        <filter id="shadow-${cx}" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#123f73" flood-opacity="0.35" />
        </filter>
      </defs>
      <circle cx="${cx}" cy="${cy}" r="${rPanel}" fill="url(#gaugeBg-${cx})" stroke="var(--border)" stroke-width="1.5" />
      ${ticksHtml}
      <path d="${zoneGreen}" fill="none" stroke="var(--success)" stroke-width="8" stroke-linecap="round" />
      <path d="${zoneYellow}" fill="none" stroke="var(--warning)" stroke-width="8" stroke-linecap="round" />
      <path d="${zoneRed}" fill="none" stroke="var(--danger)" stroke-width="8" stroke-linecap="round" />
      <polygon points="${tip.x},${tip.y} ${baseLeft.x},${baseLeft.y} ${baseRight.x},${baseRight.y}" fill="var(--brand-blue)" filter="url(#shadow-${cx})" />
      <circle cx="${cx}" cy="${cy}" r="9" fill="var(--surface)" stroke="var(--brand-blue)" stroke-width="2.5" />
      <rect x="${cx - 44}" y="${cy + 38}" width="88" height="32" rx="16" fill="var(--accent-soft)" />
      <text x="${cx}" y="${cy + 59}" text-anchor="middle" font-size="18" font-weight="700" fill="var(--brand-blue)">${Math.round(valorHoras)}h</text>
    </svg>
  `;
}

function diasUteisEntre(inicioStr, fimStr) {
  const start = new Date(inicioStr + 'T00:00:00');
  const end = new Date(fimStr + 'T00:00:00');
  if (end < start) return 0;
  let count = 0;
  const d = new Date(start);
  while (d <= end) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}
function horasTarefa(t) {
  const hojeStr = new Date().toISOString().slice(0, 10);
  const horasPrevistas = diasUteisEntre(t.inicio, t.fim) * 8;
  if (hojeStr < t.inicio) return { horasInvestidas: 0, horasPrevistas };
  const fimEfetivo = hojeStr > t.fim ? t.fim : hojeStr;
  const horasInvestidas = diasUteisEntre(t.inicio, fimEfetivo) * 8;
  return { horasInvestidas, horasPrevistas };
}

function renderVelocimetroFilters() {
  const areaSel = document.getElementById('vel-area');
  areaSel.innerHTML = state.areas.map(a => `<option value="${a}">${a}</option>`).join('');

  const hoje = new Date();
  const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
  const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).toISOString().slice(0, 10);
  const inicioInput = document.getElementById('vel-periodo-inicio');
  const fimInput = document.getElementById('vel-periodo-fim');
  if (!inicioInput.value) inicioInput.value = inicioMes;
  if (!fimInput.value) fimInput.value = fimMes;

  renderVelocimetroChamados();
}

function renderVelocimetroChamados() {
  const area = document.getElementById('vel-area').value;
  const chamadoSel = document.getElementById('vel-chamado');
  const valorAtual = chamadoSel.value;
  const projetosDaArea = state.calendarProjects.filter(p => p.tarefas.some(t => t.area === area));
  chamadoSel.innerHTML = '<option value="">Todos os chamados (média do período)</option>' +
    projetosDaArea.map(p => `<option value="${p.id}">${p.chamado ? p.chamado + ' — ' : ''}${p.nome}</option>`).join('');
  if ([...chamadoSel.options].some(o => o.value === valorAtual)) chamadoSel.value = valorAtual;
}

function renderVelocimetro() {
  const area = document.getElementById('vel-area').value;
  const projetoId = document.getElementById('vel-chamado').value;
  const periodoInicio = document.getElementById('vel-periodo-inicio').value;
  const periodoFim = document.getElementById('vel-periodo-fim').value;
  const host = document.getElementById('vel-gauge-wrap');

  let tarefas = [];
  if (projetoId) {
    const projeto = state.calendarProjects.find(p => String(p.id) === String(projetoId));
    if (projeto) tarefas = projeto.tarefas.filter(t => t.area === area && t.inicio && t.fim);
  } else {
    state.calendarProjects.forEach(p => {
      p.tarefas.forEach(t => {
        if (t.area !== area || !t.inicio || !t.fim) return;
        if (periodoInicio && t.fim < periodoInicio) return;
        if (periodoFim && t.inicio > periodoFim) return;
        tarefas.push(t);
      });
    });
  }

  if (tarefas.length === 0) {
    host.innerHTML = '<p class="gauge-empty">Nenhuma tarefa com datas definidas para essa combinação de filtros.</p>';
    return;
  }

  let horasInvestidas = 0, horasPrevistas = 0;
  tarefas.forEach(t => {
    const h = horasTarefa(t);
    horasInvestidas += h.horasInvestidas;
    horasPrevistas += h.horasPrevistas;
  });

  const ESCALA_MAXIMA_HORAS = 10000;
  host.innerHTML = `
    ${buildGaugeSvg(horasInvestidas, ESCALA_MAXIMA_HORAS)}
    <p class="gauge-info">${Math.round(horasInvestidas)}h investidas (previsto para essa demanda: ${Math.round(horasPrevistas)}h)${tarefas.length > 1 ? ' · ' + tarefas.length + ' tarefas somadas' : ''}</p>
  `;
}

document.getElementById('vel-area').addEventListener('change', () => {
  renderVelocimetroChamados();
  renderVelocimetro();
});
document.getElementById('vel-chamado').addEventListener('change', renderVelocimetro);
document.getElementById('vel-periodo-inicio').addEventListener('change', renderVelocimetro);
document.getElementById('vel-periodo-fim').addEventListener('change', renderVelocimetro);

async function renderDashboard() {
  const projects = await api('/projects');

  // stats
  const total = projects.length;
  const atrasados = projects.filter(p => p.status_prazo === 'atrasado').length;
  const bloqueados = projects.filter(p => p.status_prazo === 'bloqueado').length;
  const naoIniciados = projects.filter(p => p.status_prazo === 'não iniciado').length;
  document.getElementById('dash-stats').innerHTML = `
    <div class="stat-card"><p class="stat-label">Total de projetos</p><p class="stat-value">${total}</p></div>
    <div class="stat-card"><p class="stat-label">Atrasados</p><p class="stat-value" style="color:var(--danger)">${atrasados}</p></div>
    <div class="stat-card"><p class="stat-label">Bloqueados</p><p class="stat-value" style="color:var(--warning)">${bloqueados}</p></div>
    <div class="stat-card"><p class="stat-label">Não iniciados</p><p class="stat-value" style="color:var(--text-muted)">${naoIniciados}</p></div>
  `;

  // donut: distribuicao por status
  const statusGroups = [
    { label: 'Em dia', value: projects.filter(p => p.status_prazo === 'em dia').length, color: 'var(--success)' },
    { label: 'Atrasado', value: atrasados, color: 'var(--danger)' },
    { label: 'Bloqueado', value: bloqueados, color: 'var(--warning)' },
    { label: 'Não iniciado', value: naoIniciados, color: '#9AA6B8' },
  ];
  const donutHost = document.getElementById('dash-donut');
  donutHost.innerHTML = `
    ${buildDonutSvg(statusGroups)}
    <div class="donut-legend">
      ${statusGroups.map(g => `
        <div class="donut-legend-item">
          <div class="donut-legend-left"><span class="donut-legend-dot" style="background:${g.color}"></span>${g.label}</div>
          <span class="donut-legend-value">${g.value}</span>
        </div>
      `).join('')}
    </div>
  `;

  // barras por area
  const counts = state.areas.map(area => ({
    area,
    count: projects.filter(p => p.tarefas.some(t => t.area === area)).length,
  })).sort((a, b) => b.count - a.count);
  const maxCount = Math.max(...counts.map(c => c.count), 1);
  const areaHost = document.getElementById('dash-area-bars');
  areaHost.innerHTML = counts.map(c => `
    <div class="bar-chart-row">
      <span class="bar-chart-label">${c.area}</span>
      <div class="bar-chart-track"><div class="bar-chart-fill" style="width:${(c.count / maxCount) * 100}%"></div></div>
      <span class="bar-chart-value">${c.count}</span>
    </div>
  `).join('') || '<p class="muted">Nenhuma área cadastrada ainda.</p>';

  // linha do tempo (gantt simplificado)
  renderGanttChart(projects);

  // calendario de entregas (somente projetos/WBS - agenda do implantador fica isolada na tela Equipe)
  state.calendarProjects = projects;
  renderCalendarAreaFilters();
  renderCalendar();

  // velocimetro (tempo gasto na demanda)
  renderVelocimetroFilters();
  renderVelocimetro();

  // prazos mais proximos
  const naoConcluidos = projects.filter(p => {
    const s = (p.status_prazo || '').toLowerCase();
    return s !== 'concluído' && s !== 'concluido';
  });
  const proximos = [...naoConcluidos].sort((a, b) => (a.data_fim || '').localeCompare(b.data_fim || '')).slice(0, 6);
  const deadlineHost = document.getElementById('dash-deadlines');
  deadlineHost.innerHTML = proximos.map(p => `
    <div class="deadline-row">
      <div>
        <p class="deadline-name">${p.nome}</p>
        <p class="deadline-meta">${p.cliente_nome ? 'Cliente: ' + p.cliente_nome + ' · ' : ''}GP: ${p.gerente_nome || '-'}</p>
      </div>
      <div style="text-align:right;">
        <p style="margin:0;font-size:13px;">${fmtDate(p.data_fim)}</p>
        <span class="badge ${statusClass(p.status_prazo)}">${p.status_prazo}</span>
      </div>
    </div>
  `).join('') || '<p class="muted">Nenhum projeto em aberto.</p>';

  // carga de trabalho por GP
  renderGpWorkload(projects);

  // projetos por cliente
  renderClienteWorkload(projects);

  // tendencia de atrasos
  renderTrend(projects);

  // projetos esquecidos (sem atualizacao recente)
  renderEsquecidos(projects);
}

function workloadRowHtml(nome, total, atrasados, bloqueados, maxTotal) {
  const extras = [];
  if (atrasados > 0) extras.push(`<span style="color:var(--danger)">${atrasados} atrasado${atrasados > 1 ? 's' : ''}</span>`);
  if (bloqueados > 0) extras.push(`<span style="color:var(--warning)">${bloqueados} bloqueado${bloqueados > 1 ? 's' : ''}</span>`);
  return `
    <div class="workload-row">
      <span class="workload-label" title="${nome}">${nome}</span>
      <div class="bar-chart-track"><div class="bar-chart-fill" style="width:${(total / maxTotal) * 100}%"></div></div>
      <span class="workload-counts">${total} total${extras.length ? ' · ' + extras.join(' · ') : ''}</span>
    </div>
  `;
}

function renderGpWorkload(projects) {
  const host = document.getElementById('dash-gp-bars');
  const linhas = state.gps.map(gp => {
    const projs = projects.filter(p => p.gp_id === gp.id);
    return {
      nome: gp.nome,
      total: projs.length,
      atrasados: projs.filter(p => p.status_prazo === 'atrasado').length,
      bloqueados: projs.filter(p => p.status_prazo === 'bloqueado').length,
    };
  }).filter(l => l.total > 0).sort((a, b) => b.total - a.total);

  if (linhas.length === 0) {
    host.innerHTML = '<p class="muted">Nenhum GP com projetos atribuídos ainda.</p>';
    return;
  }
  const maxTotal = Math.max(...linhas.map(l => l.total), 1);
  const semGp = projects.filter(p => !p.gp_id).length;
  host.innerHTML = linhas.map(l => workloadRowHtml(l.nome, l.total, l.atrasados, l.bloqueados, maxTotal)).join('') +
    (semGp > 0 ? `<p class="muted" style="margin-top:12px;">${semGp} projeto(s) sem GP definido.</p>` : '');
}

function renderClienteWorkload(projects) {
  const host = document.getElementById('dash-cliente-bars');
  const mapa = {};
  projects.forEach(p => {
    const nome = p.cliente_nome || 'Sem cliente definido';
    if (!mapa[nome]) mapa[nome] = { total: 0, atrasados: 0, bloqueados: 0 };
    mapa[nome].total++;
    if (p.status_prazo === 'atrasado') mapa[nome].atrasados++;
    if (p.status_prazo === 'bloqueado') mapa[nome].bloqueados++;
  });
  const linhas = Object.entries(mapa).map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.total - a.total);
  if (linhas.length === 0) {
    host.innerHTML = '<p class="muted">Nenhum projeto cadastrado ainda.</p>';
    return;
  }
  const maxTotal = Math.max(...linhas.map(l => l.total), 1);
  host.innerHTML = linhas.map(l => workloadRowHtml(l.nome, l.total, l.atrasados, l.bloqueados, maxTotal)).join('');
}

function buildTrendSvg(buckets) {
  const w = 620, h = 220, padLeft = 34, padRight = 20, padTop = 26, padBottom = 30;
  const maxVal = Math.max(...buckets.map(b => b.value), 1);
  const innerW = w - padLeft - padRight;
  const innerH = h - padTop - padBottom;
  const stepX = buckets.length > 1 ? innerW / (buckets.length - 1) : 0;
  const points = buckets.map((b, i) => ({
    x: padLeft + i * stepX,
    y: padTop + innerH - (b.value / maxVal) * innerH,
    ...b,
  }));
  const pathD = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
  const areaD = pathD + ` L ${points[points.length - 1].x.toFixed(1)} ${(padTop + innerH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(padTop + innerH).toFixed(1)} Z`;
  const dots = points.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="var(--danger)" />`).join('');
  const labels = points.map(p => `<text x="${p.x.toFixed(1)}" y="${h - 8}" text-anchor="middle" font-size="10.5" fill="var(--text-muted)">${p.label}</text>`).join('');
  const values = points.map(p => `<text x="${p.x.toFixed(1)}" y="${(p.y - 10).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--danger)">${p.value}</text>`).join('');
  const baseline = `<line x1="${padLeft}" y1="${padTop + innerH}" x2="${w - padRight}" y2="${padTop + innerH}" stroke="var(--border)" stroke-width="1" />`;
  return `
    <svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
      ${baseline}
      <path d="${areaD}" fill="var(--danger-soft)" opacity="0.6" />
      <path d="${pathD}" fill="none" stroke="var(--danger)" stroke-width="2.5" />
      ${dots}${labels}${values}
    </svg>
  `;
}

function renderTrend(projects) {
  const host = document.getElementById('dash-trend-chart');
  const hoje = new Date();
  const buckets = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - i * 7);
    const dStr = d.toISOString().slice(0, 10);
    const atrasados = projects.filter(p => p.data_fim && p.data_fim < dStr).length;
    buckets.push({ label: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), value: atrasados });
  }
  if (projects.length === 0) {
    host.innerHTML = '<p class="muted">Nenhum projeto cadastrado ainda.</p>';
    return;
  }
  host.innerHTML = buildTrendSvg(buckets);
}

function renderEsquecidos(projects) {
  const host = document.getElementById('dash-esquecidos-list');
  const LIMITE_DIAS = 15;
  const agora = Date.now();
  const lista = projects
    .filter(p => {
      const s = (p.status_prazo || '').toLowerCase();
      if (s === 'concluído' || s === 'concluido') return false;
      const ultima = (p.historico && p.historico.length > 0) ? p.historico[0].criado_em : p.criado_em;
      if (!ultima) return false;
      const dias = (agora - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24);
      return dias >= LIMITE_DIAS;
    })
    .map(p => {
      const ultima = (p.historico && p.historico.length > 0) ? p.historico[0].criado_em : p.criado_em;
      const dias = Math.floor((agora - new Date(ultima).getTime()) / (1000 * 60 * 60 * 24));
      return { ...p, diasSemAtualizar: dias };
    })
    .sort((a, b) => b.diasSemAtualizar - a.diasSemAtualizar);

  if (lista.length === 0) {
    host.innerHTML = '<p class="muted">Nenhum projeto esquecido — todos tiveram atualização recente. 👍</p>';
    return;
  }
  host.innerHTML = lista.map(p => `
    <div class="deadline-row">
      <div>
        <p class="deadline-name">${p.nome}${p.chamado ? ' · Chamado ' + p.chamado : ''}</p>
        <p class="deadline-meta">${p.cliente_nome ? 'Cliente: ' + p.cliente_nome + ' · ' : ''}GP: ${p.gerente_nome || '-'}</p>
      </div>
      <div style="text-align:right;">
        <p style="margin:0;font-size:13px;color:var(--danger);font-weight:600;">${p.diasSemAtualizar} dias sem atualizar</p>
        <span class="badge ${statusClass(p.status_prazo)}">${p.status_prazo}</span>
      </div>
    </div>
  `).join('');
}

// ---------- submenu do dashboard ----------
function activateDashPage(key) {
  document.querySelectorAll('.dash-subnav-btn').forEach(b => b.classList.toggle('active', b.dataset.dash === key));
  document.querySelectorAll('.dash-page').forEach(p => p.classList.toggle('hidden', p.id !== `dash-page-${key}`));
  if (key === 'semanal') refreshSemanal();
}
document.querySelectorAll('.dash-subnav-btn').forEach(btn => {
  btn.addEventListener('click', () => activateDashPage(btn.dataset.dash));
});

// ---------- New project modal ----------
const modal = document.getElementById('modal-new-project');
document.getElementById('btn-open-new-project').onclick = () => modal.classList.remove('hidden');
document.getElementById('btn-cancel-new-project').onclick = () => modal.classList.add('hidden');

function populateGpSelect() {
  const options = '<option value="">Sem GP definido</option>' +
    state.gps.map(gp => `<option value="${gp.id}">${gp.nome}</option>`).join('');
  document.getElementById('np-gp').innerHTML = options;
  const editSel = document.getElementById('edit-gp');
  if (editSel) editSel.innerHTML = options;
}
function renderNewProjectAreaChips() {
  const el = document.getElementById('np-areas');
  el.innerHTML = '';
  state.newProjectAreas = {};
  state.areas.forEach(a => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = a;
    chip.onclick = () => {
      const selected = chip.classList.toggle('selected');
      if (selected) state.newProjectAreas[a] = { inicio: '', fim: '' };
      else delete state.newProjectAreas[a];
      renderNewProjectAreaDates();
    };
    el.appendChild(chip);
  });
  renderNewProjectAreaDates();
}
function renderNewProjectAreaDates() {
  const el = document.getElementById('np-area-dates');
  el.innerHTML = '';
  Object.keys(state.newProjectAreas).forEach(a => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    row.style.flexWrap = 'wrap';
    row.innerHTML = `
      <span class="area-tag" style="min-width:110px;">${a}</span>
      <input type="date" style="width:150px;" data-area="${a}" data-field="inicio" />
      <input type="date" style="width:150px;" data-area="${a}" data-field="fim" />
    `;
    row.querySelectorAll('input').forEach(inp => {
      inp.onchange = () => { state.newProjectAreas[inp.dataset.area][inp.dataset.field] = inp.value; };
    });
    el.appendChild(row);
  });
}
// Se a pessoa digitar uma data manualmente, a caixinha "ainda não tenho as datas"
// desmarca sozinha — sem isso, o valor digitado era silenciosamente descartado no
// salvamento (a caixinha marcada tinha prioridade e forçava as datas para nulo).
['np-inicio', 'np-fim'].forEach(id => {
  document.getElementById(id).addEventListener('input', (e) => {
    if (e.target.value) document.getElementById('np-sem-datas').checked = false;
  });
});
['edit-inicio', 'edit-fim'].forEach(id => {
  document.getElementById(id).addEventListener('input', (e) => {
    if (e.target.value) document.getElementById('edit-sem-datas').checked = false;
  });
});

document.getElementById('form-new-project').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('np-nome').value.trim();
  const chamado = document.getElementById('np-chamado').value.trim();
  const cliente_id = document.getElementById('np-cliente').value || null;
  const gp_id = document.getElementById('np-gp').value || null;
  const tipo = document.getElementById('np-tipo').value;
  const fase = document.getElementById('np-fase').value;
  const semDatas = document.getElementById('np-sem-datas').checked;
  const data_inicio = semDatas ? null : document.getElementById('np-inicio').value;
  const data_fim = semDatas ? null : document.getElementById('np-fim').value;
  const resumo = document.getElementById('np-resumo').value.trim();
  const areasSel = Object.keys(state.newProjectAreas);

  if (!nome || areasSel.length === 0) {
    alert('Preencha nome e ao menos uma área.');
    return;
  }
  if (!semDatas && (!data_inicio || !data_fim)) {
    alert('Preencha o prazo geral, ou marque "Ainda não tenho as datas" para deixar pendente.');
    return;
  }
  // Datas por area sao sempre opcionais: uma area sem inicio/fim fica marcada
  // como "pendente" automaticamente, sem travar o cadastro do restante.

  if (chamado) {
    const duplicado = state.allProjects.find(p => (p.chamado || '').trim().toLowerCase() === chamado.toLowerCase());
    if (duplicado) {
      const prosseguir = confirm(`Já existe um projeto com o chamado "${chamado}": "${duplicado.nome}". Deseja continuar mesmo assim?`);
      if (!prosseguir) return;
    }
  }

  const tarefas = areasSel.map(a => ({
    area: a,
    inicio: state.newProjectAreas[a].inicio || null,
    fim: state.newProjectAreas[a].fim || null,
    status: 'planejamento',
  }));

  try {
    await api('/projects', {
      method: 'POST',
      body: JSON.stringify({ nome, chamado, cliente_id, gp_id, tipo, fase, status_prazo: 'em dia', resumo, data_inicio, data_fim, progresso: 0, tarefas }),
    });
    modal.classList.add('hidden');
    e.target.reset();
    renderNewProjectAreaChips();
    await refreshProjects();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Edit project modal ----------
const editModal = document.getElementById('modal-edit-project');
document.getElementById('btn-cancel-edit-project').onclick = () => editModal.classList.add('hidden');

function openEditModal(p) {
  document.getElementById('edit-id').value = p.id;
  document.getElementById('edit-nome').value = p.nome;
  document.getElementById('edit-chamado').value = p.chamado || '';
  document.getElementById('edit-cliente').value = p.cliente_id || '';
  document.getElementById('edit-gp').value = p.gp_id || '';
  document.getElementById('edit-tipo').value = p.tipo;
  document.getElementById('edit-fase').value = p.fase;
  document.getElementById('edit-inicio').value = p.data_inicio || '';
  document.getElementById('edit-fim').value = p.data_fim || '';
  document.getElementById('edit-sem-datas').checked = !p.data_inicio || !p.data_fim;
  document.getElementById('edit-resumo').value = p.resumo || '';
  const statusSel = document.getElementById('edit-status-prazo');
  const atual = (p.status_prazo || '').toLowerCase();
  statusSel.value = (atual === 'bloqueado' || atual === 'concluído' || atual === 'concluido') ? atual : 'automatico';
  editModal.classList.remove('hidden');
}

document.getElementById('form-edit-project').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('edit-id').value;
  const nome = document.getElementById('edit-nome').value.trim();
  const chamado = document.getElementById('edit-chamado').value.trim();
  const cliente_id = document.getElementById('edit-cliente').value || null;
  const gp_id = document.getElementById('edit-gp').value || null;
  const tipo = document.getElementById('edit-tipo').value;
  const fase = document.getElementById('edit-fase').value;
  const semDatas = document.getElementById('edit-sem-datas').checked;
  const data_inicio = semDatas ? null : document.getElementById('edit-inicio').value;
  const data_fim = semDatas ? null : document.getElementById('edit-fim').value;
  const resumo = document.getElementById('edit-resumo').value.trim();
  const statusSelValue = document.getElementById('edit-status-prazo').value;
  const status_prazo = statusSelValue === 'automatico' ? 'em dia' : statusSelValue;

  if (!nome) {
    alert('Preencha o nome do projeto.');
    return;
  }
  if (!semDatas && (!data_inicio || !data_fim)) {
    alert('Preencha o prazo geral, ou marque "Ainda não tenho as datas" para deixar pendente.');
    return;
  }

  if (chamado) {
    const duplicado = state.allProjects.find(p => p.id !== Number(id) && (p.chamado || '').trim().toLowerCase() === chamado.toLowerCase());
    if (duplicado) {
      const prosseguir = confirm(`Já existe outro projeto com o chamado "${chamado}": "${duplicado.nome}". Deseja continuar mesmo assim?`);
      if (!prosseguir) return;
    }
  }

  try {
    await api(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ nome, chamado, cliente_id, gp_id, tipo, fase, status_prazo, resumo, data_inicio, data_fim }),
    });
    editModal.classList.add('hidden');
    await refreshProjects();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Implantação ----------
state.implantacaoProjetos = []; // lista completa, pra busca no "Incluir"
state.implantacaoProjetoAlvo = null; // project_id escolhido no fluxo de "Incluir"

state.implantacaoDados = [];
state.implantacaoFiltro = null;

async function refreshImplantacao() {
  const host = document.getElementById('implantacao-lista');
  let projetos;
  try {
    projetos = await api('/implantacao/meus-itens');
  } catch (err) {
    host.innerHTML = `<p class="muted">${err.message}</p>`;
    return;
  }
  state.implantacaoDados = projetos;
  renderImplantacaoStats();
  renderImplantacaoFiltros();
  renderImplantacaoListaFiltrada();
  refreshImplantacaoSequencia();
}

async function refreshImplantacaoSequencia() {
  const banner = document.getElementById('implantacao-sequencia-banner');
  try {
    const { atual, recorde } = await api('/implantacao/sequencia');
    if (recorde === 0) {
      banner.classList.add('hidden');
      return;
    }
    document.getElementById('implantacao-sequencia-atual').textContent = atual;
    document.getElementById('implantacao-sequencia-recorde').textContent = recorde;
    banner.classList.remove('hidden');
  } catch (err) {
    banner.classList.add('hidden');
  }
}

function celebrarConclusao() {
  const container = document.getElementById('confete-container');
  const cores = ['#1B63AC', '#C4211F', '#1F9D55', '#B7791F', '#8B5CF6', '#EC4899'];
  for (let i = 0; i < 40; i++) {
    const peca = document.createElement('div');
    peca.className = 'confete-peca';
    peca.style.left = Math.random() * 100 + 'vw';
    peca.style.background = cores[Math.floor(Math.random() * cores.length)];
    peca.style.animationDelay = (Math.random() * 0.3) + 's';
    peca.style.animationDuration = (1.1 + Math.random() * 0.6) + 's';
    container.appendChild(peca);
    setTimeout(() => peca.remove(), 2200);
  }
}

function todosItensImplantacao() {
  return state.implantacaoDados.flatMap(p => p.itens);
}

function renderImplantacaoStats() {
  const todos = todosItensImplantacao();
  const contagem = {};
  let atrasados = 0;
  todos.forEach(item => {
    contagem[item.status] = (contagem[item.status] || 0) + 1;
    if (wbsPrazoStatus(item) === 'atrasado') atrasados++;
  });
  const host = document.getElementById('implantacao-stats');
  host.innerHTML = `
    <div class="stat-card"><p class="stat-label">Total de itens</p><p class="stat-value">${todos.length}</p></div>
    <div class="stat-card"><p class="stat-label">Pendentes</p><p class="stat-value" style="color:var(--danger)">${contagem['Pendente'] || 0}</p></div>
    <div class="stat-card"><p class="stat-label">Em andamento</p><p class="stat-value" style="color:var(--accent)">${contagem['Em Andamento'] || 0}</p></div>
    <div class="stat-card"><p class="stat-label">Suspensos</p><p class="stat-value">${contagem['Suspensa'] || 0}</p></div>
    <div class="stat-card"><p class="stat-label">Atrasados</p><p class="stat-value" style="color:var(--danger)">${atrasados}</p></div>
  `;

  const grafico = document.getElementById('implantacao-grafico');
  if (grafico) {
    const segmentos = [
      { label: 'Pendente', value: contagem['Pendente'] || 0, color: 'var(--danger)' },
      { label: 'Em Andamento', value: contagem['Em Andamento'] || 0, color: 'var(--accent)' },
      { label: 'Suspensa', value: contagem['Suspensa'] || 0, color: '#2a2a2a' },
      { label: 'Concluído', value: contagem['Concluído'] || 0, color: 'var(--success)' },
    ];
    if (todos.length === 0) {
      grafico.innerHTML = '<p class="muted" style="font-size:12px;text-align:center;">Sem itens ainda</p>';
    } else {
      grafico.innerHTML = buildDonutSvg(segmentos) + `
        <div class="implantacao-grafico-legenda">
          ${segmentos.map(s => `
            <span class="implantacao-grafico-legenda-item">
              <span class="implantacao-grafico-dot" style="background:${s.color};"></span>
              ${s.label}: ${s.value}
            </span>
          `).join('')}
        </div>
      `;
    }
  }
}

function renderImplantacaoFiltros() {
  const host = document.getElementById('implantacao-filtros');
  const opcoes = [
    { valor: null, label: 'Todos' },
    { valor: 'Pendente', label: 'Pendente' },
    { valor: 'Em Andamento', label: 'Em Andamento' },
    { valor: 'Suspensa', label: 'Suspensa' },
    { valor: 'Concluído', label: 'Concluído' },
    { valor: 'atrasado', label: '⚠️ Atrasados' },
  ];
  host.innerHTML = '';
  opcoes.forEach(op => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.implantacaoFiltro === op.valor ? ' selected' : '');
    chip.textContent = op.label;
    chip.onclick = () => {
      state.implantacaoFiltro = op.valor;
      renderImplantacaoFiltros();
      renderImplantacaoListaFiltrada();
    };
    host.appendChild(chip);
  });
}

function renderImplantacaoListaFiltrada() {
  const host = document.getElementById('implantacao-lista');
  if (state.implantacaoDados.length === 0) {
    host.innerHTML = '<p class="muted">Nenhum checklist seu ainda. Clique em "+ Incluir projeto" pra começar.</p>';
    return;
  }
  const filtro = state.implantacaoFiltro;
  const projetosFiltrados = state.implantacaoDados
    .map(p => ({
      ...p,
      itens: p.itens.filter(item => {
        if (!filtro) return true;
        if (filtro === 'atrasado') return wbsPrazoStatus(item) === 'atrasado';
        return item.status === filtro;
      }),
    }))
    .filter(p => p.itens.length > 0);

  if (projetosFiltrados.length === 0) {
    host.innerHTML = '<p class="muted">Nenhum item encontrado para esse filtro.</p>';
    return;
  }
  host.innerHTML = '';
  projetosFiltrados.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-head">
        <div>
          <p class="card-title">${p.nome}${p.chamado ? ' <span style="color:var(--text-muted);font-weight:400;">· Chamado ' + p.chamado + '</span>' : ''}</p>
          <p class="card-sub">${p.cliente_nome ? 'Cliente: ' + p.cliente_nome : ''}</p>
        </div>
        <button class="btn" data-add-item style="font-size:12px;">+ Item</button>
      </div>
      <div class="stack tight" data-lista-itens style="margin-top:8px;"></div>
    `;
    const listaItens = card.querySelector('[data-lista-itens]');
    p.itens.forEach(item => listaItens.appendChild(buildImplantacaoItemRow(item)));
    card.querySelector('[data-add-item]').onclick = () => openImplantacaoItemModal(p.project_id, null);
    host.appendChild(card);
  });
}

function acoesImplantacaoDisponiveis(status) {
  const acoes = {
    'Pendente': [{ status: 'Em Andamento', label: '▶ Iniciar' }, { status: 'Suspensa', label: '⚠ Impeditivo' }],
    'Em Andamento': [{ status: 'Suspensa', label: '⚠ Impeditivo' }, { status: 'Concluído', label: '✓ Concluir' }],
    'Suspensa': [{ status: 'Em Andamento', label: '▶ Retomar' }, { status: 'Concluído', label: '✓ Concluir' }],
    'Concluído': [{ status: 'Pendente', label: '↺ Reabrir' }],
  };
  return acoes[status] || acoes['Pendente'];
}

function buildImplantacaoItemRow(item) {
  const row = document.createElement('div');
  row.className = 'detail-row';
  const prazoStatus = wbsPrazoStatus(item);
  const prazoIcone = prazoStatus === 'atrasado' ? '⚠️ ' : prazoStatus === 'risco' ? '⏳ ' : '';
  const prazoTexto = (item.data_inicio || item.data_fim)
    ? ` <span style="color:var(--text-muted);font-size:11.5px;">(${item.data_inicio ? fmtDate(item.data_inicio) : '?'} → ${item.data_fim ? fmtDate(item.data_fim) : '?'})</span>`
    : '';
  const tagAvulsa = item.tipo === 'avulsa'
    ? ` <span class="badge" style="background:#EDE4FB;color:#5B21B6;font-size:10px;">Demanda Avulsa${item.cliente_nome ? ' · ' + item.cliente_nome : ''}${item.chamado_numero ? ' · Chamado ' + item.chamado_numero : ''}</span>`
    : '';
  const botoesAcao = acoesImplantacaoDisponiveis(item.status)
    .map(a => `<button class="btn" data-status="${a.status}" style="font-size:11px;padding:4px 8px;">${a.label}</button>`)
    .join('');
  row.innerHTML = `
    <span style="flex:1;">${prazoIcone}${item.titulo}${prazoTexto}${tagAvulsa}</span>
    <span class="badge ${wbsStatusClass(item.status)}">${item.status}</span>
    <div style="display:flex;gap:4px;flex-wrap:wrap;">
      ${botoesAcao}
      ${item.tipo === 'avulsa' ? '' : '<button class="icon-btn" data-editar-item aria-label="Adicionar/editar observação">✎</button>'}
    </div>
  `;
  if (item.observacao) {
    const obs = document.createElement('p');
    obs.className = 'wbs-observacao';
    obs.style.paddingLeft = '4px';
    obs.textContent = '💬 ' + item.observacao;
    row.appendChild(obs);
  }
  row.querySelectorAll('[data-status]').forEach(btn => {
    btn.onclick = async () => {
      try {
        const rota = item.tipo === 'avulsa' ? `/implantacao/demandas/${item.id}` : `/implantacao/itens/${item.id}`;
        await api(rota, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.status }) });
        if (btn.dataset.status === 'Concluído') celebrarConclusao();
        await refreshImplantacao();
      } catch (err) {
        alert(err.message);
      }
    };
  });
  if (item.tipo !== 'avulsa') {
    row.querySelector('[data-editar-item]').onclick = () => openImplantacaoItemModal(item.project_id, item);
  }
  return row;
}

function openImplantacaoItemModal(projectId, itemToEdit) {
  document.getElementById('implantacao-item-modal-titulo').textContent = itemToEdit ? 'Editar observação' : 'Novo item';
  document.getElementById('implantacao-item-id').value = itemToEdit ? itemToEdit.id : '';
  document.getElementById('implantacao-item-project-id').value = projectId;
  document.getElementById('implantacao-item-titulo-input').value = itemToEdit ? itemToEdit.titulo : '';
  document.getElementById('implantacao-item-status').value = itemToEdit ? itemToEdit.status : 'Pendente';
  document.getElementById('implantacao-item-inicio').value = itemToEdit ? (itemToEdit.data_inicio || '') : '';
  document.getElementById('implantacao-item-fim').value = itemToEdit ? (itemToEdit.data_fim || '') : '';
  document.getElementById('implantacao-item-observacao').value = itemToEdit ? (itemToEdit.observacao || '') : '';
  // Ao editar um item ja existente, so a Observacao pode ser alterada aqui - titulo,
  // status e prazo so mudam pelo GP dentro da WBS completa (ou pelos botoes de acao
  // rapida, no caso do status). Ao criar um item novo, tudo fica editavel normalmente.
  ['implantacao-item-titulo-input', 'implantacao-item-status', 'implantacao-item-inicio', 'implantacao-item-fim'].forEach(id => {
    document.getElementById(id).disabled = !!itemToEdit;
  });
  document.getElementById('modal-implantacao-incluir').classList.add('hidden');
  document.getElementById('modal-implantacao-item').classList.remove('hidden');
}
document.getElementById('btn-cancel-implantacao-item').addEventListener('click', () => {
  document.getElementById('modal-implantacao-item').classList.add('hidden');
});
document.getElementById('form-implantacao-item').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('implantacao-item-id').value;
  const projectId = document.getElementById('implantacao-item-project-id').value;
  const observacao = document.getElementById('implantacao-item-observacao').value.trim();
  try {
    if (id) {
      // Editando um item ja existente: so a observacao pode mudar por aqui.
      await api(`/implantacao/itens/${id}`, { method: 'PATCH', body: JSON.stringify({ observacao }) });
    } else {
      const titulo = document.getElementById('implantacao-item-titulo-input').value.trim();
      if (!titulo) {
        alert('Preencha o que precisa ser feito.');
        return;
      }
      const body = {
        titulo,
        status: document.getElementById('implantacao-item-status').value,
        data_inicio: document.getElementById('implantacao-item-inicio').value || null,
        data_fim: document.getElementById('implantacao-item-fim').value || null,
        observacao,
      };
      await api(`/implantacao/projetos/${projectId}/itens`, { method: 'POST', body: JSON.stringify(body) });
    }
    document.getElementById('modal-implantacao-item').classList.add('hidden');
    await refreshImplantacao();
  } catch (err) {
    alert(err.message);
  }
});

async function renderImplantacaoBusca(filtro) {
  const host = document.getElementById('implantacao-resultados-busca');
  const q = (filtro || '').toLowerCase().trim();
  const filtrados = !q ? state.implantacaoProjetos : state.implantacaoProjetos.filter(p =>
    (p.nome || '').toLowerCase().includes(q) ||
    (p.chamado || '').toLowerCase().includes(q) ||
    (p.cliente_nome || '').toLowerCase().includes(q)
  );
  if (filtrados.length === 0) {
    host.innerHTML = '<p class="muted">Nenhum projeto encontrado.</p>';
    return;
  }
  host.innerHTML = '';
  filtrados.forEach(p => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'list-row';
    row.style.width = '100%';
    row.style.textAlign = 'left';
    row.style.cursor = 'pointer';
    row.innerHTML = `
      <div class="list-row-main">
        <p class="list-row-name">${p.nome}${p.chamado ? ' · Chamado ' + p.chamado : ''}</p>
        <p class="list-row-sub">${p.cliente_nome ? 'Cliente: ' + p.cliente_nome : 'Sem cliente definido'}</p>
      </div>
    `;
    row.onclick = () => openImplantacaoItemModal(p.id, null);
    host.appendChild(row);
  });
}
document.getElementById('btn-implantacao-incluir').addEventListener('click', async () => {
  document.getElementById('implantacao-busca-projeto').value = '';
  document.getElementById('modal-implantacao-incluir').classList.remove('hidden');
  try {
    state.implantacaoProjetos = await api('/implantacao/projetos');
  } catch (err) {
    state.implantacaoProjetos = [];
  }
  renderImplantacaoBusca('');
});
document.getElementById('implantacao-busca-projeto').addEventListener('input', (e) => {
  renderImplantacaoBusca(e.target.value);
});
document.getElementById('btn-fechar-implantacao-incluir').addEventListener('click', () => {
  document.getElementById('modal-implantacao-incluir').classList.add('hidden');
});

// ---------- guias internas do Admin ----------
function ativarAdminSubtab(grupo) {
  document.querySelectorAll('#admin-subnav .chip').forEach((chip) => {
    chip.classList.toggle('selected', chip.dataset.adminGroup === grupo);
  });
  document.querySelectorAll('.panel[data-admin-group]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.adminGroup !== grupo);
  });
}
document.querySelectorAll('#admin-subnav .chip').forEach((chip) => {
  chip.addEventListener('click', () => ativarAdminSubtab(chip.dataset.adminGroup));
});
ativarAdminSubtab('parametrizacoes');

if (loadUsuarioSession()) {
  aposLogin();
} else {
  mostrarPortaoLogin();
}

// ---------- WBS ----------
state.currentWbsProject = null;
state.wbsCollapsed = {};
state.wbsFullTree = [];
state.wbsSearchQuery = '';
state.wbsCriticidadeFiltro = '';
state.wbsPriorizacaoAtiva = false;

function wbsStatusClass(status) {
  const map = {
    'Pendente': 'badge-wbs-pendente',
    'Em Andamento': 'badge-em-andamento',
    'Em Elaboração': 'badge-wbs-em-elaboracao',
    'Homolog./Cliente': 'badge-wbs-homolog-cliente',
    'Concluído': 'badge-wbs-concluido',
    'Suspensa': 'badge-wbs-suspensa',
  };
  return map[status] || 'badge-planejamento';
}

function aplicarClassePriorizacao() {
  document.getElementById('wbs-estrutura-panel').classList.toggle('wbs-priorizacao-ativa', state.wbsPriorizacaoAtiva);
  document.getElementById('wbs-priorizacao-extra').classList.toggle('hidden', !state.wbsPriorizacaoAtiva);
}

function populateCriticidadeFilter() {
  const sel = document.getElementById('wbs-criticidade-filter');
  const opcoes = [
    '1 - Faça agora mesmo!', '2 - Ganho rápido', '3 - Iniciativa gratificante',
    '4 - Tarefa pontual', '5 - Considerar', '6 - Projeto grande que vale a pena',
    '7 - Não vale a pena', '8 - Não vale a pena', '9 - Perda de tempo! Nem considere',
    'AVALIAR',
  ];
  sel.innerHTML = '<option value="">Todas as criticidades</option>' + opcoes.map(o => `<option value="${o}">${o}</option>`).join('');
}
document.getElementById('wbs-criticidade-filter').addEventListener('change', (e) => {
  state.wbsCriticidadeFiltro = e.target.value;
  renderWbsTreeFiltered();
});
document.getElementById('wbs-priorizacao-toggle').addEventListener('change', async (e) => {
  const ativa = e.target.checked;
  try {
    await api(`/projects/${state.currentWbsProject.id}/priorizacao`, { method: 'PUT', body: JSON.stringify({ ativa }) });
    state.wbsPriorizacaoAtiva = ativa;
    state.currentWbsProject.priorizacao_ativa = ativa;
    aplicarClassePriorizacao();
  } catch (err) {
    alert(err.message);
    e.target.checked = !ativa;
  }
});

function openWbsView(project) {
  state.currentWbsProject = project;
  state.wbsPriorizacaoAtiva = !!project.priorizacao_ativa;
  state.wbsCriticidadeFiltro = '';
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-wbs').classList.remove('hidden');
  document.getElementById('wbs-titulo-projeto').textContent = 'WBS — ' + project.nome;
  document.getElementById('wbs-subtitulo-projeto').textContent =
    (project.chamado ? 'Chamado ' + project.chamado + ' · ' : '') + (project.cliente_nome ? 'Cliente: ' + project.cliente_nome : 'Estrutura detalhada de itens do projeto');
  document.getElementById('wbs-priorizacao-toggle').checked = state.wbsPriorizacaoAtiva;
  document.getElementById('wbs-criticidade-filter').value = '';
  populateCriticidadeFilter();
  aplicarClassePriorizacao();
  loadWbsData();
}
document.getElementById('btn-wbs-voltar').addEventListener('click', () => {
  document.getElementById('view-wbs').classList.add('hidden');
  document.getElementById('view-projetos').classList.remove('hidden');
  document.querySelectorAll('.sidebar-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'projetos'));
});

function renderWbsPriorizacaoAlerta(pendente) {
  const el = document.getElementById('wbs-priorizacao-alerta');
  if (!state.wbsPriorizacaoAtiva || !pendente) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `
    <div class="dependency-alert">
      <span class="dependency-alert-icon">📌</span>
      <span>${pendente} item(ns) aguardando priorização (ainda sem nota de impacto/esforço).</span>
    </div>
  `;
}

async function loadWbsData() {
  if (!state.currentWbsProject) return;
  const data = await api(`/projects/${state.currentWbsProject.id}/wbs`);
  state.wbsFullTree = data.tree;
  renderWbsStats(data.stats, data.total);
  renderWbsProgress(data.stats, data.total);
  renderWbsPriorizacaoAlerta(data.prioridadePendente);
  renderWbsTreeFiltered();
}

function renderWbsProgress(stats, total) {
  const concluido = stats.find(s => s.status === 'Concluído');
  const percent = total > 0 && concluido ? Math.round((concluido.count / total) * 100) : 0;
  document.getElementById('wbs-progress-label').textContent = `${percent}% concluído`;
  const fill = document.getElementById('wbs-progress-fill');
  fill.style.width = barWidth(percent) + '%';
  fill.style.background = completionColor(percent);
}

function wbsStatusColors(status) {
  const map = {
    'Pendente': { bg: 'var(--danger-soft)', text: 'var(--danger)' },
    'Em Andamento': { bg: 'var(--accent-soft)', text: 'var(--accent)' },
    'Em Elaboração': { bg: 'var(--warning-soft)', text: 'var(--warning)' },
    'Homolog./Cliente': { bg: '#fdeedb', text: '#c2650c' },
    'Concluído': { bg: 'var(--success-soft)', text: 'var(--success)' },
    'Suspensa': { bg: '#2a2a2a', text: '#ffffff' },
  };
  return map[status] || { bg: 'var(--surface-alt)', text: 'var(--text-muted)' };
}

function renderWbsStats(stats, total) {
  const el = document.getElementById('wbs-stats');
  const cards = stats.map(s => {
    const cor = wbsStatusColors(s.status);
    return `
      <div class="stat-card" style="background:${cor.bg};border-color:transparent;">
        <p class="stat-label" style="color:${cor.text};opacity:0.85;">${s.status}</p>
        <p class="stat-value" style="color:${cor.text};">${s.count}<span style="font-size:14px;font-weight:400;opacity:0.75;"> (${s.percent}%)</span></p>
      </div>
    `;
  }).join('');
  el.innerHTML = `<div class="stat-card"><p class="stat-label">Total de itens</p><p class="stat-value">${total}</p></div>` + cards;
}

function renderWbsTree(tree, forceExpandIds) {
  const host = document.getElementById('wbs-tree');
  host.innerHTML = '';
  if (tree.length === 0) {
    host.innerHTML = (state.wbsSearchQuery || state.wbsCriticidadeFiltro)
      ? '<p class="muted">Nenhum item encontrado para esse filtro.</p>'
      : '<p class="muted">Nenhum item cadastrado ainda. Clique em "+ Novo item" para começar.</p>';
    return;
  }
  tree.forEach(item => host.appendChild(buildWbsNode(item, 0, forceExpandIds)));
}

function wbsMatches(item, query) {
  const q = query.toLowerCase();
  return (item.titulo && item.titulo.toLowerCase().includes(q)) || (item.responsavel && item.responsavel.toLowerCase().includes(q));
}
function filterTreeByPredicate(tree, predicate, matchedIds) {
  const resultado = [];
  tree.forEach(item => {
    const filhosFiltrados = filterTreeByPredicate(item.filhos || [], predicate, matchedIds);
    const match = predicate(item);
    if (match || filhosFiltrados.length > 0) {
      if (filhosFiltrados.length > 0) matchedIds.add(item.id); // forca expandir quem tem descendente encontrado
      resultado.push({ ...item, filhos: filhosFiltrados });
    }
  });
  return resultado;
}
function renderWbsTreeFiltered() {
  const temBusca = !!state.wbsSearchQuery;
  const temCriticidade = !!state.wbsCriticidadeFiltro;
  if (!temBusca && !temCriticidade) {
    renderWbsTree(state.wbsFullTree);
    return;
  }
  const predicado = (item) => {
    const okBusca = !temBusca || wbsMatches(item, state.wbsSearchQuery);
    const okCriticidade = !temCriticidade || item.criticidade === state.wbsCriticidadeFiltro;
    return okBusca && okCriticidade;
  };
  const matchedIds = new Set();
  const filtrada = filterTreeByPredicate(state.wbsFullTree, predicado, matchedIds);
  renderWbsTree(filtrada, matchedIds);
}
document.getElementById('wbs-search').addEventListener('input', (e) => {
  state.wbsSearchQuery = e.target.value.trim();
  renderWbsTreeFiltered();
});

function wbsSetAllCollapsed(tree, collapsed) {
  tree.forEach(item => {
    if (item.filhos && item.filhos.length > 0) {
      state.wbsCollapsed[item.id] = collapsed;
      wbsSetAllCollapsed(item.filhos, collapsed);
    }
  });
}
document.getElementById('btn-wbs-expandir-tudo').addEventListener('click', () => {
  wbsSetAllCollapsed(state.wbsFullTree, false);
  renderWbsTreeFiltered();
});
document.getElementById('btn-wbs-colapsar-tudo').addEventListener('click', () => {
  wbsSetAllCollapsed(state.wbsFullTree, true);
  renderWbsTreeFiltered();
});

function corCriticidade(criticidade) {
  if (!criticidade || criticidade === 'AVALIAR') return { bg: 'var(--surface-alt)', text: 'var(--text-muted)' };
  const numero = parseInt(criticidade, 10);
  if (numero <= 3) return { bg: 'var(--success-soft)', text: 'var(--success)' };
  if (numero <= 6) return { bg: 'var(--warning-soft)', text: 'var(--warning)' };
  return { bg: 'var(--danger-soft)', text: 'var(--danger)' };
}
function wbsCriticidadeBadge(item) {
  if (!item.criticidade) return '';
  const cor = corCriticidade(item.criticidade);
  const numero = item.criticidade === 'AVALIAR' ? '?' : item.criticidade.split(' - ')[0];
  const tooltip = `${item.criticidade} · Impacto: ${(item.impactoEfetivo ?? 0).toFixed(1)} · Esforço: ${(item.esforcoEfetivo ?? 0).toFixed(1)}`;
  return `<span class="wbs-tag-criticidade" style="background:${cor.bg};color:${cor.text};" title="${tooltip}">${numero}</span>`;
}

function buildWbsNode(item, depth, forceExpandIds) {
  const wrapper = document.createElement('div');
  wrapper.className = 'wbs-node';

  const row = document.createElement('div');
  row.className = 'wbs-row';
  const temFilhos = item.filhos && item.filhos.length > 0;
  const colapsado = forceExpandIds && forceExpandIds.has(item.id) ? false : !!state.wbsCollapsed[item.id];

  const temPrazo = item.data_inicio || item.data_fim;
  const prazoStatus = wbsPrazoStatus(item);
  const prazoIcone = prazoStatus === 'atrasado' ? '⚠️ ' : prazoStatus === 'risco' ? '⏳ ' : '';
  const prazoClasse = prazoStatus === 'atrasado' ? ' wbs-prazo-atrasado' : prazoStatus === 'risco' ? ' wbs-prazo-risco' : '';
  if (prazoStatus === 'atrasado') row.classList.add('wbs-row-atrasado');
  else if (prazoStatus === 'risco') row.classList.add('wbs-row-risco');
  row.innerHTML = `
    ${temFilhos ? `<button class="wbs-toggle" type="button">${colapsado ? '▸' : '▾'}</button>` : '<span class="wbs-toggle-spacer"></span>'}
    <span class="wbs-numero">${item.numero}</span>
    <span class="wbs-titulo" style="padding-left:${depth * 20}px" title="${item.titulo}">${item.titulo}</span>
    <span class="wbs-col-area">${item.area ? `<span class="area-tag">${item.area}</span>` : '<span class="wbs-empty-cell">—</span>'}</span>
    <span class="wbs-col-acao">${item.acao ? `<span class="wbs-tag-acao">${item.acao}</span>` : '<span class="wbs-empty-cell">—</span>'}</span>
    <span class="wbs-responsavel">${item.responsavel || '<span class="wbs-empty-cell">—</span>'}</span>
    <span class="wbs-datas${prazoClasse}" title="${prazoStatus === 'atrasado' ? 'Atrasado' : prazoStatus === 'risco' ? 'Possível atraso' : prazoStatus === 'ok' ? 'Dentro do prazo' : ''}">${temPrazo ? `${prazoIcone}${item.data_inicio ? fmtDate(item.data_inicio) : '?'} → ${item.data_fim ? fmtDate(item.data_fim) : '?'}` : '<span class="wbs-empty-cell">—</span>'}</span>
    <span class="wbs-col-esforco">${Number(item.horas_esforco) > 0 ? `${Number(item.horas_esforco)}h` : '<span class="wbs-empty-cell">—</span>'}</span>
    <span class="wbs-col-duracao">${Number(item.horas_esforco) > 0 ? `${(Number(item.horas_esforco) / HORAS_POR_DIA_WBS).toFixed(1)}d` : '<span class="wbs-empty-cell">—</span>'}</span>
    <span class="wbs-col-status"><span class="badge ${wbsStatusClass(item.status)}">${item.status}</span></span>
    <span class="wbs-col-criticidade">${wbsCriticidadeBadge(item)}</span>
    <div class="wbs-actions">
      <button class="icon-btn" data-wbs-up type="button" aria-label="Mover para cima" title="Mover para cima">↑</button>
      <button class="icon-btn" data-wbs-down type="button" aria-label="Mover para baixo" title="Mover para baixo">↓</button>
      <button class="icon-btn" data-wbs-add-child type="button" aria-label="Adicionar sub-item" title="Adicionar sub-item">+</button>
      <button class="icon-btn" data-wbs-duplicar type="button" aria-label="Duplicar item" title="Duplicar item (com os sub-itens)">⧉</button>
      <button class="icon-btn" data-wbs-edit type="button" aria-label="Editar item" title="Editar item">✎</button>
      <button class="icon-btn" data-wbs-delete type="button" aria-label="Excluir item" title="Excluir item">✕</button>
    </div>
  `;
  wrapper.appendChild(row);

  if (item.observacao) {
    const obs = document.createElement('p');
    obs.className = 'wbs-observacao';
    obs.style.paddingLeft = (84 + depth * 20) + 'px';
    obs.textContent = '💬 ' + item.observacao;
    wrapper.appendChild(obs);
  }

  if (temFilhos) {
    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'wbs-children';
    if (colapsado) childrenWrap.style.display = 'none';
    item.filhos.forEach(child => childrenWrap.appendChild(buildWbsNode(child, depth + 1, forceExpandIds)));
    wrapper.appendChild(childrenWrap);

    row.querySelector('.wbs-toggle').onclick = () => {
      state.wbsCollapsed[item.id] = !state.wbsCollapsed[item.id];
      childrenWrap.style.display = state.wbsCollapsed[item.id] ? 'none' : '';
      row.querySelector('.wbs-toggle').textContent = state.wbsCollapsed[item.id] ? '▸' : '▾';
    };
  }

  row.querySelector('[data-wbs-add-child]').onclick = () => openWbsItemModal(item.id, null);
  row.querySelector('[data-wbs-edit]').onclick = () => openWbsItemModal(item.parent_id, item);
  row.querySelector('[data-wbs-duplicar]').onclick = async () => {
    try {
      await api(`/wbs/${item.id}/duplicar`, { method: 'POST' });
      await loadWbsData();
    } catch (err) {
      alert(err.message);
    }
  };
  row.querySelector('[data-wbs-delete]').onclick = async () => {
    const aviso = temFilhos ? ` Isso vai remover também os ${countWbsDescendants(item)} sub-item(ns) dentro dele.` : '';
    if (!confirm(`Excluir o item "${item.titulo}"?${aviso}`)) return;
    try {
      await api(`/wbs/${item.id}`, { method: 'DELETE' });
      await loadWbsData();
    } catch (err) {
      alert(err.message);
    }
  };
  row.querySelector('[data-wbs-up]').onclick = async () => {
    await api(`/wbs/${item.id}/mover`, { method: 'POST', body: JSON.stringify({ direcao: 'up' }) });
    await loadWbsData();
  };
  row.querySelector('[data-wbs-down]').onclick = async () => {
    await api(`/wbs/${item.id}/mover`, { method: 'POST', body: JSON.stringify({ direcao: 'down' }) });
    await loadWbsData();
  };

  return wrapper;
}

function countWbsDescendants(item) {
  let count = 0;
  (item.filhos || []).forEach(child => { count += 1 + countWbsDescendants(child); });
  return count;
}

// ---------- modo apresentacao da WBS ----------
function buildWbsPresentationNode(item, depth) {
  const wrapper = document.createElement('div');
  wrapper.className = 'wbs-pres-node';

  const row = document.createElement('div');
  row.className = 'wbs-pres-row';

  const temPrazo = item.data_inicio || item.data_fim;
  const prazoStatus = wbsPrazoStatus(item);
  const prazoIcone = prazoStatus === 'atrasado' ? '⚠️ ' : prazoStatus === 'risco' ? '⏳ ' : '';
  if (prazoStatus === 'atrasado') row.classList.add('wbs-row-atrasado');
  else if (prazoStatus === 'risco') row.classList.add('wbs-row-risco');

  const horasEsforco = Number(item.horas_esforco) || 0;
  const duracaoDias = horasEsforco > 0 ? (horasEsforco / HORAS_POR_DIA_WBS).toFixed(1) : null;
  const vazio = '<span class="wbs-pres-vazio">—</span>';

  row.innerHTML = `
    <span class="wbs-pres-numero">${item.numero}</span>
    <span class="wbs-pres-titulo" style="padding-left:${depth * 22}px" title="${item.titulo}">${item.titulo}</span>
    <span class="wbs-pres-area">${item.area ? `<span class="area-tag">${item.area}</span>` : vazio}</span>
    <span class="wbs-pres-acao">${item.acao ? `<span class="wbs-tag-acao">${item.acao}</span>` : vazio}</span>
    <span class="wbs-pres-responsavel">${item.responsavel ? `👤 ${item.responsavel}` : vazio}</span>
    <span class="wbs-pres-datas">${temPrazo ? `${prazoIcone}${item.data_inicio ? fmtDate(item.data_inicio) : '?'} → ${item.data_fim ? fmtDate(item.data_fim) : '?'}` : vazio}</span>
    <span class="wbs-pres-esforco">${horasEsforco > 0 ? `${horasEsforco}h` : vazio}</span>
    <span class="wbs-pres-duracao">${horasEsforco > 0 ? `${duracaoDias}d` : vazio}</span>
    <span class="wbs-pres-status"><span class="badge ${wbsStatusClass(item.status)}">${item.status}</span></span>
  `;
  wrapper.appendChild(row);

  (item.filhos || []).forEach(child => wrapper.appendChild(buildWbsPresentationNode(child, depth + 1)));
  return wrapper;
}

function openWbsPresentation() {
  const project = state.currentWbsProject;
  if (!project) return;

  document.getElementById('wbs-presentation-titulo').textContent = project.nome;
  document.getElementById('wbs-presentation-subtitulo').textContent =
    [project.chamado ? 'Chamado ' + project.chamado : null, project.cliente_nome ? 'Cliente: ' + project.cliente_nome : null]
      .filter(Boolean).join(' · ');

  const progressLabel = document.getElementById('wbs-progress-label').textContent;
  const progressWidth = document.getElementById('wbs-progress-fill').style.width;
  const progressBg = document.getElementById('wbs-progress-fill').style.background;
  document.getElementById('wbs-presentation-progress').innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:16px;margin-bottom:8px;">
      <span style="font-weight:700;">Progresso geral</span><span>${progressLabel}</span>
    </div>
    <div class="progress-track" style="height:14px;"><div class="progress-fill" style="width:${progressWidth};background:${progressBg};"></div></div>
  `;

  const treeHost = document.getElementById('wbs-presentation-tree');
  treeHost.innerHTML = '';
  if (state.wbsFullTree.length === 0) {
    treeHost.innerHTML = '<p class="muted">Nenhum item cadastrado ainda.</p>';
  } else {
    state.wbsFullTree.forEach(item => treeHost.appendChild(buildWbsPresentationNode(item, 0)));
  }

  document.getElementById('wbs-presentation-overlay').classList.remove('hidden');
  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {}); // falha silenciosa se o navegador negar (ex: sem gesto do usuario)
  }
}

function closeWbsPresentation() {
  document.getElementById('wbs-presentation-overlay').classList.add('hidden');
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

document.getElementById('btn-wbs-apresentacao').addEventListener('click', openWbsPresentation);
document.getElementById('btn-wbs-sair-apresentacao').addEventListener('click', closeWbsPresentation);

// ---------- modo apresentacao do calendario (pensado pra ficar ligado numa TV) ----------
const CAL_PRESENTATION_CORES_AREA = [
  '#1B63AC', '#C4211F', '#1F9D55', '#B7791F', '#7C3AED',
  '#EC4899', '#0E7490', '#B45309', '#4D7C0F', '#9D174D',
  '#0891B2', '#DC2626', '#059669', '#7C2D12', '#4338CA', '#BE185D',
];
function corDaArea(area) {
  if (!area) return '#64748B';
  // usa a posicao da area na lista cadastrada (state.areas) - garante cores diferentes
  // pra areas diferentes (ao contrario de um hash, que pode colidir por coincidencia)
  const nomesAreas = (state.areas || []).map(a => (a.nome || a));
  let indice = nomesAreas.indexOf(area);
  if (indice === -1) {
    // area nao encontrada na lista (ex: nome digitado livre) - cai num hash como reserva
    let hash = 0;
    for (let i = 0; i < area.length; i++) hash = (hash * 31 + area.charCodeAt(i)) >>> 0;
    indice = hash;
  }
  return CAL_PRESENTATION_CORES_AREA[indice % CAL_PRESENTATION_CORES_AREA.length];
}
function tagArea(area) {
  if (!area) return '';
  const cor = corDaArea(area);
  return `<span class="cal-presentation-area-tag" style="background:${cor}1a;color:${cor};border-color:${cor}66;">${area.toUpperCase()}</span>`;
}

let calPresentationInterval = null;
let calPresentationWakeLock = null;
let calPresentationSlideInterval = null;
let calPresentationSlideAtual = 0;
const CAL_PRESENTATION_SLIDES = ['cal-presentation-slide-calendario', 'cal-presentation-slide-cards'];

function carregarConfigApresentacao() {
  try {
    const salvo = JSON.parse(localStorage.getItem('calPresentationConfig') || '{}');
    return {
      refreshMin: Number(salvo.refreshMin) > 0 ? Number(salvo.refreshMin) : 5,
      slideSeg: Number(salvo.slideSeg) > 0 ? Number(salvo.slideSeg) : 15,
    };
  } catch (e) {
    return { refreshMin: 5, slideSeg: 15 };
  }
}
function salvarConfigApresentacao(cfg) {
  localStorage.setItem('calPresentationConfig', JSON.stringify(cfg));
}
let calPresentationConfig = carregarConfigApresentacao();

function mostrarSlidePresentacao(indice) {
  calPresentationSlideAtual = indice;
  CAL_PRESENTATION_SLIDES.forEach((id, i) => {
    document.getElementById(id).classList.toggle('hidden', i !== indice);
  });
  document.querySelectorAll('.cal-presentation-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === indice);
  });
}
function proximoSlidePresentacao() {
  mostrarSlidePresentacao((calPresentationSlideAtual + 1) % CAL_PRESENTATION_SLIDES.length);
}

function projetosSemPrazo() {
  return state.calendarProjects.filter(p => (p.status_prazo || '').toLowerCase() === 'pendente');
}
function projetosAtrasados() {
  return state.calendarProjects.filter(p => (p.status_prazo || '').toLowerCase() === 'atrasado');
}
function areasDoProjeto(p) {
  return [...new Set((p.tarefas || []).map(t => t.area).filter(Boolean))].join(', ');
}

function renderCalendarPresentationCards() {
  const semPrazo = projetosSemPrazo();
  const atrasados = projetosAtrasados();

  const hostSemPrazo = document.getElementById('cal-presentation-sem-prazo');
  hostSemPrazo.innerHTML = semPrazo.length === 0
    ? '<p class="calendar-presentation-cards-vazio">Nenhum projeto sem prazo. ✅</p>'
    : semPrazo.map(p => {
        const areas = [...new Set((p.tarefas || []).map(t => t.area).filter(Boolean))];
        return `
        <div class="calendar-presentation-card">
          <p class="cpc-nome">${p.nome}${p.chamado ? ' · Chamado ' + p.chamado : ''}</p>
          <p class="cpc-meta">${areas.length ? areas.map(tagArea).join(' ') : 'Sem área definida'}${p.cliente_nome ? ' · Cliente: ' + p.cliente_nome : ''}</p>
        </div>
      `;
      }).join('');

  const hostAtrasados = document.getElementById('cal-presentation-atrasados');
  hostAtrasados.innerHTML = atrasados.length === 0
    ? '<p class="calendar-presentation-cards-vazio">Nenhum projeto atrasado. ✅</p>'
    : atrasados.map(p => {
        const areas = [...new Set((p.tarefas || []).map(t => t.area).filter(Boolean))];
        return `
        <div class="calendar-presentation-card cpc-atrasado">
          <p class="cpc-nome">${p.nome}${p.chamado ? ' · Chamado ' + p.chamado : ''}</p>
          <p class="cpc-meta">${areas.length ? areas.map(tagArea).join(' ') : 'Sem área definida'}${p.data_fim ? ' · Prazo: ' + fmtDate(p.data_fim) : ''}</p>
        </div>
      `;
      }).join('');

  // resumo: quantos atrasados por area, tipo "INTEGRAÇÃO = 5"
  const contagemPorArea = {};
  atrasados.forEach(p => {
    const areas = [...new Set((p.tarefas || []).map(t => t.area).filter(Boolean))];
    areas.forEach(a => { contagemPorArea[a] = (contagemPorArea[a] || 0) + 1; });
  });
  const resumoHost = document.getElementById('cal-presentation-resumo-areas');
  const entradas = Object.entries(contagemPorArea).sort((a, b) => b[1] - a[1]);
  resumoHost.innerHTML = entradas.length === 0
    ? ''
    : entradas.map(([area, qtd]) => {
        const cor = corDaArea(area);
        return `<div class="cal-presentation-resumo-item" style="border-left-color:${cor};">
          <span class="cpr-area" style="color:${cor};">${area.toUpperCase()}</span>
          <span class="cpr-valor">${qtd}</span>
        </div>`;
      }).join('');
}

async function refreshCalendarPresentation() {
  try {
    const projects = await api('/projects');
    state.allProjects = projects;
    state.calendarProjects = projects;
    renderCalendar('cal-presentation-grid', 'cal-presentation-label');
    renderCalendarPresentationCards();
  } catch (err) {
    console.error('[apresentacao] falha ao atualizar dados:', err.message);
  }
}

async function openCalendarPresentation() {
  document.getElementById('calendar-presentation-overlay').classList.remove('hidden');
  await refreshCalendarPresentation();
  mostrarSlidePresentacao(0);
  atualizarCamposConfigApresentacao();

  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  // evita a TV/tela apagar sozinha enquanto o painel estiver aberto (se o navegador suportar)
  if (navigator.wakeLock) {
    try { calPresentationWakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* falha silenciosa */ }
  }
  reiniciarIntervalosApresentacao();
}

function reiniciarIntervalosApresentacao() {
  if (calPresentationInterval) clearInterval(calPresentationInterval);
  calPresentationInterval = setInterval(refreshCalendarPresentation, calPresentationConfig.refreshMin * 60 * 1000);
  if (calPresentationSlideInterval) clearInterval(calPresentationSlideInterval);
  calPresentationSlideInterval = setInterval(proximoSlidePresentacao, calPresentationConfig.slideSeg * 1000);
}

function atualizarCamposConfigApresentacao() {
  document.getElementById('cal-presentation-cfg-refresh').value = calPresentationConfig.refreshMin;
  document.getElementById('cal-presentation-cfg-slide').value = calPresentationConfig.slideSeg;
}

function closeCalendarPresentation() {
  document.getElementById('calendar-presentation-overlay').classList.add('hidden');
  document.getElementById('cal-presentation-config-painel').classList.add('hidden');
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  if (calPresentationInterval) { clearInterval(calPresentationInterval); calPresentationInterval = null; }
  if (calPresentationSlideInterval) { clearInterval(calPresentationSlideInterval); calPresentationSlideInterval = null; }
  if (calPresentationWakeLock) { calPresentationWakeLock.release().catch(() => {}); calPresentationWakeLock = null; }
}

document.getElementById('btn-cal-config-apresentacao').addEventListener('click', () => {
  document.getElementById('cal-presentation-config-painel').classList.toggle('hidden');
});
document.getElementById('btn-cal-config-salvar').addEventListener('click', () => {
  const refreshMin = Math.max(1, Number(document.getElementById('cal-presentation-cfg-refresh').value) || 5);
  const slideSeg = Math.max(5, Number(document.getElementById('cal-presentation-cfg-slide').value) || 15);
  calPresentationConfig = { refreshMin, slideSeg };
  salvarConfigApresentacao(calPresentationConfig);
  reiniciarIntervalosApresentacao();
  document.getElementById('cal-presentation-config-painel').classList.add('hidden');
});

document.querySelectorAll('.cal-presentation-dot').forEach((dot, i) => {
  dot.addEventListener('click', () => {
    mostrarSlidePresentacao(i);
    // reinicia a contagem pra nao trocar de novo logo em seguida do clique manual
    if (calPresentationSlideInterval) clearInterval(calPresentationSlideInterval);
    calPresentationSlideInterval = setInterval(proximoSlidePresentacao, calPresentationConfig.slideSeg * 1000);
  });
});

document.getElementById('btn-cal-apresentacao').addEventListener('click', openCalendarPresentation);
document.getElementById('btn-cal-sair-apresentacao').addEventListener('click', closeCalendarPresentation);
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && !document.getElementById('calendar-presentation-overlay').classList.contains('hidden')) {
    closeCalendarPresentation();
  }
});
document.addEventListener('fullscreenchange', () => {
  // se o usuario sair da tela cheia pelo Esc do navegador, fecha a apresentacao junto
  if (!document.fullscreenElement && !document.getElementById('wbs-presentation-overlay').classList.contains('hidden')) {
    document.getElementById('wbs-presentation-overlay').classList.add('hidden');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('wbs-presentation-overlay').classList.contains('hidden')) {
    closeWbsPresentation();
  }
});

document.getElementById('btn-wbs-novo-item').addEventListener('click', () => openWbsItemModal(null, null));
document.getElementById('btn-wbs-exportar-pdf').addEventListener('click', () => {
  if (!state.currentWbsProject) return;
  window.open(`/api/projects/${state.currentWbsProject.id}/wbs/pdf`, '_blank');
});

document.getElementById('btn-wbs-salvar-modelo').addEventListener('click', async () => {
  if (!state.currentWbsProject) return;
  const nome = prompt('Nome para este modelo (ex: "Implantação PDV padrão"):');
  if (!nome || !nome.trim()) return;
  try {
    await api(`/projects/${state.currentWbsProject.id}/wbs/salvar-modelo`, { method: 'POST', body: JSON.stringify({ nome: nome.trim() }) });
    alert(`Modelo "${nome.trim()}" salvo com sucesso.`);
  } catch (err) {
    alert(err.message);
  }
});

async function renderWbsTemplatesList() {
  const host = document.getElementById('wbs-templates-list');
  let templates;
  try {
    templates = await api('/wbs-templates');
  } catch (err) {
    host.innerHTML = `<p class="muted">${err.message}</p>`;
    return;
  }
  if (templates.length === 0) {
    host.innerHTML = '<p class="muted">Nenhum modelo salvo ainda. Abra a WBS de um projeto já preenchido e use "Salvar como modelo".</p>';
    return;
  }
  host.innerHTML = '';
  templates.forEach(t => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `
      <div class="list-row-main">
        <p class="list-row-name">${t.nome}</p>
        <p class="list-row-sub">${t.total_itens} item(ns)</p>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn" data-usar-modelo>Usar este</button>
        <button class="icon-btn" data-excluir-modelo aria-label="Excluir modelo">✕</button>
      </div>
    `;
    row.querySelector('[data-usar-modelo]').onclick = async () => {
      if (!confirm(`Adicionar os ${t.total_itens} item(ns) do modelo "${t.nome}" a este projeto?`)) return;
      try {
        await api(`/projects/${state.currentWbsProject.id}/wbs/aplicar-modelo`, { method: 'POST', body: JSON.stringify({ template_id: t.id }) });
        document.getElementById('modal-wbs-templates').classList.add('hidden');
        await loadWbsData();
      } catch (err) {
        alert(err.message);
      }
    };
    row.querySelector('[data-excluir-modelo]').onclick = async () => {
      if (!confirm(`Excluir o modelo "${t.nome}"? Isso não afeta os projetos onde ele já foi usado.`)) return;
      try {
        await api(`/wbs-templates/${t.id}`, { method: 'DELETE' });
        await renderWbsTemplatesList();
      } catch (err) {
        alert(err.message);
      }
    };
    host.appendChild(row);
  });
}
document.getElementById('btn-wbs-aplicar-modelo').addEventListener('click', () => {
  document.getElementById('modal-wbs-templates').classList.remove('hidden');
  renderWbsTemplatesList();
});
document.getElementById('btn-close-wbs-templates').addEventListener('click', () => {
  document.getElementById('modal-wbs-templates').classList.add('hidden');
});

function populateWbsAreaSelect() {
  const sel = document.getElementById('wbs-item-area');
  sel.innerHTML = '<option value="">Sem área definida</option>' + state.areas.map(a => `<option value="${a}">${a}</option>`).join('');
}
function populateWbsAcaoSelect() {
  const sel = document.getElementById('wbs-item-acao');
  sel.innerHTML = '<option value="">Sem ação definida</option>' + state.acoes.map(a => `<option value="${a}">${a}</option>`).join('');
}
function populateWbsStatusSelect() {
  const sel = document.getElementById('wbs-item-status');
  sel.innerHTML = state.wbsStatusList.map(s => `<option>${s}</option>`).join('');
}
async function populateWbsResponsavelSelect(valorAtual) {
  const sel = document.getElementById('wbs-item-responsavel');
  let nomes = [];
  try {
    const usuarios = await api('/usuarios/nomes');
    nomes = usuarios.map(u => u.nome);
  } catch (e) {
    // silencioso - segue so com a opcao em branco (e o valor atual, se houver)
  }
  // Se o item ja tinha um responsavel que nao esta mais na lista (ex: pessoa
  // desativada), mantem essa opcao pra nao perder o dado ao editar.
  if (valorAtual && !nomes.includes(valorAtual)) nomes = [valorAtual, ...nomes];
  sel.innerHTML = '<option value="">Sem responsável definido</option>' + nomes.map(n => `<option value="${n}">${n}</option>`).join('');
  sel.value = valorAtual || '';
}

async function openWbsItemModal(parentId, itemToEdit) {
  populateWbsAreaSelect();
  populateWbsAcaoSelect();
  populateWbsStatusSelect();
  document.getElementById('wbs-modal-titulo').textContent = itemToEdit ? 'Editar item' : (parentId ? 'Novo sub-item' : 'Novo item');
  document.getElementById('wbs-item-id').value = itemToEdit ? itemToEdit.id : '';
  document.getElementById('wbs-item-parent-id').value = parentId || '';
  document.getElementById('wbs-item-titulo').value = itemToEdit ? itemToEdit.titulo : '';
  document.getElementById('wbs-item-area').value = itemToEdit ? (itemToEdit.area || '') : '';
  document.getElementById('wbs-item-acao').value = itemToEdit ? (itemToEdit.acao || '') : '';
  await populateWbsResponsavelSelect(itemToEdit ? (itemToEdit.responsavel || '') : '');
  document.getElementById('wbs-item-status').value = itemToEdit ? itemToEdit.status : 'Pendente';
  document.getElementById('wbs-item-inicio').value = itemToEdit ? (itemToEdit.data_inicio || '') : '';
  document.getElementById('wbs-item-fim').value = itemToEdit ? (itemToEdit.data_fim || '') : '';
  document.getElementById('wbs-item-observacao').value = itemToEdit ? (itemToEdit.observacao || '') : '';
  document.getElementById('wbs-item-horas-esforco').value = itemToEdit ? (itemToEdit.horas_esforco || 0) : 0;
  atualizarDuracaoWbsItem();

  const wrap = document.getElementById('wbs-item-priorizacao-wrap');
  const inputsDiv = document.getElementById('wbs-item-priorizacao-inputs');
  const calculadaP = document.getElementById('wbs-item-priorizacao-calculada');
  if (state.wbsPriorizacaoAtiva) {
    wrap.classList.remove('hidden');
    const temFilhos = itemToEdit && itemToEdit.filhos && itemToEdit.filhos.length > 0;
    if (temFilhos) {
      inputsDiv.classList.add('hidden');
      calculadaP.classList.remove('hidden');
      calculadaP.textContent = `Calculado automaticamente pela média dos ${itemToEdit.filhos.length} sub-item(ns): Impacto ${itemToEdit.impactoEfetivo.toFixed(1)} · Esforço ${itemToEdit.esforcoEfetivo.toFixed(1)} · ${itemToEdit.criticidade}`;
    } else {
      inputsDiv.classList.remove('hidden');
      calculadaP.classList.add('hidden');
      document.getElementById('wbs-item-impacto').value = itemToEdit ? (itemToEdit.impacto || 0) : 0;
      document.getElementById('wbs-item-esforco').value = itemToEdit ? (itemToEdit.esforco || 0) : 0;
    }
  } else {
    wrap.classList.add('hidden');
  }

  document.getElementById('modal-wbs-item').classList.remove('hidden');
}
const HORAS_POR_DIA_WBS = 8;
function atualizarDuracaoWbsItem() {
  const horas = Number(document.getElementById('wbs-item-horas-esforco').value) || 0;
  const dias = horas / HORAS_POR_DIA_WBS;
  document.getElementById('wbs-item-duracao-dias').value = horas > 0 ? `${dias.toFixed(1)} dia(s)` : '—';
}
document.getElementById('wbs-item-horas-esforco').addEventListener('input', atualizarDuracaoWbsItem);

document.getElementById('btn-cancel-wbs-item').addEventListener('click', () => {
  document.getElementById('modal-wbs-item').classList.add('hidden');
});
document.getElementById('form-wbs-item').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('wbs-item-id').value;
  const parent_id = document.getElementById('wbs-item-parent-id').value || null;
  const body = {
    titulo: document.getElementById('wbs-item-titulo').value.trim(),
    area: document.getElementById('wbs-item-area').value,
    acao: document.getElementById('wbs-item-acao').value,
    responsavel: document.getElementById('wbs-item-responsavel').value.trim(),
    status: document.getElementById('wbs-item-status').value,
    data_inicio: document.getElementById('wbs-item-inicio').value || null,
    data_fim: document.getElementById('wbs-item-fim').value || null,
    observacao: document.getElementById('wbs-item-observacao').value.trim(),
    impacto: Number(document.getElementById('wbs-item-impacto').value) || 0,
    esforco: Number(document.getElementById('wbs-item-esforco').value) || 0,
    horas_esforco: Number(document.getElementById('wbs-item-horas-esforco').value) || 0,
  };
  if (!body.titulo) {
    alert('Preencha o título do item.');
    return;
  }
  try {
    if (id) {
      await api(`/wbs/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      body.parent_id = parent_id;
      await api(`/projects/${state.currentWbsProject.id}/wbs`, { method: 'POST', body: JSON.stringify(body) });
    }
    document.getElementById('modal-wbs-item').classList.add('hidden');
    await loadWbsData();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Visão da Equipe ----------
function segundaFeiraDe(data) {
  const d = new Date(data);
  const diaSemana = d.getDay(); // 0=domingo
  const diff = diaSemana === 0 ? -6 : 1 - diaSemana;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function isoDate(d) { return d.toISOString().slice(0, 10); }
function diasDoPeriodo(inicio, fim) {
  const dias = [];
  const cursor = new Date(inicio);
  while (cursor <= fim) { dias.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); }
  return dias;
}
const DOWS_CURTOS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

async function refreshEquipe() {
  if (!state.equipeInicio) {
    state.equipeInicio = segundaFeiraDe(new Date());
    state.equipeFim = new Date(state.equipeInicio);
    state.equipeFim.setDate(state.equipeFim.getDate() + 6);
  }
  // A lista de projetos so alimenta o campo opcional "vincular projeto" do formulario
  // de demanda - quem nao tem acesso a Projetos (ex: so tem "Equipe") nao consegue
  // buscar isso, mas o resto da tela (Gantt, KPIs) continua funcionando normalmente.
  try {
    state.equipeProjetosCache = await api('/projects');
  } catch (err) {
    state.equipeProjetosCache = [];
  }
  try {
    await loadEquipeData();
  } catch (err) {
    document.getElementById('equipe-gantt').innerHTML = `<p class="muted">Falha ao carregar: ${err.message}</p>`;
  }
}

async function loadEquipeData() {
  if (!state.equipeInicio) {
    state.equipeInicio = segundaFeiraDe(new Date());
    state.equipeFim = new Date(state.equipeInicio);
    state.equipeFim.setDate(state.equipeFim.getDate() + 6);
  }
  const inicio = isoDate(state.equipeInicio);
  const fim = isoDate(state.equipeFim);
  const data = await api(`/visao-equipe?inicio=${inicio}&fim=${fim}`);
  state.equipeData = data;
  renderEquipePeriodoLabel();
  renderEquipeKpis(data);
  renderEquipeGantt(data);
}

function renderEquipePeriodoLabel() {
  const fmt = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  document.getElementById('equipe-periodo-label').textContent = `${fmt(state.equipeInicio)} — ${fmt(state.equipeFim)}`;
}

function ehFimDeSemanaIso(diaIso) {
  const dow = new Date(diaIso + 'T00:00:00').getDay();
  return dow === 0 || dow === 6;
}
function tarefasNoDia(tarefas, diaIso, turno) {
  const fds = ehFimDeSemanaIso(diaIso);
  return tarefas.filter((t) => {
    const ini = t.data_inicio;
    const fimT = t.data_fim || t.data_inicio;
    if (ini > diaIso || fimT < diaIso) return false;
    // sabado/domingo nao conta como dia de trabalho, a menos que a tarefa seja
    // marcada como excecao (plantao/suporte que realmente roda no fim de semana)
    if (fds && !t.trabalha_fim_semana) return false;
    // se um turno especifico foi pedido (diurno/noturno), filtra so por ele - os
    // dois turnos sao "baldes" de carga separados, nao competem entre si
    if (turno && (t.turno || 'diurno') !== turno) return false;
    return true;
  });
}
// Quebra um intervalo de dias em pedacos so com dias uteis (pulando sabado/domingo),
// a nao ser que a tarefa seja excecao - usado pra desenhar a barra do Gantt "pausada"
// no fim de semana, em vez de continua.
function segmentosUteis(idxIni, idxFim, diasIso, trabalhaFimSemana) {
  if (trabalhaFimSemana) return [{ idxIni, idxFim }];
  const segmentos = [];
  let inicioSegmento = null;
  for (let i = idxIni; i <= idxFim; i++) {
    if (!ehFimDeSemanaIso(diasIso[i])) {
      if (inicioSegmento === null) inicioSegmento = i;
    } else if (inicioSegmento !== null) {
      segmentos.push({ idxIni: inicioSegmento, idxFim: i - 1 });
      inicioSegmento = null;
    }
  }
  if (inicioSegmento !== null) segmentos.push({ idxIni: inicioSegmento, idxFim });
  return segmentos;
}

function renderEquipeKpisEm(targetId, data) {
  const hojeIso = isoDate(new Date());
  const dias = diasDoPeriodo(state.equipeInicio, state.equipeFim).map(isoDate);

  let livresHoje = 0;
  let sobrecarregados = 0;
  let semPrevisao = 0;

  data.implantadores.forEach((imp) => {
    const doDiaHoje = tarefasNoDia(imp.tarefas, hojeIso);
    const cargaHoje = doDiaHoje.reduce((s, t) => s + Number(t.pct_dedicacao || 0), 0);
    if (cargaHoje === 0) livresHoje++;

    let teveSobrecarga = false;
    dias.forEach((diaIso) => {
      const cargaDiurna = tarefasNoDia(imp.tarefas, diaIso, 'diurno').reduce((s, t) => s + Number(t.pct_dedicacao || 0), 0);
      const cargaNoturna = tarefasNoDia(imp.tarefas, diaIso, 'noturno').reduce((s, t) => s + Number(t.pct_dedicacao || 0), 0);
      if (cargaDiurna > 100 || cargaNoturna > 100) teveSobrecarga = true;
    });
    if (teveSobrecarga) sobrecarregados++;

    imp.tarefas.forEach((t) => { if (!t.data_fim) semPrevisao++; });
  });

  document.getElementById(targetId).innerHTML = `
    <div class="equipe-kpi-item"><span class="equipe-kpi-valor">${livresHoje}</span><span class="equipe-kpi-label">Livres hoje</span></div>
    <div class="equipe-kpi-item"><span class="equipe-kpi-valor" style="color:var(--danger);">${sobrecarregados}</span><span class="equipe-kpi-label">Sobrecarregados na semana</span></div>
    <div class="equipe-kpi-item"><span class="equipe-kpi-valor" style="color:var(--warning);">${semPrevisao}</span><span class="equipe-kpi-label">Sem previsão de fim</span></div>
  `;
}
function renderEquipeKpis(data) { renderEquipeKpisEm('equipe-kpis', data); }

function renderEquipeGantt(data) {
  const dias = diasDoPeriodo(state.equipeInicio, state.equipeFim);
  const diasIso = dias.map(isoDate);
  const buscaTexto = (state.equipeBusca || '').trim().toLowerCase();

  const implantadoresFiltrados = data.implantadores.filter((imp) => {
    if (!buscaTexto) return true;
    if (imp.nome.toLowerCase().includes(buscaTexto)) return true;
    return imp.tarefas.some((t) => (t.cliente_nome || '').toLowerCase().includes(buscaTexto));
  });

  const host = document.getElementById('equipe-gantt');
  const scrollHost = document.getElementById('equipe-gantt-scroll');
  const alturaDisponivel = Math.max(200, win_innerHeight() - scrollHost.getBoundingClientRect().top - 55);
  const paginas = paginarImplantadoresPorAltura(implantadoresFiltrados, diasIso, alturaDisponivel);
  if (state.equipePaginaAtual >= paginas.length) state.equipePaginaAtual = 0;
  state.equipeTotalPaginas = paginas.length;

  renderEquipeGanttConteudo(host, paginas[state.equipePaginaAtual] || [], dias, diasIso, false);
  renderEquipePaginacao(paginas.length);
}
function win_innerHeight() { return window.innerHeight; }

function renderEquipePaginacao(totalPaginas) {
  const el = document.getElementById('equipe-paginacao');
  if (!el) return;
  if (totalPaginas <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button class="btn" id="equipe-pagina-anterior" ${state.equipePaginaAtual === 0 ? 'disabled' : ''}>‹ Anterior</button>
    <span class="calendar-label">Página ${state.equipePaginaAtual + 1} de ${totalPaginas}</span>
    <button class="btn" id="equipe-proxima-pagina" ${state.equipePaginaAtual >= totalPaginas - 1 ? 'disabled' : ''}>Próxima ›</button>
  `;
  document.getElementById('equipe-pagina-anterior').addEventListener('click', () => {
    state.equipePaginaAtual = Math.max(0, state.equipePaginaAtual - 1);
    renderEquipeGantt(state.equipeData);
  });
  document.getElementById('equipe-proxima-pagina').addEventListener('click', () => {
    state.equipePaginaAtual = state.equipePaginaAtual + 1;
    renderEquipeGantt(state.equipeData);
  });
}

const ALTURA_BARRA_GANTT = 26, GAP_BARRA_GANTT = 4, PADDING_TRACK_GANTT = 6, ALTURA_NOME_MIN = 46;

function calcularRaiasImplantador(imp, diasIso) {
  const tarefasComIntervalo = imp.tarefas.map((t) => {
    const iniClip = t.data_inicio < diasIso[0] ? diasIso[0] : t.data_inicio;
    const fimT = t.data_fim || t.data_inicio;
    const fimClip = fimT > diasIso[diasIso.length - 1] ? diasIso[diasIso.length - 1] : fimT;
    const idxIni = diasIso.indexOf(iniClip);
    const idxFim = diasIso.indexOf(fimClip);
    return { t, idxIni, idxFim };
  }).filter((x) => x.idxIni !== -1 && x.idxFim !== -1)
    .sort((a, b) => a.idxIni - b.idxIni);

  const fimPorRaia = [];
  tarefasComIntervalo.forEach((x) => {
    let raia = fimPorRaia.findIndex((fimOcupado) => fimOcupado < x.idxIni);
    if (raia === -1) { raia = fimPorRaia.length; }
    fimPorRaia[raia] = x.idxFim;
    x.raia = raia;
  });
  const totalRaias = Math.max(1, fimPorRaia.length);
  const alturaTrack = Math.max(ALTURA_NOME_MIN, totalRaias * (ALTURA_BARRA_GANTT + GAP_BARRA_GANTT) + PADDING_TRACK_GANTT);
  return { tarefasComIntervalo, totalRaias, alturaTrack };
}

// Monta as paginas de implantadores com base no espaco vertical disponivel na tela -
// cada pessoa pode ocupar uma altura diferente (dependendo de quantas tarefas em
// paralelo ela tem), entao a paginacao "empacota" pessoas ate encher o espaco.
function paginarImplantadoresPorAltura(implantadoresFiltrados, diasIso, alturaDisponivel) {
  const alturasLinhas = implantadoresFiltrados.map((imp) => calcularRaiasImplantador(imp, diasIso).alturaTrack + 1);
  const paginas = [];
  let paginaAtual = [];
  let alturaUsada = 0;
  implantadoresFiltrados.forEach((imp, i) => {
    const alturaLinha = alturasLinhas[i];
    if (paginaAtual.length > 0 && alturaUsada + alturaLinha > alturaDisponivel) {
      paginas.push(paginaAtual);
      paginaAtual = [];
      alturaUsada = 0;
    }
    paginaAtual.push(imp);
    alturaUsada += alturaLinha;
  });
  if (paginaAtual.length > 0) paginas.push(paginaAtual);
  return paginas.length > 0 ? paginas : [[]];
}

function renderEquipeGanttConteudo(host, implantadoresDaPagina, dias, diasIso, presentacao) {
  const fimDeSemanaPorDia = dias.map((d) => d.getDay() === 0 || d.getDay() === 6);

  let html = `<div class="equipe-gantt-header" style="display:grid;grid-template-columns:190px repeat(${dias.length},minmax(90px,1fr));min-width:${190 + dias.length * 90}px;">
    <div class="equipe-gantt-cell-header"></div>
    ${dias.map((d, i) => `<div class="equipe-gantt-cell-header${fimDeSemanaPorDia[i] ? ' weekend' : ''}">${DOWS_CURTOS[d.getDay()]} ${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}</div>`).join('')}
  </div>`;

  if (implantadoresDaPagina.length === 0) {
    html += '<p class="muted" style="padding:16px;">Nenhum implantador encontrado.</p>';
  }

  implantadoresDaPagina.forEach((imp) => {
    const diasIsoLocal = diasIso;
    const cargaDiurnaPorDia = diasIsoLocal.map((diaIso) => tarefasNoDia(imp.tarefas, diaIso, 'diurno').reduce((s, t) => s + Number(t.pct_dedicacao || 0), 0));
    const cargaNoturnaPorDia = diasIsoLocal.map((diaIso) => tarefasNoDia(imp.tarefas, diaIso, 'noturno').reduce((s, t) => s + Number(t.pct_dedicacao || 0), 0));
    const { tarefasComIntervalo, alturaTrack } = calcularRaiasImplantador(imp, diasIsoLocal);

    html += `<div class="equipe-gantt-row" style="display:grid;grid-template-columns:190px repeat(${dias.length},minmax(90px,1fr));min-width:${190 + dias.length * 90}px;">
      <div class="equipe-gantt-nome">
        <span>${imp.nome}</span>
        ${presentacao ? '' : `<button type="button" class="icon-btn" data-add-demanda="${imp.id}" data-nome="${imp.nome}" title="Adicionar demanda">+</button>`}
      </div>
      <div class="equipe-gantt-track" style="grid-column: span ${dias.length}; position:relative; display:grid; grid-template-columns:repeat(${dias.length},1fr); min-height:${alturaTrack}px;">
        ${dias.map((d, i) => `<div class="equipe-gantt-dia${fimDeSemanaPorDia[i] ? ' weekend' : ''}"></div>`).join('')}
        ${imp.tarefas.length === 0 ? '<span class="equipe-gantt-livre">Livre no período</span>' : ''}
        ${tarefasComIntervalo.flatMap(({ t, idxIni, idxFim, raia }) => {
          const cargaDoTurno = t.turno === 'noturno' ? cargaNoturnaPorDia : cargaDiurnaPorDia;
          const sobrecarregado = cargaDoTurno.slice(idxIni, idxFim + 1).some((c) => c > 100);
          const semPrevisao = !t.data_fim;
          const ehNoturno = t.turno === 'noturno';
          const cor = sobrecarregado ? 'var(--danger)' : semPrevisao ? '#7C3AED' : ehNoturno ? '#1E1B4B' : (t.tipo === 'wbs' ? '#1B63AC' : t.tipo === 'ausencia' ? '#94a3b8' : '#E0A526');
          const semPrevisaoTag = semPrevisao ? ' (sem previsão)' : '';
          const semPrevisaoIcone = semPrevisao ? '⏳ ' : ehNoturno ? '🌙 ' : '';
          const bordaSemPrevisao = semPrevisao ? 'border:2px dashed #4C1D95;' : '';
          const clicavel = !presentacao && t.tipo !== 'wbs' ? `data-editar-demanda="${t.id}"` : '';
          const top = PADDING_TRACK_GANTT + raia * (ALTURA_BARRA_GANTT + GAP_BARRA_GANTT);
          const titleCompleto = `${t.titulo}${t.cliente_nome ? ' · ' + t.cliente_nome : ''}${t.chamado_numero ? ' · Chamado ' + t.chamado_numero : ''} · ${t.pct_dedicacao}%${semPrevisaoTag}${ehNoturno ? ' · turno noturno' : ''}${t.trabalha_fim_semana ? ' · roda também no fim de semana' : ''}`;
          const segmentos = segmentosUteis(idxIni, idxFim, diasIso, t.trabalha_fim_semana);
          return segmentos.map((seg, idx) => {
            const label = idx === 0 ? `${semPrevisaoIcone}${t.titulo}${t.cliente_nome ? ' · ' + t.cliente_nome : ''} · ${t.pct_dedicacao}%` : '';
            return `<div class="equipe-gantt-barra" style="top:${top}px;height:${ALTURA_BARRA_GANTT}px;left:calc(${(seg.idxIni / dias.length) * 100}% + 2px);width:calc(${((seg.idxFim - seg.idxIni + 1) / dias.length) * 100}% - 4px);background:${cor};${bordaSemPrevisao}${presentacao ? 'cursor:default;' : ''}" ${clicavel} title="${titleCompleto}">${label}</div>`;
          });
        }).join('')}
      </div>
    </div>`;
  });

  host.innerHTML = html;
  if (presentacao) return;

  host.querySelectorAll('[data-add-demanda]').forEach((btn) => {
    btn.addEventListener('click', () => abrirModalDemanda(btn.dataset.addDemanda, btn.dataset.nome, null));
  });
  host.querySelectorAll('[data-editar-demanda]').forEach((barra) => {
    barra.addEventListener('click', () => {
      const id = Number(barra.dataset.editarDemanda);
      let alvo = null, nomeImp = '';
      implantadoresDaPagina.forEach((imp) => {
        const achado = imp.tarefas.find((t) => t.id === id && t.tipo !== 'wbs');
        if (achado) { alvo = achado; nomeImp = imp.nome; }
      });
      if (alvo) abrirModalDemanda(alvo.implantador_id || implantadoresDaPagina.find(i => i.tarefas.includes(alvo)).id, nomeImp, alvo);
    });
  });
}

document.getElementById('equipe-semana-anterior').addEventListener('click', () => {
  state.equipeInicio.setDate(state.equipeInicio.getDate() - 7);
  state.equipeFim.setDate(state.equipeFim.getDate() - 7);
  state.equipePaginaAtual = 0;
  loadEquipeData();
});
document.getElementById('equipe-proxima-semana').addEventListener('click', () => {
  state.equipeInicio.setDate(state.equipeInicio.getDate() + 7);
  state.equipeFim.setDate(state.equipeFim.getDate() + 7);
  state.equipePaginaAtual = 0;
  loadEquipeData();
});
document.getElementById('equipe-hoje').addEventListener('click', () => {
  state.equipeInicio = segundaFeiraDe(new Date());
  state.equipeFim = new Date(state.equipeInicio);
  state.equipeFim.setDate(state.equipeFim.getDate() + 6);
  state.equipePaginaAtual = 0;
  loadEquipeData();
});
document.getElementById('equipe-busca').addEventListener('input', (e) => {
  state.equipeBusca = e.target.value;
  state.equipePaginaAtual = 0;
  if (state.equipeData) renderEquipeGantt(state.equipeData);
});

// ---------- modal de demanda avulsa ----------
// ---------- modo apresentacao da Visao da Equipe (pensado pra TV) ----------
let equipePresentationInterval = null;
let equipePresentationPaginaInterval = null;
let equipePresentationWakeLock = null;
let equipePresentationPaginaAtual = 0;

function carregarConfigEquipePresentacao() {
  try {
    const salvo = JSON.parse(localStorage.getItem('equipePresentationConfig') || '{}');
    return {
      refreshMin: Number(salvo.refreshMin) > 0 ? Number(salvo.refreshMin) : 5,
      paginaSeg: Number(salvo.paginaSeg) > 0 ? Number(salvo.paginaSeg) : 20,
    };
  } catch (e) {
    return { refreshMin: 5, paginaSeg: 20 };
  }
}
function salvarConfigEquipePresentacao(cfg) {
  try { localStorage.setItem('equipePresentationConfig', JSON.stringify(cfg)); } catch (e) { /* segue sem salvar */ }
}
let equipePresentationConfig = carregarConfigEquipePresentacao();

async function abrirEquipePresentacao() {
  document.getElementById('equipe-presentation-overlay').classList.remove('hidden');
  equipePresentationPaginaAtual = 0;
  await refreshEquipePresentacao();

  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  if (navigator.wakeLock) {
    try { equipePresentationWakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* falha silenciosa */ }
  }
  document.getElementById('equipe-presentation-cfg-refresh').value = equipePresentationConfig.refreshMin;
  document.getElementById('equipe-presentation-cfg-pagina').value = equipePresentationConfig.paginaSeg;
  reiniciarIntervalosEquipePresentacao();
}

function reiniciarIntervalosEquipePresentacao() {
  if (equipePresentationInterval) clearInterval(equipePresentationInterval);
  equipePresentationInterval = setInterval(refreshEquipePresentacao, equipePresentationConfig.refreshMin * 60 * 1000);
  if (equipePresentationPaginaInterval) clearInterval(equipePresentationPaginaInterval);
  equipePresentationPaginaInterval = setInterval(avancarPaginaEquipePresentacao, equipePresentationConfig.paginaSeg * 1000);
}

function fecharEquipePresentacao() {
  document.getElementById('equipe-presentation-overlay').classList.add('hidden');
  document.getElementById('equipe-presentation-config-painel').classList.add('hidden');
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  if (equipePresentationInterval) { clearInterval(equipePresentationInterval); equipePresentationInterval = null; }
  if (equipePresentationPaginaInterval) { clearInterval(equipePresentationPaginaInterval); equipePresentationPaginaInterval = null; }
  if (equipePresentationWakeLock) { equipePresentationWakeLock.release().catch(() => {}); equipePresentationWakeLock = null; }
}

async function refreshEquipePresentacao() {
  try {
    if (!state.equipeInicio) {
      state.equipeInicio = segundaFeiraDe(new Date());
      state.equipeFim = new Date(state.equipeInicio);
      state.equipeFim.setDate(state.equipeFim.getDate() + 6);
    }
    const inicio = isoDate(state.equipeInicio);
    const fim = isoDate(state.equipeFim);
    const data = await api(`/visao-equipe?inicio=${inicio}&fim=${fim}`);
    state.equipePresentationData = data;
    const fmt = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    document.getElementById('equipe-presentation-periodo').textContent = `${fmt(state.equipeInicio)} — ${fmt(state.equipeFim)}`;
    renderEquipeKpisEm('equipe-presentation-kpis', data);
    renderPaginaEquipePresentacao();
  } catch (err) {
    document.getElementById('equipe-presentation-gantt').innerHTML = `<p class="muted">Falha ao atualizar: ${err.message}</p>`;
  }
}

function renderPaginaEquipePresentacao() {
  const data = state.equipePresentationData;
  if (!data) return;
  const dias = diasDoPeriodo(state.equipeInicio, state.equipeFim);
  const diasIso = dias.map(isoDate);
  const host = document.getElementById('equipe-presentation-gantt');
  const alturaDisponivel = Math.max(200, window.innerHeight - host.getBoundingClientRect().top - 16);
  const paginas = paginarImplantadoresPorAltura(data.implantadores, diasIso, alturaDisponivel);
  if (equipePresentationPaginaAtual >= paginas.length) equipePresentationPaginaAtual = 0;
  renderEquipeGanttConteudo(host, paginas[equipePresentationPaginaAtual] || [], dias, diasIso, true);
}
function avancarPaginaEquipePresentacao() {
  equipePresentationPaginaAtual++;
  renderPaginaEquipePresentacao();
}

document.getElementById('btn-equipe-apresentacao').addEventListener('click', abrirEquipePresentacao);
document.getElementById('btn-equipe-sair-apresentacao').addEventListener('click', fecharEquipePresentacao);
document.getElementById('btn-equipe-presentation-config').addEventListener('click', () => {
  document.getElementById('equipe-presentation-config-painel').classList.toggle('hidden');
});
document.getElementById('btn-equipe-presentation-config-salvar').addEventListener('click', () => {
  const refreshMin = Math.max(1, Number(document.getElementById('equipe-presentation-cfg-refresh').value) || 5);
  const paginaSeg = Math.max(5, Number(document.getElementById('equipe-presentation-cfg-pagina').value) || 20);
  equipePresentationConfig = { refreshMin, paginaSeg };
  salvarConfigEquipePresentacao(equipePresentationConfig);
  reiniciarIntervalosEquipePresentacao();
  document.getElementById('equipe-presentation-config-painel').classList.add('hidden');
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && !document.getElementById('equipe-presentation-overlay').classList.contains('hidden')) {
    fecharEquipePresentacao();
  }
});

function abrirModalDemanda(implantadorId, implantadorNome, demandaExistente) {
  document.getElementById('demanda-avulsa-titulo').textContent = demandaExistente ? `Editar demanda de ${implantadorNome}` : `Nova demanda para ${implantadorNome}`;
  document.getElementById('demanda-cliente-lista').innerHTML = (state.clientes || []).map((c) => `<option value="${c.nome}"></option>`).join('');
  document.getElementById('demanda-implantador-id').value = implantadorId;
  document.getElementById('demanda-implantador-nome').textContent = `Implantador: ${implantadorNome}`;
  document.getElementById('demanda-id').value = demandaExistente ? demandaExistente.id : '';
  document.getElementById('demanda-titulo').value = demandaExistente ? demandaExistente.titulo : '';
  document.getElementById('demanda-cliente').value = demandaExistente ? demandaExistente.cliente_nome || '' : '';
  document.getElementById('demanda-chamado').value = demandaExistente ? demandaExistente.chamado_numero || '' : '';
  document.getElementById('demanda-inicio').value = demandaExistente ? demandaExistente.data_inicio : isoDate(new Date());
  document.getElementById('demanda-fim').value = demandaExistente ? (demandaExistente.data_fim || '') : '';
  document.getElementById('demanda-horas').value = demandaExistente ? demandaExistente.horas_esforco || '' : '';
  document.getElementById('demanda-pct').value = demandaExistente ? demandaExistente.pct_dedicacao : 100;
  document.getElementById('demanda-trabalha-fds').checked = demandaExistente ? !!demandaExistente.trabalha_fim_semana : false;
  document.getElementById('btn-excluir-demanda').classList.toggle('hidden', !demandaExistente);

  const selectProjeto = document.getElementById('demanda-projeto');
  selectProjeto.innerHTML = '<option value="">Nenhum</option>' + (state.equipeProjetosCache || []).map((p) => `<option value="${p.id}">${p.nome}${p.chamado ? ' · ' + p.chamado : ''}</option>`).join('');
  selectProjeto.value = demandaExistente && demandaExistente.projeto_id ? demandaExistente.projeto_id : '';

  const tipoAtual = demandaExistente ? demandaExistente.tipo : 'demanda';
  document.getElementById('demanda-tipo-demanda').classList.toggle('active-tipo', tipoAtual === 'demanda');
  document.getElementById('demanda-tipo-ausencia').classList.toggle('active-tipo', tipoAtual === 'ausencia');
  document.getElementById('form-demanda-avulsa').dataset.tipo = tipoAtual;

  const turnoAtual = demandaExistente ? (demandaExistente.turno || 'diurno') : 'diurno';
  document.getElementById('demanda-turno-diurno').classList.toggle('active-tipo', turnoAtual === 'diurno');
  document.getElementById('demanda-turno-noturno').classList.toggle('active-tipo', turnoAtual === 'noturno');
  document.getElementById('form-demanda-avulsa').dataset.turno = turnoAtual;

  document.getElementById('modal-demanda-avulsa').classList.remove('hidden');
}
document.getElementById('demanda-tipo-demanda').addEventListener('click', () => {
  document.getElementById('form-demanda-avulsa').dataset.tipo = 'demanda';
  document.getElementById('demanda-tipo-demanda').classList.add('active-tipo');
  document.getElementById('demanda-tipo-ausencia').classList.remove('active-tipo');
});
document.getElementById('demanda-tipo-ausencia').addEventListener('click', () => {
  document.getElementById('form-demanda-avulsa').dataset.tipo = 'ausencia';
  document.getElementById('demanda-tipo-ausencia').classList.add('active-tipo');
  document.getElementById('demanda-tipo-demanda').classList.remove('active-tipo');
});
document.getElementById('demanda-turno-diurno').addEventListener('click', () => {
  document.getElementById('form-demanda-avulsa').dataset.turno = 'diurno';
  document.getElementById('demanda-turno-diurno').classList.add('active-tipo');
  document.getElementById('demanda-turno-noturno').classList.remove('active-tipo');
});
document.getElementById('demanda-turno-noturno').addEventListener('click', () => {
  document.getElementById('form-demanda-avulsa').dataset.turno = 'noturno';
  document.getElementById('demanda-turno-noturno').classList.add('active-tipo');
  document.getElementById('demanda-turno-diurno').classList.remove('active-tipo');
});
document.getElementById('btn-cancel-demanda-avulsa').addEventListener('click', () => {
  document.getElementById('modal-demanda-avulsa').classList.add('hidden');
});
document.getElementById('form-demanda-avulsa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('demanda-id').value;
  const payload = {
    implantador_id: Number(document.getElementById('demanda-implantador-id').value),
    titulo: document.getElementById('demanda-titulo').value.trim(),
    cliente_nome: document.getElementById('demanda-cliente').value.trim(),
    chamado_numero: document.getElementById('demanda-chamado').value.trim(),
    data_inicio: document.getElementById('demanda-inicio').value,
    data_fim: document.getElementById('demanda-fim').value || null,
    horas_esforco: Number(document.getElementById('demanda-horas').value) || 0,
    pct_dedicacao: Number(document.getElementById('demanda-pct').value),
    tipo: document.getElementById('form-demanda-avulsa').dataset.tipo || 'demanda',
    project_id: document.getElementById('demanda-projeto').value || null,
    trabalha_fim_semana: document.getElementById('demanda-trabalha-fds').checked,
    turno: document.getElementById('form-demanda-avulsa').dataset.turno || 'diurno',
    status: 'Pendente',
  };
  try {
    if (id) {
      await api(`/demandas-avulsas/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/demandas-avulsas', { method: 'POST', body: JSON.stringify(payload) });
    }
    document.getElementById('modal-demanda-avulsa').classList.add('hidden');
    await loadEquipeData();
  } catch (err) {
    alert(err.message);
  }
});
document.getElementById('btn-excluir-demanda').addEventListener('click', async () => {
  const id = document.getElementById('demanda-id').value;
  if (!id) return;
  if (!confirm('Excluir essa demanda?')) return;
  try {
    await api(`/demandas-avulsas/${id}`, { method: 'DELETE' });
    document.getElementById('modal-demanda-avulsa').classList.add('hidden');
    await loadEquipeData();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Implantadores admin ----------
function renderImplantadorList() {
  const el = document.getElementById('implantador-list');
  if (!el) return;
  el.innerHTML = '';
  (state.implantadores || []).forEach(i => {
    const row = document.createElement('div');
    row.className = 'list-row';
    row.innerHTML = `<span${i.ativo ? '' : ' style="text-decoration:line-through;color:var(--text-muted);"'}>${i.nome}</span>
      <span class="toolbar" style="gap:6px;">
        <button class="btn" data-toggle>${i.ativo ? 'Desativar' : 'Ativar'}</button>
        <button class="icon-btn" aria-label="Remover implantador">✕</button>
      </span>`;
    row.querySelector('[data-toggle]').onclick = async () => {
      try {
        await api(`/implantadores/${i.id}`, { method: 'PUT', body: JSON.stringify({ nome: i.nome, ativo: !i.ativo }) });
        await refreshImplantadores();
      } catch (err) {
        alert(err.message);
      }
    };
    row.querySelector('.icon-btn').onclick = async () => {
      if (!confirm(`Excluir "${i.nome}"? As demandas avulsas dele também serão apagadas.`)) return;
      try {
        await api(`/implantadores/${i.id}`, { method: 'DELETE' });
        await refreshImplantadores();
      } catch (err) {
        alert(err.message);
      }
    };
    el.appendChild(row);
  });
}
async function refreshImplantadores() {
  state.implantadores = await api('/implantadores');
  renderImplantadorList();
}
document.getElementById('form-implantador').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('implantador-nome');
  if (!input.value.trim()) return;
  try {
    await api('/implantadores', { method: 'POST', body: JSON.stringify({ nome: input.value.trim() }) });
    input.value = '';
    await refreshImplantadores();
  } catch (err) {
    alert(err.message);
  }
});

// ---------- Calendario Semanal (Dashboard) ----------
async function refreshSemanal() {
  if (!state.semanalInicio) {
    state.semanalInicio = segundaFeiraDe(new Date());
    state.semanalFim = new Date(state.semanalInicio);
    state.semanalFim.setDate(state.semanalFim.getDate() + 6);
  }
  await loadSemanalData();
}

async function loadSemanalData() {
  const inicio = isoDate(state.semanalInicio);
  const fim = isoDate(state.semanalFim);
  try {
    const data = await api(`/wbs-calendario?inicio=${inicio}&fim=${fim}`);
    state.semanalData = data;
    const fmt = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    document.getElementById('semanal-periodo-label').textContent = `${fmt(state.semanalInicio)} — ${fmt(state.semanalFim)}`;
    renderSemanalGantt();
  } catch (err) {
    document.getElementById('semanal-gantt').innerHTML = `<p class="muted">Falha ao carregar: ${err.message}</p>`;
  }
}

function filtrarProjetosSemanal(projetos, busca) {
  if (!busca) return projetos;
  const b = busca.toLowerCase();
  return projetos.map(p => {
    const projetoBate = (p.nome || '').toLowerCase().includes(b) || (p.cliente_nome || '').toLowerCase().includes(b) || (p.chamado || '').toLowerCase().includes(b);
    const itens = projetoBate ? p.itens : p.itens.filter(it => (it.area || '').toLowerCase().includes(b) || (it.responsavel || '').toLowerCase().includes(b));
    return { ...p, itens };
  }).filter(p => p.itens.length > 0);
}

const ALTURA_HEADER_PROJETO_SEMANAL = 34, ALTURA_LINHA_TAREFA_SEMANAL = 40;

function paginarProjetosSemanalPorAltura(projetos, alturaDisponivel) {
  const paginas = [];
  let paginaAtual = [];
  let alturaUsada = 0;
  projetos.forEach((p) => {
    const alturaBloco = ALTURA_HEADER_PROJETO_SEMANAL + p.itens.length * ALTURA_LINHA_TAREFA_SEMANAL;
    if (paginaAtual.length > 0 && alturaUsada + alturaBloco > alturaDisponivel) {
      paginas.push(paginaAtual);
      paginaAtual = [];
      alturaUsada = 0;
    }
    paginaAtual.push(p);
    alturaUsada += alturaBloco;
  });
  if (paginaAtual.length > 0) paginas.push(paginaAtual);
  return paginas.length > 0 ? paginas : [[]];
}

function renderSemanalGantt() {
  const data = state.semanalData;
  if (!data) return;
  const dias = diasDoPeriodo(state.semanalInicio, state.semanalFim);
  const diasIso = dias.map(isoDate);
  const fimDeSemanaPorDia = dias.map((d) => d.getDay() === 0 || d.getDay() === 6);

  const projetosFiltrados = filtrarProjetosSemanal(data.projetos, (state.semanalBusca || '').trim());

  const host = document.getElementById('semanal-gantt');
  const scrollHost = document.getElementById('semanal-gantt-scroll');
  const alturaDisponivel = Math.max(200, window.innerHeight - scrollHost.getBoundingClientRect().top - 55);
  const paginas = paginarProjetosSemanalPorAltura(projetosFiltrados, alturaDisponivel);
  if (!(state.semanalPaginaAtual >= 0) || state.semanalPaginaAtual >= paginas.length) state.semanalPaginaAtual = 0;
  const projetosDaPagina = paginas[state.semanalPaginaAtual] || [];

  let html = `<div class="equipe-gantt-header" style="display:grid;grid-template-columns:230px repeat(${dias.length},minmax(90px,1fr));min-width:${230 + dias.length * 90}px;">
    <div class="equipe-gantt-cell-header"></div>
    ${dias.map((d, i) => `<div class="equipe-gantt-cell-header${fimDeSemanaPorDia[i] ? ' weekend' : ''}">${DOWS_CURTOS[d.getDay()]} ${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}</div>`).join('')}
  </div>`;

  if (projetosDaPagina.length === 0) {
    html += '<p class="muted" style="padding:16px;">Nenhum projeto com entrega nessa semana.</p>';
  }

  projetosDaPagina.forEach((p) => {
    html += `<div style="display:grid;grid-template-columns:230px repeat(${dias.length},minmax(90px,1fr));min-width:${230 + dias.length * 90}px;border-top:1px solid var(--border);">
      <div style="padding:8px 10px 8px 6px;font-weight:700;font-size:13px;grid-column:1/-1;background:var(--surface-alt);">
        ${p.nome}${p.chamado ? ' · ' + p.chamado : ''}${p.cliente_nome ? ' · ' + p.cliente_nome : '' }
      </div>
    </div>`;
    p.itens.forEach((it) => {
      const iniClip = it.data_inicio < diasIso[0] ? diasIso[0] : it.data_inicio;
      const fimT = it.data_fim;
      const fimClip = fimT > diasIso[diasIso.length - 1] ? diasIso[diasIso.length - 1] : fimT;
      const idxIni = diasIso.indexOf(iniClip);
      const idxFim = diasIso.indexOf(fimClip);
      const cor = corDaArea(it.area);
      html += `<div class="equipe-gantt-row" style="display:grid;grid-template-columns:230px repeat(${dias.length},minmax(90px,1fr));min-width:${230 + dias.length * 90}px;">
        <div class="equipe-gantt-nome" style="font-size:12.5px;">
          <span title="${it.titulo}">${it.titulo}${it.responsavel ? ' · ' + it.responsavel : ''}</span>
        </div>
        <div class="equipe-gantt-track" style="grid-column: span ${dias.length}; position:relative; display:grid; grid-template-columns:repeat(${dias.length},1fr); min-height:${ALTURA_LINHA_TAREFA_SEMANAL}px;">
          ${dias.map((d, i) => `<div class="equipe-gantt-dia${fimDeSemanaPorDia[i] ? ' weekend' : ''}"></div>`).join('')}
          ${idxIni !== -1 && idxFim !== -1 ? `<div class="equipe-gantt-barra" style="top:7px;height:26px;left:calc(${(idxIni / dias.length) * 100}% + 2px);width:calc(${((idxFim - idxIni + 1) / dias.length) * 100}% - 4px);background:${cor};" title="${it.titulo}${it.area ? ' · ' + it.area : ''}${it.responsavel ? ' · ' + it.responsavel : ''} · ${it.status}">${it.area || it.titulo}</div>` : ''}
        </div>
      </div>`;
    });
  });

  host.innerHTML = html;
  renderSemanalPaginacao(paginas.length);
}

function renderSemanalPaginacao(totalPaginas) {
  const el = document.getElementById('semanal-paginacao');
  if (totalPaginas <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button class="btn" id="semanal-pagina-anterior" ${state.semanalPaginaAtual === 0 ? 'disabled' : ''}>‹ Anterior</button>
    <span class="calendar-label">Página ${state.semanalPaginaAtual + 1} de ${totalPaginas}</span>
    <button class="btn" id="semanal-proxima-pagina" ${state.semanalPaginaAtual >= totalPaginas - 1 ? 'disabled' : ''}>Próxima ›</button>
  `;
  document.getElementById('semanal-pagina-anterior').addEventListener('click', () => {
    state.semanalPaginaAtual = Math.max(0, state.semanalPaginaAtual - 1);
    renderSemanalGantt();
  });
  document.getElementById('semanal-proxima-pagina').addEventListener('click', () => {
    state.semanalPaginaAtual++;
    renderSemanalGantt();
  });
}

document.getElementById('semanal-anterior').addEventListener('click', () => {
  state.semanalInicio.setDate(state.semanalInicio.getDate() - 7);
  state.semanalFim.setDate(state.semanalFim.getDate() - 7);
  state.semanalPaginaAtual = 0;
  loadSemanalData();
});
document.getElementById('semanal-proxima').addEventListener('click', () => {
  state.semanalInicio.setDate(state.semanalInicio.getDate() + 7);
  state.semanalFim.setDate(state.semanalFim.getDate() + 7);
  state.semanalPaginaAtual = 0;
  loadSemanalData();
});
document.getElementById('semanal-hoje').addEventListener('click', () => {
  state.semanalInicio = segundaFeiraDe(new Date());
  state.semanalFim = new Date(state.semanalInicio);
  state.semanalFim.setDate(state.semanalFim.getDate() + 6);
  state.semanalPaginaAtual = 0;
  loadSemanalData();
});
document.getElementById('semanal-busca').addEventListener('input', (e) => {
  state.semanalBusca = e.target.value;
  state.semanalPaginaAtual = 0;
  if (state.semanalData) renderSemanalGantt();
});
