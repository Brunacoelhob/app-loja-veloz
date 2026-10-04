'use strict';

const { criarApp } = require('./app');
const { lerConfiguracao } = require('./config');
const { criarLog } = require('./log');
const { criarObservabilidade } = require('./observabilidade');
const { iniciar } = require('./servidor');

const config = lerConfiguracao();
const log = criarLog('pagamentos');
const observabilidade = criarObservabilidade('pagamentos');

iniciar({ app: criarApp({ config, log, observabilidade }), appMetricas: observabilidade.appMetricas, config, log });
