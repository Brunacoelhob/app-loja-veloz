'use strict';

const { Pool } = require('pg');
const { criarApp } = require('./app');
const { criarClienteEstoque, criarClientePagamentos } = require('./clientes');
const { lerConfiguracao } = require('./config');
const { criarLog } = require('./log');
const { migrar } = require('./migrar');
const { criarObservabilidade } = require('./observabilidade');
const { RepositorioPedidos } = require('./repositorio');
const { iniciar } = require('./servidor');
const { ServicoPedidos } = require('./servicoPedidos');

async function principal() {
  const config = lerConfiguracao();
  const log = criarLog('pedidos');
  const observabilidade = criarObservabilidade('pedidos');

  const pool = new Pool({ connectionString: config.databaseUrl, max: 10, connectionTimeoutMillis: 3000 });
  pool.on('error', (erro) => log.erro('erro_no_pool', { mensagem: erro.message }));
  await migrar(pool, log);

  const repositorio = new RepositorioPedidos(pool);
  const servico = new ServicoPedidos({
    repositorio,
    estoque: criarClienteEstoque({ url: config.estoqueUrl, timeoutMs: config.timeoutMs }),
    pagamentos: criarClientePagamentos({ url: config.pagamentosUrl, timeoutMs: config.timeoutMs }),
    log,
  });

  const app = criarApp({ servico, repositorio, verificarBanco: () => pool.query('SELECT 1'), log, observabilidade });
  iniciar({ app, appMetricas: observabilidade.appMetricas, config, log, aoEncerrar: () => pool.end() });
}

principal().catch((erro) => {
  process.stderr.write(`${JSON.stringify({ nivel: 'erro', servico: 'pedidos', mensagem: 'falha_na_partida', detalhe: erro.message })}\n`);
  process.exit(1);
});
