'use strict';

const { randomUUID } = require('node:crypto');
const express = require('express');
const helmet = require('helmet');
const { naoEncontrado, tratarErros } = require('./http');

const METODOS = ['cartao', 'pix', 'boleto'];

function validar({ pedidoId, valor, metodo } = {}) {
  const erros = [];
  if (!Number.isInteger(pedidoId) || pedidoId <= 0) erros.push('pedidoId deve ser um inteiro positivo.');
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) erros.push('valor deve ser um número positivo.');
  if (!METODOS.includes(metodo)) erros.push(`metodo deve ser um destes: ${METODOS.join(', ')}.`);
  return erros;
}

// Gateway de pagamento SIMULADO (não há cobrança real). Aprova até o limite configurado e recusa acima.
// É idempotente por pedido: repetir a cobrança do mesmo pedido devolve o mesmo resultado, nunca cobra duas vezes.
function criarApp({ config, log, observabilidade }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));
  app.use(observabilidade.middleware(log));

  const cobrancas = new Map(); // pedidoId -> cobrança (em memória: é um simulador)

  app.get('/saude', (_req, res) => res.json({ status: 'ok' }));
  app.get('/pronto', (_req, res) => res.json({ status: 'ok' })); // não depende de nenhum recurso externo

  app.post('/pagamentos', (req, res) => {
    const erros = validar(req.body);
    if (erros.length > 0) return res.status(400).json({ erro: 'Requisição inválida.', detalhes: erros });

    const { pedidoId, valor, metodo } = req.body;
    const existente = cobrancas.get(pedidoId);
    if (existente) return res.status(existente.status === 'APROVADO' ? 200 : 402).json({ ...existente, repetida: true });

    const aprovado = valor <= config.limiteAprovacao;
    const cobranca = {
      id: randomUUID(),
      pedidoId,
      valor,
      metodo,
      status: aprovado ? 'APROVADO' : 'RECUSADO',
      ...(aprovado ? {} : { motivo: 'Valor acima do limite de aprovação automática.' }),
    };
    cobrancas.set(pedidoId, cobranca);
    log.info('cobranca', { id: req.id, pedidoId, status: cobranca.status });
    return res.status(aprovado ? 201 : 402).json(cobranca);
  });

  app.use(naoEncontrado);
  app.use(tratarErros(log));
  return app;
}

module.exports = { criarApp, METODOS };
