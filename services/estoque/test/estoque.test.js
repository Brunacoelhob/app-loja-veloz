'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarApp, validarReserva } = require('../src/app');
const { lerConfiguracao } = require('../src/config');
const { criarLog } = require('../src/log');
const { criarObservabilidade } = require('../src/observabilidade');

// Repositório em memória com a mesma interface do real (a lógica SQL é exercitada no teste de fumaça com Postgres).
function repositorioFalso() {
  const produtos = new Map([
    [1, { id: 1, nome: 'Camiseta', preco: 50, quantidade: 5 }],
    [2, { id: 2, nome: 'Tênis', preco: 300, quantidade: 1 }],
  ]);
  const reservas = new Map();
  return {
    produtos,
    reservas,
    async listar() {
      return [...produtos.values()];
    },
    async obter(id) {
      return produtos.get(id) ?? null;
    },
    async reservar(pedidoId, itens) {
      if (reservas.has(pedidoId)) return { ok: true, repetida: true, valorTotal: reservas.get(pedidoId).valorTotal, itens };
      for (const i of itens) {
        const p = produtos.get(i.produtoId);
        if (!p) return { ok: false, motivo: 'produto_inexistente', produtoId: i.produtoId };
        if (p.quantidade < i.quantidade) return { ok: false, motivo: 'estoque_insuficiente', produtoId: i.produtoId };
      }
      let total = 0;
      for (const i of itens) {
        const p = produtos.get(i.produtoId);
        p.quantidade -= i.quantidade;
        total += p.preco * i.quantidade;
      }
      reservas.set(pedidoId, { itens, valorTotal: total });
      return { ok: true, repetida: false, valorTotal: total, itens };
    },
    async liberar(pedidoId) {
      const r = reservas.get(pedidoId);
      if (!r) return false;
      r.itens.forEach((i) => (produtos.get(i.produtoId).quantidade += i.quantidade));
      reservas.delete(pedidoId);
      return true;
    },
  };
}

async function subir({ bancoOk = true } = {}) {
  const repositorio = repositorioFalso();
  const app = criarApp({
    repositorio,
    verificarBanco: async () => {
      if (!bancoOk) throw new Error('banco fora');
    },
    log: criarLog('teste', 'erro'),
    observabilidade: criarObservabilidade('teste', { metricasPadrao: false }),
  });
  const servidor = await new Promise((ok) => {
    const s = app.listen(0, '127.0.0.1', () => ok(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const chamar = async (metodo, caminho, corpo) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { 'content-type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    return { status: r.status, corpo: texto ? JSON.parse(texto) : null };
  };
  return { chamar, repositorio, parar: () => new Promise((ok) => servidor.close(ok)) };
}

test('configuração exige DATABASE_URL e valida números', () => {
  assert.throws(() => lerConfiguracao({}), /DATABASE_URL/);
  assert.equal(lerConfiguracao({ DATABASE_URL: 'postgres://x' }).porta, 3000);
  assert.throws(() => lerConfiguracao({ DATABASE_URL: 'postgres://x', PORT: '0' }), /PORT/);
});

test('validação da reserva: aceita o válido e explica cada problema', () => {
  assert.deepEqual(validarReserva({ pedidoId: 1, itens: [{ produtoId: 1, quantidade: 2 }] }), []);
  assert.ok(validarReserva({}).length > 0);
  assert.ok(validarReserva({ pedidoId: 1, itens: [] }).length > 0);
  assert.ok(validarReserva({ pedidoId: 1, itens: [{ produtoId: 1, quantidade: 0 }] }).length > 0);
  assert.ok(validarReserva({ pedidoId: 1, itens: [{ produtoId: 1, quantidade: 1001 }] }).length > 0);
  assert.ok(validarReserva({ pedidoId: 1, itens: [{ produtoId: 1, quantidade: 1 }, { produtoId: 1, quantidade: 2 }] }).some((e) => e.includes('mais de uma vez')));
});

test('prontidão reflete o banco: 200 quando responde e 503 quando cai', async () => {
  const ok = await subir();
  assert.equal((await ok.chamar('GET', '/saude')).status, 200);
  assert.equal((await ok.chamar('GET', '/pronto')).status, 200);
  await ok.parar();

  const fora = await subir({ bancoOk: false });
  assert.equal((await fora.chamar('GET', '/saude')).status, 200); // o processo está vivo
  assert.equal((await fora.chamar('GET', '/pronto')).status, 503); // mas não deve receber tráfego
  await fora.parar();
});

test('lista e consulta produtos', async () => {
  const { chamar, parar } = await subir();
  assert.equal((await chamar('GET', '/estoque')).corpo.itens.length, 2);
  assert.equal((await chamar('GET', '/estoque/1')).corpo.nome, 'Camiseta');
  assert.equal((await chamar('GET', '/estoque/99')).status, 404);
  assert.equal((await chamar('GET', '/estoque/abc')).status, 400);
  await parar();
});

test('reserva: 201, valor total e baixa no estoque', async () => {
  const { chamar, repositorio, parar } = await subir();
  const r = await chamar('POST', '/estoque/reservas', { pedidoId: 10, itens: [{ produtoId: 1, quantidade: 2 }] });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.valorTotal, 100);
  assert.equal(repositorio.produtos.get(1).quantidade, 3);
  await parar();
});

test('reserva é idempotente: repetir o pedido devolve 200 e não baixa de novo', async () => {
  const { chamar, repositorio, parar } = await subir();
  const corpo = { pedidoId: 11, itens: [{ produtoId: 1, quantidade: 1 }] };
  assert.equal((await chamar('POST', '/estoque/reservas', corpo)).status, 201);
  assert.equal((await chamar('POST', '/estoque/reservas', corpo)).status, 200);
  assert.equal(repositorio.produtos.get(1).quantidade, 4);
  await parar();
});

test('estoque insuficiente dá 409 e produto inexistente dá 404, sem reservar nada', async () => {
  const { chamar, repositorio, parar } = await subir();
  const sem = await chamar('POST', '/estoque/reservas', { pedidoId: 12, itens: [{ produtoId: 2, quantidade: 2 }] });
  assert.equal(sem.status, 409);
  assert.equal(sem.corpo.motivo, 'estoque_insuficiente');
  const nao = await chamar('POST', '/estoque/reservas', { pedidoId: 13, itens: [{ produtoId: 77, quantidade: 1 }] });
  assert.equal(nao.status, 404);
  assert.equal(repositorio.reservas.size, 0);
  await parar();
});

test('liberar devolve o estoque e é idempotente (sempre 204)', async () => {
  const { chamar, repositorio, parar } = await subir();
  await chamar('POST', '/estoque/reservas', { pedidoId: 14, itens: [{ produtoId: 1, quantidade: 3 }] });
  assert.equal(repositorio.produtos.get(1).quantidade, 2);
  assert.equal((await chamar('DELETE', '/estoque/reservas/14')).status, 204);
  assert.equal(repositorio.produtos.get(1).quantidade, 5);
  assert.equal((await chamar('DELETE', '/estoque/reservas/14')).status, 204);
  assert.equal(repositorio.produtos.get(1).quantidade, 5); // não devolveu em dobro
  assert.equal((await chamar('DELETE', '/estoque/reservas/abc')).status, 400);
  await parar();
});

test('corpo inválido dá 400 com detalhes', async () => {
  const { chamar, parar } = await subir();
  const r = await chamar('POST', '/estoque/reservas', { pedidoId: 'x', itens: 'não é lista' });
  assert.equal(r.status, 400);
  assert.ok(r.corpo.detalhes.length > 0);
  await parar();
});
