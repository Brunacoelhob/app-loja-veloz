'use strict';

const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

// Aplica os arquivos sql/*.sql em ordem. Todos são idempotentes (IF NOT EXISTS), então rodar de novo é seguro.
// O "advisory lock" faz réplicas que sobem ao mesmo tempo esperarem a vez, em vez de disputar a migração.
async function migrar(pool, log, pasta = join(__dirname, '..', 'sql')) {
  const cliente = await pool.connect();
  try {
    await cliente.query('SELECT pg_advisory_lock(7770001)');
    for (const arquivo of readdirSync(pasta).filter((a) => a.endsWith('.sql')).sort()) {
      await cliente.query(readFileSync(join(pasta, arquivo), 'utf8'));
      log?.info('migracao_aplicada', { arquivo });
    }
  } finally {
    await cliente.query('SELECT pg_advisory_unlock(7770001)').catch(() => {});
    cliente.release();
  }
}

module.exports = { migrar };
