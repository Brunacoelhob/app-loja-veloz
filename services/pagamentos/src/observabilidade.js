'use strict';

const { randomUUID } = require('node:crypto');
const express = require('express');
const client = require('prom-client');

// Métricas no formato Prometheus + identificador de requisição (x-request-id) que atravessa os serviços.
// As métricas ficam em uma porta SEPARADA e interna (METRICS_PORT): nunca passam pelo gateway público.
function criarObservabilidade(servico, { metricasPadrao = true } = {}) {
  const registro = new client.Registry();
  registro.setDefaultLabels({ servico });
  if (metricasPadrao) client.collectDefaultMetrics({ register: registro });

  const duracao = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duração das requisições HTTP em segundos',
    labelNames: ['metodo', 'rota', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registro],
  });

  const middleware = (log) => (req, res, next) => {
    const recebido = req.headers['x-request-id'];
    req.id = typeof recebido === 'string' && /^[\w-]{8,64}$/.test(recebido) ? recebido : randomUUID();
    res.setHeader('x-request-id', req.id);

    const fim = duracao.startTimer();
    res.on('finish', () => {
      // O rótulo usa o padrão da rota (/pedidos/:id), não a URL real: evita explosão de séries no Prometheus.
      const rota = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : 'nao_mapeada';
      const segundos = fim({ metodo: req.method, rota, status: res.statusCode });
      log.info('requisicao', { id: req.id, metodo: req.method, rota, status: res.statusCode, ms: Math.round(segundos * 1000) });
    });
    next();
  };

  const appMetricas = express();
  appMetricas.disable('x-powered-by');
  appMetricas.get('/metrics', async (_req, res) => {
    res.set('Content-Type', registro.contentType);
    res.end(await registro.metrics());
  });

  return { middleware, appMetricas, registro };
}

module.exports = { criarObservabilidade };
