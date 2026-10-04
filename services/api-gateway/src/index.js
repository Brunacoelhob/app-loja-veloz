'use strict';

const { criarApp } = require('./app');
const { lerConfiguracao } = require('./config');
const { criarLog } = require('./log');
const { criarObservabilidade } = require('./observabilidade');
const { iniciar } = require('./servidor');

const config = lerConfiguracao();
const log = criarLog('api-gateway');
const observabilidade = criarObservabilidade('api-gateway');

iniciar({ app: criarApp({ config, log, observabilidade }), appMetricas: observabilidade.appMetricas, config, log });
