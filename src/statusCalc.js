const STATUS_MANUAIS = ['bloqueado', 'concluído', 'concluido'];
const TASK_STATUS_MANUAIS = ['bloqueado', 'concluído', 'concluido', 'atrasado'];

function calcularStatusPrazo(project) {
  // Respeita marcacoes manuais (bloqueado/concluido) - nao sao dedutiveis so pelas datas.
  if (STATUS_MANUAIS.includes((project.status_prazo || '').toLowerCase())) {
    return project.status_prazo;
  }
  if (!project.data_inicio || !project.data_fim) return 'pendente';
  const hoje = new Date().toISOString().slice(0, 10);
  if (project.data_inicio && hoje < project.data_inicio) return 'não iniciado';
  if (project.data_fim && hoje > project.data_fim) return 'atrasado';
  return 'em dia';
}

function calcularStatusTarefa(t) {
  // Respeita marcacoes manuais (atrasado/bloqueado/concluido escolhidas pelo GP).
  if (TASK_STATUS_MANUAIS.includes((t.status || '').toLowerCase())) {
    return t.status;
  }
  if (!t.inicio || !t.fim) return 'pendente';
  const hoje = new Date().toISOString().slice(0, 10);
  if (t.inicio && hoje < t.inicio) return 'planejamento';
  if (t.fim && hoje > t.fim) return 'atrasado';
  return 'em andamento';
}

module.exports = { calcularStatusPrazo, calcularStatusTarefa, STATUS_MANUAIS, TASK_STATUS_MANUAIS };
