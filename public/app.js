const state = {
  areas: [],
  projects: [],
  gps: [],
  adminEmails: [],
  clientes: [],
  activeFilter: null,
  expanded: {}, // projectId -> 'tarefas' | 'historico' | null
  newProjectAreas: {}, // area -> {inicio, fim}
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
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'erro desconhecido' }));
    throw new Error(err.error || 'falha na requisicao');
  }
  return res.status === 204 ? null : res.json();
}

// ---------- tabs ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-projetos').classList.toggle('hidden', btn.dataset.tab !== 'projetos');
    document.getElementById('view-admin').classList.toggle('hidden', btn.dataset.tab !== 'admin');
  });
});

// ---------- load all data ----------
async function loadAll() {
  const [areas, projects, gps, adminEmails, emailConfig, clientes] = await Promise.all([
    api('/areas'),
    api('/projects'),
    api('/gps'),
    api('/admin-emails'),
    api('/email-config'),
    api('/clientes'),
  ]);
  state.areas = areas;
  state.projects = projects;
  state.gps = gps;
  state.adminEmails = adminEmails;
  state.emailConfig = emailConfig;
  state.clientes = clientes;
  renderStats();
  renderAreaFilters();
  renderProjectList();
  renderAreaList();
  renderGpList();
  renderAdminList();
  renderEmailConfig();
  populateGpSelect();
  renderNewProjectAreaChips();
  renderClienteList();
  populateClienteSelect();
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
  const el = document.getElementById('stats-grid');
  el.innerHTML = `
    <div class="stat-card"><p class="stat-label">Projetos ativos</p><p class="stat-value">${total}</p></div>
    <div class="stat-card"><p class="stat-label">Prazo atrasado</p><p class="stat-value" style="color:var(--danger)">${atrasados}</p></div>
    <div class="stat-card"><p class="stat-label">Bloqueados</p><p class="stat-value" style="color:var(--warning)">${bloqueados}</p></div>
    <div class="stat-card"><p class="stat-label">GPs cadastrados</p><p class="stat-value">${state.gps.length}</p></div>
  `;
}

// ---------- area filters ----------
function renderAreaFilters() {
  const el = document.getElementById('area-filters');
  el.innerHTML = '';
  const allChip = document.createElement('button');
  allChip.className = 'chip' + (state.activeFilter ? '' : ' selected');
  allChip.textContent = 'Todas';
  allChip.onclick = () => { state.activeFilter = null; renderAreaFilters(); loadProjectsFiltered(); };
  el.appendChild(allChip);
  state.areas.forEach(a => {
    const chip = document.createElement('button');
    chip.className = 'chip' + (state.activeFilter === a ? ' selected' : '');
    chip.textContent = a;
    chip.onclick = () => { state.activeFilter = state.activeFilter === a ? null : a; renderAreaFilters(); loadProjectsFiltered(); };
    el.appendChild(chip);
  });
}
async function loadProjectsFiltered() {
  state.projects = await api('/projects' + (state.activeFilter ? '?area=' + encodeURIComponent(state.activeFilter) : ''));
  renderProjectList();
  renderStats();
}

