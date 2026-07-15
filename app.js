const state = {
  areas: [],
  projects: [],
  gps: [],
  adminEmails: [],
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
  const [areas, projects, gps, adminEmails, emailConfig] = await Promise.all([
    api('/areas'),
    api('/projects'),
    api('/gps'),
    api('/admin-emails'),
    api('/email-config'),
  ]);
  state.areas = areas;
  state.projects = projects;
  state.gps = gps;
  state.adminEmails = adminEmails;
  state.emailConfig = emailConfig;
  renderStats();
  renderAreaFilters();
  renderProjectList();
  renderGpAreaChips();
  renderGpList();
  renderAdminList();
  renderEmailConfig();
  populateGpSelect();
  renderNewProjectAreaChips();
}

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
          <p class="card-title">${p.nome}</p>
          <p class="card-sub">GP: ${p.gerente_nome || '-'} · ${p.tipo} · fase: ${p.fase}</p>
        </div>
        <span class="badge ${statusClass(p.status_prazo)}">prazo: ${p.status_prazo}</span>
      </div>
      <p class="card-resumo">${p.resumo || ''}</p>
      <div class="chip-row" style="margin-bottom:8px;">${areaTagsHtml}</div>
      <div class="card-sub" style="display:flex;justify-content:space-between;">
        <span>Prazo geral: ${fmtDate(p.data_inicio)} → ${fmtDate(p.data_fim)}</span>
        <span>${p.progresso}%</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="width:${p.progresso}%"></div></div>
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
    el.appendChild(card);
  });
}

// ---------- GP admin ----------
function renderGpAreaChips() {
  const el = document.getElementById('gp-areas');
  el.innerHTML = '';
  state.areas.forEach(a => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = a;
    chip.onclick = () => chip.classList.toggle('selected');
    el.appendChild(chip);
  });
}
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
      <div class="chip-row" style="align-items:center;">
        ${gp.areas.map(a => `<span class="area-tag">${a}</span>`).join(' ')}
        <button class="icon-btn" aria-label="Remover GP">✕</button>
      </div>
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
  const areas = Array.from(document.querySelectorAll('#gp-areas .chip.selected')).map(c => c.textContent);
  if (!nome || !email || areas.length === 0) {
    alert('Preencha nome, e-mail e ao menos uma área.');
    return;
  }
  try {
    await api('/gps', { method: 'POST', body: JSON.stringify({ nome, email, areas }) });
    document.getElementById('gp-nome').value = '';
    document.getElementById('gp-email').value = '';
    renderGpAreaChips();
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
  const sel = document.getElementById('np-gp');
  sel.innerHTML = '<option value="">Sem GP definido</option>' +
    state.gps.map(gp => `<option value="${gp.id}">${gp.nome}</option>`).join('');
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
      body: JSON.stringify({ nome, gp_id, tipo, fase, status_prazo: 'em dia', resumo, data_inicio, data_fim, progresso: 0, tarefas }),
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

loadAll();
