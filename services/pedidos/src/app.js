'use strict';

const express = require('express');
const helmet = require('helmet');
const { naoEncontrado, tratarErros } = require('./http');
const { validarPedido } = require('./servicoPedidos');

const STATUS = ['PENDENTE', 'PAGO', 'CANCELADO'];

function criarApp({ servico, repositorio, verificarBanco, log, observabilidade }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '50kb' }));
  app.use(observabilidade.middleware(log));

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

  // Cria um pedido. Cabeçalho opcional "Idempotency-Key": repetir a chave devolve o pedido original.
  app.post(
    '/pedidos',
    asyncRota(async (req, res) => {
      const erros = validarPedido(req.body);
      if (erros.length > 0) return res.status(400).json({ erro: 'Requisição inválida.', detalhes: erros });

      const chave = req.headers['idempotency-key'];
      if (chave !== undefined && !/^[\w-]{8,64}$/.test(String(chave))) {
        return res.status(400).json({ erro: 'Idempotency-Key deve ter de 8 a 64 caracteres (letras, números, _ ou -).' });
      }

      const itens = req.body.itens.map(({ produtoId, quantidade }) => ({ produtoId, quantidade })); // só o que interessa
      const r = await servico.criar({ itens, metodoPagamento: req.body.metodoPagamento }, { chave, requestId: req.id });
      if (r.repetido) res.set('Idempotent-Replayed', 'true');
      return res.status(r.httpStatus).json(r.pedido);
    }),
  );

  app.get(
    '/pedidos/:id',
    asyncRota(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ erro: 'O id deve ser um inteiro positivo.' });
      const pedido = await repositorio.obter(id);
      return pedido ? res.json(pedido) : res.status(404).json({ erro: 'Pedido não encontrado.' });
    }),
  );

  // Lista paginada (?status=PAGO&pagina=1&limite=20). Parâmetro inválido dá 400, não é ignorado em silêncio.
  app.get(
    '/pedidos',
    asyncRota(async (req, res) => {
      const { status } = req.query;
      const pagina = req.query.pagina === undefined ? 1 : Number(req.query.pagina);
      const limite = req.query.limite === undefined ? 20 : Number(req.query.limite);
      const erros = [];
      if (status !== undefined && !STATUS.includes(status)) erros.push(`status deve ser um destes: ${STATUS.join(', ')}.`);
      if (!Number.isInteger(pagina) || pagina < 1) erros.push('pagina deve ser um inteiro a partir de 1.');
      if (!Number.isInteger(limite) || limite < 1 || limite > 100) erros.push('limite deve ser um inteiro de 1 a 100.');
      if (erros.length > 0) return res.status(400).json({ erro: 'Parâmetros inválidos.', detalhes: erros });

      const { total, itens } = await repositorio.listar({ status, limite, deslocamento: (pagina - 1) * limite });
      return res.json({ itens, meta: { total, pagina, limite, totalPaginas: Math.max(1, Math.ceil(total / limite)) } });
    }),
  );

  app.use(naoEncontrado);
  app.use(tratarErros(log));
  return app;
}

module.exports = { criarApp };
