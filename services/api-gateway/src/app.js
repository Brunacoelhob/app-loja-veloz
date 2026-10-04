'use strict';

const { createHash, timingSafeEqual } = require('node:crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { naoEncontrado, tratarErros } = require('./http');

const REPASSAR_ENTRADA = ['idempotency-key', 'x-request-id'];
const REPASSAR_SAIDA = ['idempotent-replayed'];

// Compara a chave sem vazar, pelo tempo de resposta, quantos caracteres acertaram.
function chavesIguais(recebida, esperada) {
  const hash = (v) => createHash('sha256').update(String(v)).digest();
  return timingSafeEqual(hash(recebida ?? ''), hash(esperada));
}

/**
 * API Gateway: o ÚNICO serviço exposto ao público. Responsabilidades:
 *   - exigir a chave de API (x-api-key) nas rotas de pedidos;
 *   - limitar requisições por IP;
 *   - expor SÓ o que o público precisa: o catálogo (GET /api/estoque) e os pedidos (/api/pedidos).
 *     Reservas de estoque e pagamentos são internos: só o serviço de pedidos fala com eles.
 */
function criarApp({ config, log, observabilidade, fetchImpl = fetch }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.confiarNoProxy);
  app.use(helmet());
  app.use(express.json({ limit: '50kb' }));
  app.use(observabilidade.middleware(log));

  app.get('/saude', (_req, res) => res.json({ status: 'ok' }));
  app.get('/pronto', (_req, res) => res.json({ status: 'ok' }));

  const limitador = rateLimit({
    windowMs: 60_000,
    limit: config.limitePorMinuto,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ erro: 'Muitas requisições. Aguarde um pouco e tente novamente.' }),
  });

  const exigirChave = (req, res, next) => {
    if (!chavesIguais(req.headers['x-api-key'], config.apiKey)) {
      return res.status(401).json({ erro: 'Chave de API ausente ou inválida (cabeçalho x-api-key).' });
    }
    return next();
  };

  // Encaminha a requisição para um serviço interno, com tempo limite, e devolve a resposta tal como veio.
  const encaminhar = (baseUrl, caminhoInterno) => async (req, res) => {
    const alvo = new URL(`${baseUrl}${caminhoInterno(req)}`);
    for (const [chave, valor] of Object.entries(req.query)) alvo.searchParams.set(chave, String(valor));

    const cabecalhos = { 'content-type': 'application/json' };
    for (const nome of REPASSAR_ENTRADA) if (req.headers[nome]) cabecalhos[nome] = String(req.headers[nome]);
    cabecalhos['x-request-id'] = req.id; // o mesmo id percorre todos os serviços (rastreabilidade)

    const controle = new AbortController();
    const temporizador = setTimeout(() => controle.abort(), config.timeoutMs);
    try {
      const resposta = await fetchImpl(alvo, {
        method: req.method,
        headers: cabecalhos,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
        signal: controle.signal,
      });
      for (const nome of REPASSAR_SAIDA) {
        const valor = resposta.headers.get(nome);
        if (valor) res.set(nome, valor);
      }
      const texto = await resposta.text();
      res.status(resposta.status).type('application/json').send(texto);
    } catch (erro) {
      const expirou = erro.name === 'AbortError';
      log.aviso('falha_no_encaminhamento', { id: req.id, destino: alvo.host, motivo: expirou ? 'tempo_esgotado' : erro.message });
      res.status(expirou ? 504 : 502).json({ erro: expirou ? 'O serviço demorou demais para responder.' : 'Serviço temporariamente indisponível.' });
    } finally {
      clearTimeout(temporizador);
    }
  };

  // Catálogo público (somente leitura).
  app.get('/api/estoque', limitador, encaminhar(config.estoqueUrl, () => '/estoque'));
  app.get('/api/estoque/:id', limitador, encaminhar(config.estoqueUrl, (req) => `/estoque/${encodeURIComponent(req.params.id)}`));

  // Pedidos: exigem chave de API. O limitador vem antes, para a chave não ser alvo de força bruta.
  app.post('/api/pedidos', limitador, exigirChave, encaminhar(config.pedidosUrl, () => '/pedidos'));
  app.get('/api/pedidos', limitador, exigirChave, encaminhar(config.pedidosUrl, () => '/pedidos'));
  app.get('/api/pedidos/:id', limitador, exigirChave, encaminhar(config.pedidosUrl, (req) => `/pedidos/${encodeURIComponent(req.params.id)}`));

  app.use(naoEncontrado);
  app.use(tratarErros(log));
  return app;
}

module.exports = { criarApp, chavesIguais };
