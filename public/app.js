const state = {
  areas: [],
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
  autorNome: '',
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
  if (progresso < 30) return 'var(--danger)';
  if (progresso < 70) return 'var(--warning)';
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
    }
    throw new Error(err.error || 'falha na requisicao');
  }
  return res.status === 204 ? null : res.json();
}

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

// ---------- tabs ----------
function activateTab(btn) {
  document.querySelectorAll('.sidebar-nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('view-projetos').classList.toggle('hidden', btn.dataset.tab !== 'projetos');
  document.getElementById('view-dashboard').classList.toggle('hidden', btn.dataset.tab !== 'dashboard');
  document.getElementById('view-admin').classList.toggle('hidden', btn.dataset.tab !== 'admin');
  if (btn.dataset.tab === 'dashboard') renderDashboard();
  if (btn.dataset.tab === 'admin') renderAuditLog();
}
document.querySelectorAll('.sidebar-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.tab === 'admin' && !state.isAdmin) {
      requestAdminLogin(() => activateTab(btn));
      return;
    }
    activateTab(btn);
  });
});

// ---------- load all data ----------
async function loadAll() {
  loadAdminSession();
  const [areas, gps, adminEmails, emailConfig, clientes, settings] = await Promise.all([
    api('/areas'),
    api('/gps'),
    api('/admin-emails'),
    api('/email-config'),
    api('/clientes'),
    api('/settings'),
  ]);
  state.areas = areas;
  state.gps = gps;
  state.adminEmails = adminEmails;
  state.emailConfig = emailConfig;
  state.clientes = clientes;
  state.settings = settings;

  await refreshProjects();

  renderAreaFilters();
  renderGpFilters();
  renderAreaList();
  renderGpList();
  renderAdminList();
  renderEmailConfig();
  renderPermissoes();
  populateGpSelect();
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
    const open = state.expanded[p.id];
    const alertasDep = calcularAlertasDependencia(p);
    const alertaHtml = alertasDep.length > 0
      ? `<div class="dependency-alert" style="margin-bottom:10px;"><span class="dependency-alert-icon">⚠️</span><span>${alertasDep.join('<br>')}</span></div>`
      : '';
    const elapsed = elapsedPercent(p.data_inicio, p.data_fim);
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
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="badge ${statusClass(p.status_prazo)}">prazo: ${p.status_prazo}</span>
          <button class="icon-btn" data-edit-project aria-label="Editar projeto">✎</button>
          <button class="icon-btn" data-delete-project aria-label="Excluir projeto">🗑</button>
        </div>
      </div>
      ${alertaHtml}
      <p class="card-resumo">${p.resumo || ''}</p>
      <div class="chip-row" style="margin-bottom:8px;">${areaTagsHtml}</div>
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
  if (!semDatas) {
    const incompletas = areasSel.filter(a => !state.newProjectAreas[a].inicio || !state.newProjectAreas[a].fim);
    if (incompletas.length > 0) {
      alert('Defina início e fim da tarefa para: ' + incompletas.join(', ') + ' (ou marque "Ainda não tenho as datas").');
      return;
    }
  }

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

loadAll();
