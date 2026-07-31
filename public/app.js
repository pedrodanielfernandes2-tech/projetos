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
  const token = localStorage.getItem('usuarioToken');
  const infoRaw = localStorage.getItem('usuarioInfo');
  if (token && infoRaw) {
    try {
      state.usuarioToken = token;
      state.usuario = JSON.parse(infoRaw);
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
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
  mostrarPortaoLogin();
}
document.getElementById('btn-logout').addEventListener('click', logout);

async function aposLogin() {
  esconderPortaoLogin();
  aplicarPermissoesMenu();
  if (state.usuario.pode_projetos) {
    await loadAll();
  } else {
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

async function requestAdminLogin(onSuccess) {
  const senha = prompt('Digite a senha de administrador:');
  if (senha === null || senha === '') return;
  state.adminPassword = senha;
  try {
    await api('/admin/login', { method: 'POST', body: JSON.stringify({ senha }) });
    state.isAdmin = true;
    sessionStorage.setItem('adminPassword', senha);
    if (onSuccess) onSuccess();
  } catch (err) {
    alert('Senha incorreta.');
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
  const senha = prompt('Digite a senha de acesso ao Chamados:');
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
  } catch (err) {
    alert('Senha incorreta.');
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
  if (btn.dataset.tab === 'admin') { renderAuditLog(); refreshUsuarios(); }
  if (btn.dataset.tab === 'implantacao') refreshImplantacao();
}
document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
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
}
document.getElementById('search-projetos').addEventListener('input', (e) => {
  state.searchText = e.target.value.trim();
  applyProjectFilters();
});
document.getElementById('sort-projetos').addEventListener('change', (e) => {
  state.sortBy = e.target.value;
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
    if (statusAtencao === 'atrasado' && p.data_fim) {
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const fim = new Date(p.data_fim + 'T00:00:00');
      const diff = Math.floor((hoje - fim) / (1000 * 60 * 60 * 24));
      if (diff > 0) diasAtraso = diff;
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
          ${diasAtraso ? `<span class="dias-atraso-tag">${diasAtraso} dia${diasAtraso > 1 ? 's' : ''} de atraso</span>` : ''}
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
    p.historico.forEach(h => {
      const row = document.createElement('div');
      row.className = 'hist-row';
      row.innerHTML = `<span class="hist-date">${fmtDateFull(h.data)}</span> — ${h.texto}`;
      histHost.appendChild(row);
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
function renderEmailConfig() {
  const c = state.emailConfig;
  document.getElementById('cfg-frequencia').value = c.frequencia;
  document.getElementById('cfg-dia-semana').value = c.dia_semana;
  document.getElementById('cfg-enviar-gps').checked = !!c.enviar_gps;
  document.getElementById('cfg-enviar-admins').checked = !!c.enviar_admins;
  document.getElementById('cfg-enviar-teams').checked = !!c.enviar_teams;
}
document.getElementById('form-email-config').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    frequencia: document.getElementById('cfg-frequencia').value,
    dia_semana: Number(document.getElementById('cfg-dia-semana').value),
    hora: 8,
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
  let usuarios;
  try {
    usuarios = await api('/usuarios');
  } catch (err) {
    host.innerHTML = `<p class="muted">${err.message}</p>`;
    return;
  }
  if (usuarios.length === 0) {
    host.innerHTML = '<p class="muted">Nenhum usuário cadastrado ainda.</p>';
    return;
  }
  host.innerHTML = '';
  usuarios.forEach(u => {
    const row = document.createElement('div');
    row.className = 'list-row';
    const menus = [u.pode_projetos ? 'Projetos' : null, u.pode_implantacao ? 'Implantação' : null].filter(Boolean).join(', ') || 'nenhum menu liberado';
    row.innerHTML = `
      <div class="list-row-main">
        <p class="list-row-name">${u.nome}${!u.ativo ? ' <span style="color:var(--danger);font-weight:400;">(inativo)</span>' : ''}</p>
        <p class="list-row-sub">${u.email} · ${menus} · ${u.senha_definida ? 'senha definida' : '⏳ aguardando definir senha'}</p>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${!u.senha_definida ? '<button class="btn" data-reenviar>Reenviar convite</button>' : ''}
        <button class="btn" data-definir-senha>${u.senha_definida ? 'Redefinir senha' : 'Definir senha agora'}</button>
        <button class="btn" data-alternar-ativo>${u.ativo ? 'Desativar' : 'Reativar'}</button>
        <button class="icon-btn" data-excluir-usuario aria-label="Excluir usuário">✕</button>
      </div>
    `;
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

document.getElementById('form-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = document.getElementById('usuario-nome').value.trim();
  const email = document.getElementById('usuario-email').value.trim();
  const senha = document.getElementById('usuario-senha').value;
  const pode_projetos = document.getElementById('usuario-pode-projetos').checked;
  const pode_implantacao = document.getElementById('usuario-pode-implantacao').checked;
  if (!nome || !email) return;
  if (senha && senha.length < 6) {
    alert('A senha precisa ter pelo menos 6 caracteres (ou deixe em branco pra convidar por e-mail).');
    return;
  }
  try {
    const body = { nome, email, pode_projetos, pode_implantacao };
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

function renderCalendar() {
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  document.getElementById('cal-label').textContent = `${monthNames[state.calendarMonth]} ${state.calendarYear}`;

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
    const visiveis = itens.slice(0, 3);
    const extra = itens.length - visiveis.length;
    html += `
      <div class="calendar-day${isHoje ? ' today' : ''}${itens.length > 0 ? ' has-items' : ''}" data-dia="${dia}">
        <span class="calendar-day-num">${dia}</span>
        ${visiveis.map(it => `<span class="calendar-item badge ${statusClass(it.status)}" title="${it.area} — ${it.nome} (${it.status})">${it.area}${it.chamado ? ' · ' + it.chamado : ''}</span>`).join('')}
        ${extra > 0 ? `<span class="calendar-more">+${extra} mais</span>` : ''}
      </div>
    `;
  }
  document.getElementById('cal-grid').innerHTML = html;

  document.querySelectorAll('.calendar-day[data-dia]').forEach(cell => {
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

  // calendario de entregas
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

function buildImplantacaoItemRow(item) {
  const row = document.createElement('div');
  row.className = 'detail-row';
  const prazoStatus = wbsPrazoStatus(item);
  const prazoIcone = prazoStatus === 'atrasado' ? '⚠️ ' : prazoStatus === 'risco' ? '⏳ ' : '';
  const prazoTexto = (item.data_inicio || item.data_fim)
    ? ` <span style="color:var(--text-muted);font-size:11.5px;">(${item.data_inicio ? fmtDate(item.data_inicio) : '?'} → ${item.data_fim ? fmtDate(item.data_fim) : '?'})</span>`
    : '';
  row.innerHTML = `
    <span style="flex:1;">${prazoIcone}${item.titulo}${prazoTexto}</span>
    <span class="badge ${wbsStatusClass(item.status)}">${item.status}</span>
    <div style="display:flex;gap:4px;flex-wrap:wrap;">
      <button class="btn" data-status="Em Andamento" style="font-size:11px;padding:4px 8px;">▶ Iniciar</button>
      <button class="btn" data-status="Suspensa" style="font-size:11px;padding:4px 8px;">⚠ Impeditivo</button>
      <button class="btn" data-status="Concluído" style="font-size:11px;padding:4px 8px;">✓ Concluir</button>
      <button class="icon-btn" data-editar-item aria-label="Editar item">✎</button>
      <button class="icon-btn" data-excluir-item aria-label="Excluir item">✕</button>
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
        await api(`/implantacao/itens/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.status }) });
        await refreshImplantacao();
      } catch (err) {
        alert(err.message);
      }
    };
  });
  row.querySelector('[data-editar-item]').onclick = () => openImplantacaoItemModal(item.project_id, item);
  row.querySelector('[data-excluir-item]').onclick = async () => {
    if (!confirm(`Excluir o item "${item.titulo}"?`)) return;
    try {
      await api(`/implantacao/itens/${item.id}`, { method: 'DELETE' });
      await refreshImplantacao();
    } catch (err) {
      alert(err.message);
    }
  };
  return row;
}

function openImplantacaoItemModal(projectId, itemToEdit) {
  document.getElementById('implantacao-item-modal-titulo').textContent = itemToEdit ? 'Editar item' : 'Novo item';
  document.getElementById('implantacao-item-id').value = itemToEdit ? itemToEdit.id : '';
  document.getElementById('implantacao-item-project-id').value = projectId;
  document.getElementById('implantacao-item-titulo-input').value = itemToEdit ? itemToEdit.titulo : '';
  document.getElementById('implantacao-item-status').value = itemToEdit ? itemToEdit.status : 'Pendente';
  document.getElementById('implantacao-item-inicio').value = itemToEdit ? (itemToEdit.data_inicio || '') : '';
  document.getElementById('implantacao-item-fim').value = itemToEdit ? (itemToEdit.data_fim || '') : '';
  document.getElementById('implantacao-item-observacao').value = itemToEdit ? (itemToEdit.observacao || '') : '';
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
  const body = {
    titulo: document.getElementById('implantacao-item-titulo-input').value.trim(),
    status: document.getElementById('implantacao-item-status').value,
    data_inicio: document.getElementById('implantacao-item-inicio').value || null,
    data_fim: document.getElementById('implantacao-item-fim').value || null,
    observacao: document.getElementById('implantacao-item-observacao').value.trim(),
  };
  if (!body.titulo) {
    alert('Preencha o que precisa ser feito.');
    return;
  }
  try {
    if (id) {
      await api(`/implantacao/itens/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    } else {
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
  row.style.paddingLeft = (depth * 26 + 10) + 'px';

  const temPrazo = item.data_inicio || item.data_fim;
  const prazoStatus = wbsPrazoStatus(item);
  const prazoIcone = prazoStatus === 'atrasado' ? '⚠️ ' : prazoStatus === 'risco' ? '⏳ ' : '';
  if (prazoStatus === 'atrasado') row.classList.add('wbs-row-atrasado');
  else if (prazoStatus === 'risco') row.classList.add('wbs-row-risco');

  row.innerHTML = `
    <span class="wbs-pres-numero">${item.numero}</span>
    <span class="wbs-pres-titulo">${item.titulo}</span>
    ${item.area ? `<span class="area-tag">${item.area}</span>` : ''}
    ${item.acao ? `<span class="wbs-tag-acao">${item.acao}</span>` : ''}
    ${item.responsavel ? `<span class="wbs-pres-responsavel">👤 ${item.responsavel}</span>` : ''}
    ${temPrazo ? `<span class="wbs-pres-datas">${prazoIcone}${item.data_inicio ? fmtDate(item.data_inicio) : '?'} → ${item.data_fim ? fmtDate(item.data_fim) : '?'}</span>` : ''}
    <span class="badge ${wbsStatusClass(item.status)}">${item.status}</span>
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
    nomes = await api('/usuarios/implantadores');
  } catch (e) {
    // silencioso - segue so com a opcao em branco (e o valor atual, se houver)
  }
  // Se o item ja tinha um responsavel que nao esta mais na lista de implantadores
  // ativos (ex: pessoa desativada), mantem essa opcao pra nao perder o dado ao editar.
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
