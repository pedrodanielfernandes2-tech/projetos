// Script de limpeza unica: encontra analistas com o MESMO nome (ignorando
// maiusculas/minusculas e espaços) cadastrados mais de uma vez, mantem o de ID
// mais antigo, transfere os chamados que apontavam pros duplicados pra ele, e
// so entao apaga os registros duplicados. Seguro rodar mais de uma vez (depois
// da primeira limpeza, nao ha mais duplicata pra encontrar).
//
// Como rodar (no Render Shell, ou do seu computador com a DATABASE_URL certa):
//   node scripts/limpar-analistas-duplicados.js

require('dotenv').config();
const { pool, ready } = require('../src/db');

async function main() {
  console.log('Aguardando o banco ficar pronto...');
  await ready;

  console.log('--- Procurando analistas duplicados ---');
  const { rows: todos } = await pool.query('SELECT id, nome, ativo FROM chamados_analistas ORDER BY id');

  const grupos = {};
  todos.forEach(a => {
    const chave = a.nome.trim().toLowerCase();
    if (!grupos[chave]) grupos[chave] = [];
    grupos[chave].push(a);
  });

  const duplicados = Object.values(grupos).filter(g => g.length > 1);
  if (duplicados.length === 0) {
    console.log('Nenhum analista duplicado encontrado. Nada a fazer.');
    await pool.end();
    return;
  }

  for (const grupo of duplicados) {
    const manter = grupo[0]; // o de ID mais antigo
    const remover = grupo.slice(1);
    console.log(`\nNome "${manter.nome}": mantendo ID ${manter.id}, removendo ID(s) ${remover.map(r => r.id).join(', ')}`);

    for (const dup of remover) {
      const { rowCount } = await pool.query(
        'UPDATE chamados SET analista_id = $1 WHERE analista_id = $2',
        [manter.id, dup.id]
      );
      console.log(`  - ${rowCount} chamado(s) transferido(s) do ID ${dup.id} pro ID ${manter.id}`);
      await pool.query('DELETE FROM chamados_analistas WHERE id = $1', [dup.id]);
      console.log(`  - ID ${dup.id} removido`);
    }
  }

  console.log('\n--- Limpeza concluída com sucesso ---');
  await pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error('ERRO na limpeza:', err);
  process.exit(1);
});
