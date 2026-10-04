'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { chavesIguais, criarApp } = require('../src/app');
const { lerConfiguracao } = require('../src/config');
const { criarLog } = require('../src/log');
const { criarObservabilidade } = require('../src/observabilidade');

const CHAVE = 'chave-de-teste-bem-comprida-123';
const ENV = { API_KEY: CHAVE, PEDIDOS_URL: 'http://pedidos:3000', ESTOQUE_URL: 'http://estoque:3000/' };

// fetch falso que registra as chamadas e responde o que o teste mandar.
function fetchFalso(resposta = { status: 200, corpo: { ok: true }, cabecalhos: {} }) {
  const chamadas = [];
  const impl = async (url, opcoes) => {
    chamadas.push({ url: String(url), metodo: opcoes.method, cabecalhos: opcoes.headers, corpo: opcoes.body });
    if (resposta.erro) throw resposta.erro;
    return {
      status: resposta.status,
      headers: { get: (n) => resposta.cabecalhos?.[n] ?? null },
      text: async () => JSON.stringify(resposta.corpo),
    };
  };
  return { impl, chamadas };
}

async function subir({ env = {}, resposta } = {}) {
  const config = lerConfiguracao({ ...ENV, ...env });
  const f = fetchFalso(resposta);
  const app = criarApp({
    config,
    log: criarLog('teste', 'erro'),
    observabilidade: criarObservabilidade('teste', { metricasPadrao: false }),
    fetchImpl: f.impl,
  });
  const servidor = await new Promise((ok) => {
    const s = app.listen(0, '127.0.0.1', () => ok(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const chamar = async (metodo, caminho, { corpo, cabecalhos = {} } = {}) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...cabecalhos },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    return { status: r.status, corpo: texto ? JSON.parse(texto) : null, cabecalhos: r.headers };
  };
  return { chamar, chamadas: f.chamadas, parar: () => new Promise((ok) => servidor.close(ok)) };
}

test('configuração: exige chave forte e URLs válidas', () => {
  const c = lerConfiguracao(ENV);
  assert.equal(c.estoqueUrl, 'http://estoque:3000');
  assert.equal(c.limitePorMinuto, 120);
  assert.throws(() => lerConfiguracao({ ...ENV, API_KEY: '' }), /API_KEY/);
  assert.throws(() => lerConfiguracao({ ...ENV, API_KEY: 'curta' }), /16 caracteres/);
  assert.throws(() => lerConfiguracao({ ...ENV, PEDIDOS_URL: '' }), /PEDIDOS_URL/);
  assert.throws(() => lerConfiguracao({ ...ENV, ESTOQUE_URL: 'xxx' }), /ESTOQUE_URL/);
  assert.throws(() => lerConfiguracao({ ...ENV, LIMITE_REQ_POR_MINUTO: '0' }), /LIMITE_REQ_POR_MINUTO/);
});

test('comparação de chave: igual passa, diferente e vazia não', () => {
  assert.equal(chavesIguais(CHAVE, CHAVE), true);
  assert.equal(chavesIguais(CHAVE + 'x', CHAVE), false);
  assert.equal(chavesIguais('', CHAVE), false);
  assert.equal(chavesIguais(undefined, CHAVE), false);
});

test('saúde e prontidão respondem 200 e há cabeçalhos de segurança', async () => {
  const { chamar, parar } = await subir();
  const r = await chamar('GET', '/saude');
  assert.equal(r.status, 200);
  assert.equal(r.cabecalhos.get('x-powered-by'), null);
  assert.equal(r.cabecalhos.get('x-content-type-options'), 'nosniff');
  assert.equal((await chamar('GET', '/pronto')).status, 200);
  await parar();
});

test('catálogo é público e vai para o serviço de estoque', async () => {
  const { chamar, chamadas, parar } = await subir({ resposta: { status: 200, corpo: { itens: [] } } });
  const r = await chamar('GET', '/api/estoque');
  assert.equal(r.status, 200);
  assert.equal(chamadas[0].url, 'http://estoque:3000/estoque');
  await chamar('GET', '/api/estoque/3');
  assert.equal(chamadas[1].url, 'http://estoque:3000/estoque/3');
  await parar();
});

test('SEGURANÇA: pedidos sem chave ou com chave errada dão 401 e nada é encaminhado', async () => {
  const { chamar, chamadas, parar } = await subir();
  assert.equal((await chamar('POST', '/api/pedidos', { corpo: {} })).status, 401);
  assert.equal((await chamar('GET', '/api/pedidos')).status, 401);
  assert.equal((await chamar('GET', '/api/pedidos/1', { cabecalhos: { 'x-api-key': 'errada' } })).status, 401);
  assert.equal(chamadas.length, 0);
  await parar();
});

test('com a chave certa, o pedido é encaminhado; idempotência e id de rastreio são repassados', async () => {
  const { chamar, chamadas, parar } = await subir({ resposta: { status: 201, corpo: { id: 7 }, cabecalhos: { 'idempotent-replayed': 'true' } } });
  const r = await chamar('POST', '/api/pedidos', {
    corpo: { itens: [] },
    cabecalhos: { 'x-api-key': CHAVE, 'idempotency-key': 'chave-1234567890', 'x-request-id': 'req-abc-12345' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.id, 7);
  assert.equal(r.cabecalhos.get('idempotent-replayed'), 'true');
  assert.equal(chamadas[0].url, 'http://pedidos:3000/pedidos');
  assert.equal(chamadas[0].cabecalhos['idempotency-key'], 'chave-1234567890');
  assert.equal(chamadas[0].cabecalhos['x-request-id'], 'req-abc-12345');
  assert.equal(chamadas[0].cabecalhos['x-api-key'], undefined); // a chave NÃO vaza para os serviços internos
  await parar();
});

test('a query string é repassada (filtros e paginação)', async () => {
  const { chamar, chamadas, parar } = await subir();
  await chamar('GET', '/api/pedidos?status=PAGO&limite=5', { cabecalhos: { 'x-api-key': CHAVE } });
  assert.equal(chamadas[0].url, 'http://pedidos:3000/pedidos?status=PAGO&limite=5');
  await parar();
});

test('SEGURANÇA: pagamentos e reservas de estoque NÃO são expostos ao público', async () => {
  const { chamar, chamadas, parar } = await subir();
  const h = { 'x-api-key': CHAVE };
  assert.equal((await chamar('POST', '/api/pagamentos', { corpo: {}, cabecalhos: h })).status, 404);
  assert.equal((await chamar('POST', '/api/estoque/reservas', { corpo: {}, cabecalhos: h })).status, 404);
  assert.equal((await chamar('DELETE', '/api/estoque/reservas/1', { cabecalhos: h })).status, 404);
  assert.equal((await chamar('DELETE', '/api/pedidos/1', { cabecalhos: h })).status, 404);
  assert.equal(chamadas.length, 0);
  await parar();
});

test('serviço interno fora do ar dá 502; lento demais dá 504', async () => {
  let t = await subir({ resposta: { erro: new Error('ECONNREFUSED') } });
  assert.equal((await t.chamar('GET', '/api/estoque')).status, 502);
  await t.parar();

  t = await subir({ resposta: { erro: Object.assign(new Error('abortado'), { name: 'AbortError' }) } });
  assert.equal((await t.chamar('GET', '/api/estoque')).status, 504);
  await t.parar();
});

test('o status de erro do serviço interno é repassado (ex.: 409 conflito)', async () => {
  const { chamar, parar } = await subir({ resposta: { status: 409, corpo: { erro: 'Estoque insuficiente.' } } });
  const r = await chamar('POST', '/api/pedidos', { corpo: {}, cabecalhos: { 'x-api-key': CHAVE } });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.erro, 'Estoque insuficiente.');
  await parar();
});

test('LIMITE de requisições: acima do configurado, 429', async () => {
  const { chamar, parar } = await subir({ env: { LIMITE_REQ_POR_MINUTO: '3' } });
  const status = [];
  for (let i = 0; i < 5; i++) status.push((await chamar('GET', '/api/estoque')).status);
  assert.deepEqual(status, [200, 200, 200, 429, 429]);
  await parar();
});

test('JSON inválido dá 400 e rota inexistente dá 404', async () => {
  const { parar, chamar } = await subir();
  assert.equal((await chamar('GET', '/nada')).status, 404);
  await parar();
});
