'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarApp } = require('../src/app');
const { lerConfiguracao } = require('../src/config');
const { criarLog } = require('../src/log');
const { criarObservabilidade } = require('../src/observabilidade');

// Sobe o app numa porta livre e devolve um "cliente" simples + a função de encerrar.
async function subir(env = {}) {
  const config = lerConfiguracao(env);
  const log = criarLog('teste', 'erro');
  const app = criarApp({ config, log, observabilidade: criarObservabilidade('teste', { metricasPadrao: false }) });
  const servidor = await new Promise((ok) => {
    const s = app.listen(0, '127.0.0.1', () => ok(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const chamar = async (metodo, caminho, corpo) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { 'content-type': 'application/json' },
      body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    });
    return { status: r.status, corpo: await r.json(), cabecalhos: r.headers };
  };
  return { chamar, parar: () => new Promise((ok) => servidor.close(ok)) };
}

test('configuração: padrões e validação', () => {
  assert.deepEqual(lerConfiguracao({}), { porta: 3000, portaMetricas: 9100, limiteAprovacao: 5000 });
  assert.throws(() => lerConfiguracao({ PORT: 'abc' }), /PORT/);
  assert.throws(() => lerConfiguracao({ LIMITE_APROVACAO: '0' }), /LIMITE_APROVACAO/);
});

test('saúde e prontidão respondem 200', async () => {
  const { chamar, parar } = await subir();
  assert.equal((await chamar('GET', '/saude')).status, 200);
  assert.equal((await chamar('GET', '/pronto')).status, 200);
  await parar();
});

test('aprova um pagamento dentro do limite', async () => {
  const { chamar, parar } = await subir();
  const r = await chamar('POST', '/pagamentos', { pedidoId: 1, valor: 100.5, metodo: 'pix' });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.status, 'APROVADO');
  await parar();
});

test('recusa um pagamento acima do limite (402)', async () => {
  const { chamar, parar } = await subir({ LIMITE_APROVACAO: '1000' });
  const r = await chamar('POST', '/pagamentos', { pedidoId: 2, valor: 1000.01, metodo: 'cartao' });
  assert.equal(r.status, 402);
  assert.equal(r.corpo.status, 'RECUSADO');
  await parar();
});

test('é idempotente: repetir o mesmo pedido não cobra de novo', async () => {
  const { chamar, parar } = await subir();
  const primeira = await chamar('POST', '/pagamentos', { pedidoId: 7, valor: 50, metodo: 'boleto' });
  const segunda = await chamar('POST', '/pagamentos', { pedidoId: 7, valor: 9999, metodo: 'pix' });
  assert.equal(primeira.status, 201);
  assert.equal(segunda.status, 200);
  assert.equal(segunda.corpo.repetida, true);
  assert.equal(segunda.corpo.id, primeira.corpo.id);
  assert.equal(segunda.corpo.valor, 50); // mantém o resultado original
  await parar();
});

test('valida o corpo: campos inválidos dão 400 com detalhes', async () => {
  const { chamar, parar } = await subir();
  for (const corpo of [{}, { pedidoId: 'x', valor: 10, metodo: 'pix' }, { pedidoId: 1, valor: -5, metodo: 'pix' }, { pedidoId: 1, valor: 10, metodo: 'dinheiro' }]) {
    const r = await chamar('POST', '/pagamentos', corpo);
    assert.equal(r.status, 400);
    assert.ok(r.corpo.detalhes.length > 0);
  }
  await parar();
});

test('JSON inválido dá 400, rota inexistente dá 404, e há cabeçalhos de segurança', async () => {
  const { chamar, parar } = await subir();
  assert.equal((await chamar('POST', '/pagamentos', '{quebrado')).status, 400);
  const nao = await chamar('GET', '/nada');
  assert.equal(nao.status, 404);
  assert.equal(nao.cabecalhos.get('x-powered-by'), null);
  assert.equal(nao.cabecalhos.get('x-content-type-options'), 'nosniff');
  assert.match(nao.cabecalhos.get('x-request-id'), /^[\w-]{8,64}$/);
  await parar();
});
