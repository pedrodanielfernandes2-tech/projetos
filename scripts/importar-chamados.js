// Script de importacao unica: le os CSVs exportados do Supabase (pasta
// scripts/dados-migracao-chamados/) e povoa as tabelas chamados_* do nosso
// Postgres, mapeando os IDs antigos (UUID do Supabase) para os novos IDs
// (SERIAL/inteiro) via um dicionario em memoria.
//
// Como rodar (uma vez so, contra o banco de producao):
//   node scripts/importar-chamados.js
//
// E seguro rodar mais de uma vez? no. Cada execucao insere linhas novas.
// Se precisar rodar de novo, limpe as tabelas chamados_* antes (ou peça ajuda).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { pool } = require('../src/db');
const { calcularChamado } = require('../src/chamadosCalculo');

const PASTA = path.join(__dirname, 'dados-migracao-chamados');

function lerCsv(nomeArquivo) {
  const caminho = path.join(PASTA, nomeArquivo);
  const conteudo = fs.readFileSync(caminho, 'utf-8');
  return parse(conteudo, { columns: true, skip_empty_lines: true });
}

function vazioParaNull(valor) {
  return valor === '' || valor === undefined ? null : valor;
}

async function main() {
  console.log('Aguardando o banco ficar pronto...');
  const { ready } = require('../src/db');
  await ready;

  console.log('--- Lendo CSVs ---');
  const clientesCsv = lerCsv('clientes_rows.csv');
  const analistasCsv = lerCsv('analistas_rows.csv');
  const configCsv = lerCsv('config_calculo_rows.csv');
  const statusOcultosCsv = lerCsv('status_ocultos_rows.csv');
  const chamadosCsv = lerCsv('chamados_rows.csv');
  console.log(`clientes: ${clientesCsv.length} | analistas: ${analistasCsv.length} | config: ${configCsv.length} | status ocultos: ${statusOcultosCsv.length} | chamados: ${chamadosCsv.length}`);

  // ---------- clientes ----------
  console.log('--- Importando clientes ---');
  const mapaClientes = {}; // uuid antigo -> id novo
  for (const c of clientesCsv) {
    const { rows } = await pool.query(
      'INSERT INTO chamados_clientes (nome, ativo, criado_em) VALUES ($1, $2, $3) RETURNING id',
      [c.nome, c.ativo === 'true', c.criado_em]
    );
    mapaClientes[c.id] = rows[0].id;
  }
  console.log(`${Object.keys(mapaClientes).length} clientes importados.`);

  // ---------- analistas ----------
  console.log('--- Importando analistas ---');
  const mapaAnalistas = {};
  for (const a of analistasCsv) {
    const { rows } = await pool.query(
      'INSERT INTO chamados_analistas (nome, ativo, criado_em) VALUES ($1, $2, $3) RETURNING id',
      [a.nome, a.ativo === 'true', a.criado_em]
    );
    mapaAnalistas[a.id] = rows[0].id;
  }
  console.log(`${Object.keys(mapaAnalistas).length} analistas importados.`);

  // ---------- config_calculo ----------
  console.log('--- Importando configuracao de calculo ---');
  // remove a config-semente que o db.js ja cria por padrao, pra nao ficar duplicado
  await pool.query('DELETE FROM chamados_config');
  for (const cfg of configCsv) {
    await pool.query(
      'INSERT INTO chamados_config (pct_qa, pct_gerencial, valor_hora, vigente_desde, vigente_ate, criado_por, criado_em) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [cfg.pct_qa, cfg.pct_gerencial, cfg.valor_hora, cfg.vigente_desde, vazioParaNull(cfg.vigente_ate), cfg.criado_por, cfg.vigente_desde]
    );
  }
  console.log(`${configCsv.length} config(s) importada(s).`);

  // ---------- status_ocultos ----------
  console.log('--- Importando status ocultos ---');
  for (const s of statusOcultosCsv) {
    await pool.query('INSERT INTO chamados_status_ocultos (status) VALUES ($1) ON CONFLICT (status) DO NOTHING', [s.status]);
  }
  console.log(`${statusOcultosCsv.length} status ocultos importados.`);

  // ---------- chamados ----------
  console.log('--- Importando chamados (isso pode levar um tempinho) ---');
  let importados = 0;
  let semClienteEncontrado = 0;
  for (const c of chamadosCsv) {
    const clienteIdNovo = mapaClientes[c.cliente_id] || null;
    const analistaIdNovo = c.analista_id ? (mapaAnalistas[c.analista_id] || null) : null;
    if (c.cliente_id && !clienteIdNovo) semClienteEncontrado++;

    const calc = calcularChamado({
      horasDev: c.horas_dev,
      pctMargem: c.pct_margem,
      pctNegociado: c.pct_negociado,
      pctQaAplicado: c.pct_qa_aplicado,
      pctGerencialAplicado: c.pct_gerencial_aplicado,
      valorHoraAplicado: c.valor_hora_aplicado,
    });
    // usa o valor gravado original (valor_total_projeto_real) quando existir, ja que pode
    // ter sido ajustado manualmente; so recorre ao recalculo puro se o CSV nao tiver o valor.
    const valorProjetoFinal = vazioParaNull(c.valor_projeto_real) !== null ? Number(c.valor_projeto_real) : calc.valor_projeto;
    const descontoFinal = vazioParaNull(c.desconto_negociado_real) !== null ? Number(c.desconto_negociado_real) : calc.desconto_negociado;
    const valorTotalFinal = vazioParaNull(c.valor_total_projeto_real) !== null ? Number(c.valor_total_projeto_real) : calc.valor_total_projeto;

    await pool.query(
      `INSERT INTO chamados
        (numero, cliente_id, analista_id, descricao, status, data_abertura, grupo_trabalho, complexidade, proposta_status,
         data_envio_proposta, data_aprovacao, horas_dev, pct_margem, pct_negociado, qtd_parcelas,
         pct_qa_aplicado, pct_gerencial_aplicado, valor_hora_aplicado,
         valor_projeto_real, desconto_negociado_real, valor_total_projeto_real, criado_em, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        c.numero, clienteIdNovo, analistaIdNovo, c.descricao || '', c.status || '',
        vazioParaNull(c.data_abertura), vazioParaNull(c.grupo_trabalho), vazioParaNull(c.complexidade), vazioParaNull(c.proposta_status),
        vazioParaNull(c.data_envio_proposta), vazioParaNull(c.data_aprovacao),
        c.horas_dev || 0, c.pct_margem || 0, c.pct_negociado || 0, c.qtd_parcelas || 1,
        c.pct_qa_aplicado || 0, c.pct_gerencial_aplicado || 0, c.valor_hora_aplicado || 0,
        valorProjetoFinal, descontoFinal, valorTotalFinal,
        c.criado_em, c.atualizado_em || c.criado_em,
      ]
    );
    importados++;
    if (importados % 200 === 0) console.log(`  ... ${importados}/${chamadosCsv.length}`);
  }
  console.log(`${importados} chamados importados. (${semClienteEncontrado} sem cliente correspondente encontrado)`);

  console.log('--- Importação concluída com sucesso ---');
  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error('ERRO na importação:', err);
  process.exit(1);
});