// ---------- project list ----------
function statusClass(s) {
  return 'badge-' + slug(s || 'planejamento');
}
function renderProjectList() {
  const el = document.getElementById('project-list');
  el.innerHTML = '';
  if (state.projects.length === 0) {
    el.innerHTML = '<p class="muted">Nenhum projeto cadastrado ainda.</p>';
    return;
  }
  state.projects.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card';
    const areaTagsHtml = p.tarefas.map(t => `<span class="area-tag">${t.area}</span>`).join(' ');
    const open = state.expanded[p.id];
    card.innerHTML = `
      <div class="card-head">
        <div>
          <p class="card-title">${p.nome}${p.chamado ? ' <span style="color:var(--text-muted);font-weight:400;">· Chamado ' + p.chamado + '</span>' : ''}</p>
          <p class="card-sub">GP: ${p.gerente_nome || '-'}${p.cliente_nome ? ' · Cliente: ' + p.cliente_nome : ''} · ${p.tipo} · fase: ${p.fase}</p>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="badge ${statusClass(p.status_prazo)}">prazo: ${p.status_prazo}</span>
          <button class="icon-btn" data-edit-project aria-label="Editar projeto">✎</button>
        </div>
      </div>
      <p class="card-resumo">${p.resumo || ''}</p>
      <div class="chip-row" style="margin-bottom:8px;">${areaTagsHtml}</div>
      <div class="card-sub" style="display:flex;justify-content:space-between;">
        <span>Prazo geral: ${fmtDate(p.data_inicio)} → ${fmtDate(p.data_fim)}</span>
        <span>${p.progresso}%</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${p.progresso}%;background:${progressColor(p.progresso)}"></div></div>
      <div class="toggle-row">
        <button class="toggle-btn" data-toggle="tarefas">${open === 'tarefas' ? 'Ocultar prazos por área' : 'Prazos por área'}</button>
        <button class="toggle-btn" data-toggle="historico">${open === 'historico' ? 'Ocultar histórico' : 'Histórico (' + p.historico.length + ')'}</button>
      </div>
      <div class="detail-block" data-detail="tarefas" style="display:${open === 'tarefas' ? 'flex' : 'none'}"></div>
      <div class="detail-block" data-detail="historico" style="display:${open === 'historico' ? 'flex' : 'none'}"></div>
    `;
    const tarefasHost = card.querySelector('[data-detail="tarefas"]');
    p.tarefas.forEach(t => {
      const row = document.createElement('div');
      row.className = 'detail-row';
      row.innerHTML = `
        <span class="area-tag">${t.area}</span>
        <span>${fmtDate(t.inicio)} → ${fmtDate(t.fim)}</span>
        <span class="badge ${statusClass(t.status)}">${t.status}</span>
      `;
      tarefasHost.appendChild(row);
    });
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
      await loadProjectsFiltered();
      state.expanded[p.id] = 'historico';
      renderProjectList();
    };
    histHost.appendChild(addRow);

    card.querySelectorAll('[data-toggle]').forEach(btn => {
      btn.onclick = () => {
        const which = btn.dataset.toggle;
        state.expanded[p.id] = state.expanded[p.id] === which ? null : which;
        renderProjectList();
      };
    });
    card.querySelector('[data-edit-project]').onclick = () => openEditModal(p);
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
  await loadProjectsFiltered();
  renderGpList();
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
}
document.getElementById('form-email-config').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    frequencia: document.getElementById('cfg-frequencia').value,
    dia_semana: Number(document.getElementById('cfg-dia-semana').value),
    hora: 8,
    enviar_gps: document.getElementById('cfg-enviar-gps').checked,
    enviar_admins: document.getElementById('cfg-enviar-admins').checked,
  };
  await api('/email-config', { method: 'PUT', body: JSON.stringify(body) });
  const status = document.getElementById('email-status');
  status.textContent = 'Configuração salva.';
  status.classList.remove('hidden');
  setTimeout(() => status.classList.add('hidden'), 3000);
});
document.getElementById('btn-send-now').addEventListener('click', async () => {
  const status = document.getElementById('email-status');
  status.textContent = 'Enviando...';
  status.classList.remove('hidden');
  try {
    const result = await api('/email-config/enviar-agora', { method: 'POST' });
    status.textContent = result.enviados.length
      ? `E-mails enviados para: ${result.enviados.join(', ')}`
      : 'Nenhum destinatário com projetos para enviar.';
  } catch (err) {
    status.textContent = 'Erro ao enviar: ' + err.message + ' (confira as credenciais SMTP no .env)';
    status.style.color = 'var(--danger)';
  }
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
  const data_inicio = document.getElementById('np-inicio').value;
  const data_fim = document.getElementById('np-fim').value;
  const resumo = document.getElementById('np-resumo').value.trim();
  const areasSel = Object.keys(state.newProjectAreas);

  if (!nome || !data_inicio || !data_fim || areasSel.length === 0) {
    alert('Preencha nome, prazo geral e ao menos uma área.');
    return;
  }
  const incompletas = areasSel.filter(a => !state.newProjectAreas[a].inicio || !state.newProjectAreas[a].fim);
  if (incompletas.length > 0) {
    alert('Defina início e fim da tarefa para: ' + incompletas.join(', '));
    return;
  }
  const tarefas = areasSel.map(a => ({ area: a, inicio: state.newProjectAreas[a].inicio, fim: state.newProjectAreas[a].fim, status: 'planejamento' }));

  try {
    await api('/projects', {
      method: 'POST',
      body: JSON.stringify({ nome, chamado, cliente_id, gp_id, tipo, fase, status_prazo: 'em dia', resumo, data_inicio, data_fim, progresso: 0, tarefas }),
    });
    modal.classList.add('hidden');
    e.target.reset();
    renderNewProjectAreaChips();
    await loadProjectsFiltered();
    renderStats();
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
  document.getElementById('edit-inicio').value = p.data_inicio;
  document.getElementById('edit-fim').value = p.data_fim;
  document.getElementById('edit-resumo').value = p.resumo || '';
  document.getElementById('edit-progresso').value = p.progresso;
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
  const data_inicio = document.getElementById('edit-inicio').value;
  const data_fim = document.getElementById('edit-fim').value;
  const resumo = document.getElementById('edit-resumo').value.trim();
  const progresso = Number(document.getElementById('edit-progresso').value) || 0;
  const statusSelValue = document.getElementById('edit-status-prazo').value;
  const status_prazo = statusSelValue === 'automatico' ? 'em dia' : statusSelValue;

  if (!nome || !data_inicio || !data_fim) {
    alert('Preencha nome e prazo geral.');
    return;
  }

  try {
    await api(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ nome, chamado, cliente_id, gp_id, tipo, fase, status_prazo, resumo, data_inicio, data_fim, progresso }),
    });
    editModal.classList.add('hidden');
    await loadProjectsFiltered();
    renderStats();
  } catch (err) {
    alert(err.message);
  }
});

loadAll();
