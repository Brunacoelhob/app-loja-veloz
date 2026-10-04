'use strict';

const { Pool } = require('pg');
const { criarApp } = require('./app');
const { lerConfiguracao } = require('./config');
const { criarLog } = require('./log');
const { migrar } = require('./migrar');
const { criarObservabilidade } = require('./observabilidade');
const { RepositorioEstoque } = require('./repositorio');
const { iniciar } = require('./servidor');

async function principal() {
  const config = lerConfiguracao();
  const log = criarLog('estoque');
  const observabilidade = criarObservabilidade('estoque');

  const pool = new Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 3000 });
  pool.on('error', (erro) => log.erro('erro_no_pool', { mensagem: erro.message }));
  await migrar(pool, log);

  const app = criarApp({
    repositorio: new RepositorioEstoque(pool),
    verificarBanco: () => pool.query('SELECT 1'),
    log,
    observabilidade,
  });
  iniciar({ app, appMetricas: observabilidade.appMetricas, config, log, aoEncerrar: () => pool.end() });
}

principal().catch((erro) => {
  // Falha na partida (banco fora, configuração inválida): sai com erro; o orquestrador reinicia e tenta de novo.
  process.stderr.write(`${JSON.stringify({ nivel: 'erro', servico: 'estoque', mensagem: 'falha_na_partida', detalhe: erro.message })}\n`);
  process.exit(1);
});
