'use strict';

const express = require('express');
const helmet = require('helmet');
const { naoEncontrado, tratarErros } = require('./http');

const MAX_ITENS = 50;
const MAX_QUANTIDADE = 1000;

// Valida o corpo de uma reserva. Devolve a lista de erros (vazia = válido).
function validarReserva(corpo) {
  const erros = [];
  if (!Number.isInteger(corpo?.pedidoId) || corpo.pedidoId <= 0) erros.push('pedidoId deve ser um inteiro positivo.');

  const itens = corpo?.itens;
  if (!Array.isArray(itens) || itens.length === 0 || itens.length > MAX_ITENS) {
    erros.push(`itens deve ser uma lista de 1 a ${MAX_ITENS} itens.`);
    return erros;
  }
  const vistos = new Set();
  itens.forEach((item, i) => {
    if (!Number.isInteger(item?.produtoId) || item.produtoId <= 0) erros.push(`itens[${i}].produtoId deve ser um inteiro positivo.`);
    if (!Number.isInteger(item?.quantidade) || item.quantidade < 1 || item.quantidade > MAX_QUANTIDADE) {
      erros.push(`itens[${i}].quantidade deve ser um inteiro de 1 a ${MAX_QUANTIDADE}.`);
    }
    if (vistos.has(item?.produtoId)) erros.push(`itens[${i}]: o produto ${item.produtoId} aparece mais de uma vez.`);
    vistos.add(item?.produtoId);
  });
  return erros;
}

function criarApp({ repositorio, verificarBanco, log, observabilidade }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '50kb' }));
  app.use(observabilidade.middleware(log));

  // Liveness: o processo está de pé. Readiness: consegue atender (o banco responde).
  app.get('/saude', (_req, res) => res.json({ status: 'ok' }));
  app.get('/pronto', async (_req, res) => {
    try {
      await verificarBanco();
      res.json({ status: 'ok', banco: 'ok' });
    } catch {
      res.status(503).json({ status: 'indisponivel', banco: 'falha' });
    }
  });

  const asyncRota = (fn) => (req, res, next) => fn(req, res).catch(next);

  app.get(
    '/estoque',
    asyncRota(async (_req, res) => res.json({ itens: await repositorio.listar() })),
  );

  app.get(
    '/estoque/:id',
    asyncRota(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'O id deve ser um inteiro positivo.' });
      const produto = await repositorio.obter(id);
      return produto ? res.json(produto) : res.status(404).json({ erro: 'Produto não encontrado.' });
    }),
  );

  // Reserva (idempotente por pedido): 201 na primeira vez, 200 se o pedido já tinha reserva.
  app.post(
    '/estoque/reservas',
    asyncRota(async (req, res) => {
      const erros = validarReserva(req.body);
      if (erros.length > 0) return res.status(400).json({ erro: 'Requisição inválida.', detalhes: erros });

      const r = await repositorio.reservar(req.body.pedidoId, req.body.itens);
      if (r.ok) {
        log.info('reserva', { id: req.id, pedidoId: req.body.pedidoId, repetida: r.repetida });
        return res.status(r.repetida ? 200 : 201).json({ pedidoId: req.body.pedidoId, valorTotal: r.valorTotal, itens: r.itens });
      }
      const status = r.motivo === 'produto_inexistente' ? 404 : 409;
      const mensagem = r.motivo === 'produto_inexistente' ? 'Produto não encontrado.' : 'Estoque insuficiente.';
      return res.status(status).json({ erro: mensagem, motivo: r.motivo, produtoId: r.produtoId });
    }),
  );

  // Compensação: devolve o estoque do pedido. Sempre 204 (idempotente): liberar duas vezes não é erro.
  app.delete(
    '/estoque/reservas/:pedidoId',
    asyncRota(async (req, res) => {
      const pedidoId = Number(req.params.pedidoId);
      if (!Number.isInteger(pedidoId) || pedidoId <= 0) return res.status(400).json({ erro: 'O pedidoId deve ser um inteiro positivo.' });
      const liberou = await repositorio.liberar(pedidoId);
      log.info('liberacao', { id: req.id, pedidoId, liberou });
      return res.status(204).end();
    }),
  );

  app.use(naoEncontrado);
  app.use(tratarErros(log));
  return app;
}

module.exports = { criarApp, validarReserva };
