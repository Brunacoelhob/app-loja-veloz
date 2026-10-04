'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { criarApp } = require('../src/app');
const { ErroServicoIndisponivel, chamarJson } = require('../src/clientes');
const { lerConfiguracao } = require('../src/config');
const { criarLog } = require('../src/log');
const { criarObservabilidade } = require('../src/observabilidade');
const { ServicoPedidos } = require('../src/servicoPedidos');

// ---------- dublês ----------

function repositorioFalso() {
  const pedidos = [];
  const copia = (p) => ({ ...p });
  return {
    pedidos,
    async criar({ chave, itens, metodoPagamento }) {
      if (chave && pedidos.some((p) => p.chaveIdempotencia === chave)) return null;
      const pedido = { id: pedidos.length + 1, chaveIdempotencia: chave ?? null, status: 'PENDENTE', motivo: null, valorTotal: null, itens, metodoPagamento };
      pedidos.push(pedido);
      return copia(pedido);
    },
    async atualizar(id, { status, motivo = null, valorTotal = null }) {
      const p = pedidos.find((x) => x.id === id);
      Object.assign(p, { status, motivo, valorTotal: valorTotal ?? p.valorTotal });
      return copia(p);
    },
    async obter(id) {
      const p = pedidos.find((x) => x.id === id);
      return p ? copia(p) : null;
    },
    async obterPorChave(chave) {
      const p = pedidos.find((x) => x.chaveIdempotencia === chave);
      return p ? copia(p) : null;
    },
    async listar({ status, limite, deslocamento }) {
      const filtrados = pedidos.filter((p) => !status || p.status === status);
      return { total: filtrados.length, itens: filtrados.slice(deslocamento, deslocamento + limite) };
    },
  };
}

// estoque e pagamentos "programáveis": cada teste diz o que eles respondem.
function dobles({ reserva = { status: 201, corpo: { valorTotal: 100 } }, cobranca = { status: 201, corpo: {} }, estoqueFora = false, pagamentosFora = false, liberarFalha = false } = {}) {
  const chamadas = { reservar: [], liberar: [], cobrar: [] };
  return {
    chamadas,
    estoque: {
      async reservar(pedidoId, itens) {
        chamadas.reservar.push(pedidoId);
        if (estoqueFora) throw new ErroServicoIndisponivel('estoque fora');
        return reserva;
      },
      async liberar(pedidoId) {
        chamadas.liberar.push(pedidoId);
        if (liberarFalha) throw new ErroServicoIndisponivel('estoque fora');
        return { status: 204, corpo: null };
      },
    },
    pagamentos: {
      async cobrar(pedidoId, valor) {
        chamadas.cobrar.push({ pedidoId, valor });
        if (pagamentosFora) throw new ErroServicoIndisponivel('pagamentos fora');
        return cobranca;
      },
    },
  };
}

async function subir(opcoes = {}) {
  const log = criarLog('teste', 'erro');
  const repositorio = repositorioFalso();
  const d = dobles(opcoes);
  const servico = new ServicoPedidos({ repositorio, estoque: d.estoque, pagamentos: d.pagamentos, log });
  const app = criarApp({
    servico,
    repositorio,
    verificarBanco: async () => {
      if (opcoes.bancoFora) throw new Error('banco fora');
    },
    log,
    observabilidade: criarObservabilidade('teste', { metricasPadrao: false }),
  });
  const servidor = await new Promise((ok) => {
    const s = app.listen(0, '127.0.0.1', () => ok(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const chamar = async (metodo, caminho, corpo, cabecalhos = {}) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...cabecalhos },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    return { status: r.status, corpo: texto ? JSON.parse(texto) : null, cabecalhos: r.headers };
  };
  return { chamar, repositorio, chamadas: d.chamadas, parar: () => new Promise((ok) => servidor.close(ok)) };
}

const PEDIDO = { itens: [{ produtoId: 1, quantidade: 2 }], metodoPagamento: 'pix' };

// ---------- testes ----------

test('configuração exige as URLs dos outros serviços e valida números', () => {
  const ok = { DATABASE_URL: 'postgres://x', ESTOQUE_URL: 'http://estoque:3000/', PAGAMENTOS_URL: 'http://pagamentos:3000' };
  const c = lerConfiguracao(ok);
  assert.equal(c.estoqueUrl, 'http://estoque:3000'); // barra final removida
  assert.equal(c.timeoutMs, 3000);
  assert.throws(() => lerConfiguracao({ ...ok, ESTOQUE_URL: '' }), /ESTOQUE_URL/);
  assert.throws(() => lerConfiguracao({ ...ok, PAGAMENTOS_URL: 'nao-e-url' }), /PAGAMENTOS_URL/);
  assert.throws(() => lerConfiguracao({ ...ok, TIMEOUT_MS: '5' }), /TIMEOUT_MS/);
  assert.throws(() => lerConfiguracao({ ...ok, DATABASE_URL: '' }), /DATABASE_URL/);
});

test('caminho feliz: reserva, cobra e confirma o pedido (201 PAGO)', async () => {
  const { chamar, chamadas, parar } = await subir();
  const r = await chamar('POST', '/pedidos', PEDIDO);
  assert.equal(r.status, 201);
  assert.equal(r.corpo.status, 'PAGO');
  assert.equal(r.corpo.valorTotal, 100);
  assert.deepEqual(chamadas.cobrar, [{ pedidoId: 1, valor: 100 }]); // cobra o valor calculado pelo ESTOQUE, não o do cliente
  assert.equal(chamadas.liberar.length, 0);
  await parar();
});

test('sem estoque: 409, pedido CANCELADO e nenhuma cobrança', async () => {
  const { chamar, chamadas, parar } = await subir({ reserva: { status: 409, corpo: { motivo: 'estoque_insuficiente' } } });
  const r = await chamar('POST', '/pedidos', PEDIDO);
  assert.equal(r.status, 409);
  assert.equal(r.corpo.status, 'CANCELADO');
  assert.equal(r.corpo.motivo, 'estoque_insuficiente');
  assert.equal(chamadas.cobrar.length, 0);
  await parar();
});

test('produto inexistente: 404 e CANCELADO', async () => {
  const { chamar, parar } = await subir({ reserva: { status: 404, corpo: {} } });
  const r = await chamar('POST', '/pedidos', PEDIDO);
  assert.equal(r.status, 404);
  assert.equal(r.corpo.motivo, 'produto_inexistente');
  await parar();
});

test('COMPENSAÇÃO: pagamento recusado devolve o estoque e cancela (402)', async () => {
  const { chamar, chamadas, parar } = await subir({ cobranca: { status: 402, corpo: { status: 'RECUSADO' } } });
  const r = await chamar('POST', '/pedidos', PEDIDO);
  assert.equal(r.status, 402);
  assert.equal(r.corpo.status, 'CANCELADO');
  assert.equal(r.corpo.motivo, 'pagamento_recusado');
  assert.deepEqual(chamadas.liberar, [1]); // o estoque reservado voltou
  await parar();
});

test('COMPENSAÇÃO: serviço de pagamentos fora do ar devolve o estoque e responde 503', async () => {
  const { chamar, chamadas, parar } = await subir({ pagamentosFora: true });
  const r = await chamar('POST', '/pedidos', PEDIDO);
  assert.equal(r.status, 503);
  assert.equal(r.corpo.motivo, 'pagamento_indisponivel');
  assert.deepEqual(chamadas.liberar, [1]);
  await parar();
});

test('estoque fora do ar: 503, cancela e tenta liberar (a resposta pode ter se perdido depois de reservar)', async () => {
  const { chamar, chamadas, parar } = await subir({ estoqueFora: true });
  const r = await chamar('POST', '/pedidos', PEDIDO);
  assert.equal(r.status, 503);
  assert.equal(r.corpo.motivo, 'estoque_indisponivel');
  assert.equal(chamadas.liberar.length, 1);
  await parar();
});

test('se a devolução do estoque também falhar, o pedido ainda é cancelado (e o erro fica no log)', async () => {
  const { chamar, parar } = await subir({ cobranca: { status: 402, corpo: {} }, liberarFalha: true });
  const r = await chamar('POST', '/pedidos', PEDIDO);
  assert.equal(r.status, 402);
  assert.equal(r.corpo.status, 'CANCELADO');
  await parar();
});

test('IDEMPOTÊNCIA: repetir a Idempotency-Key devolve o mesmo pedido, sem reservar nem cobrar de novo', async () => {
  const { chamar, chamadas, repositorio, parar } = await subir();
  const cab = { 'idempotency-key': 'chave-de-teste-123' };
  const a = await chamar('POST', '/pedidos', PEDIDO, cab);
  const b = await chamar('POST', '/pedidos', PEDIDO, cab);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.corpo.id, a.corpo.id);
  assert.equal(b.cabecalhos.get('idempotent-replayed'), 'true');
  assert.equal(repositorio.pedidos.length, 1);
  assert.equal(chamadas.reservar.length, 1);
  assert.equal(chamadas.cobrar.length, 1);
  await parar();
});

test('Idempotency-Key inválida dá 400', async () => {
  const { chamar, parar } = await subir();
  assert.equal((await chamar('POST', '/pedidos', PEDIDO, { 'idempotency-key': 'x' })).status, 400);
  await parar();
});

test('validação do pedido: itens, quantidades, duplicados e método', async () => {
  const { chamar, repositorio, parar } = await subir();
  const ruins = [
    {},
    { itens: [], metodoPagamento: 'pix' },
    { itens: [{ produtoId: 1, quantidade: 0 }], metodoPagamento: 'pix' },
    { itens: [{ produtoId: 1, quantidade: 1 }, { produtoId: 1, quantidade: 2 }], metodoPagamento: 'pix' },
    { itens: [{ produtoId: 1, quantidade: 1 }], metodoPagamento: 'dinheiro' },
  ];
  for (const corpo of ruins) {
    const r = await chamar('POST', '/pedidos', corpo);
    assert.equal(r.status, 400);
    assert.ok(r.corpo.detalhes.length > 0);
  }
  assert.equal(repositorio.pedidos.length, 0); // nada foi criado
  await parar();
});

test('o cliente NÃO consegue impor o preço: campos extras nos itens são descartados', async () => {
  const { chamar, repositorio, parar } = await subir();
  await chamar('POST', '/pedidos', { itens: [{ produtoId: 1, quantidade: 1, preco: 0.01 }], metodoPagamento: 'pix' });
  assert.deepEqual(repositorio.pedidos[0].itens, [{ produtoId: 1, quantidade: 1 }]);
  await parar();
});

test('consulta e listagem paginada, com filtros validados', async () => {
  const { chamar, parar } = await subir();
  for (let i = 0; i < 3; i++) await chamar('POST', '/pedidos', PEDIDO);

  assert.equal((await chamar('GET', '/pedidos/2')).corpo.id, 2);
  assert.equal((await chamar('GET', '/pedidos/99')).status, 404);
  assert.equal((await chamar('GET', '/pedidos/abc')).status, 400);

  const lista = await chamar('GET', '/pedidos?pagina=1&limite=2&status=PAGO');
  assert.equal(lista.corpo.itens.length, 2);
  assert.deepEqual(lista.corpo.meta, { total: 3, pagina: 1, limite: 2, totalPaginas: 2 });

  assert.equal((await chamar('GET', '/pedidos?status=QUALQUER')).status, 400);
  assert.equal((await chamar('GET', '/pedidos?limite=101')).status, 400);
  assert.equal((await chamar('GET', '/pedidos?pagina=0')).status, 400);
  await parar();
});

test('prontidão: 503 quando o banco cai, mas o processo segue vivo', async () => {
  const { chamar, parar } = await subir({ bancoFora: true });
  assert.equal((await chamar('GET', '/saude')).status, 200);
  assert.equal((await chamar('GET', '/pronto')).status, 503);
  await parar();
});

test('cliente HTTP: tempo esgotado e rede caída viram ErroServicoIndisponivel; 4xx NÃO lança', async () => {
  const lento = (_url, { signal }) =>
    new Promise((_ok, falha) => signal.addEventListener('abort', () => falha(Object.assign(new Error('abortado'), { name: 'AbortError' }))));
  await assert.rejects(chamarJson(lento, 'http://servico:3000/x', { timeoutMs: 50 }), (e) => e instanceof ErroServicoIndisponivel && /tempo esgotado/.test(e.message));

  const caido = async () => {
    throw new Error('ECONNREFUSED');
  };
  await assert.rejects(chamarJson(caido, 'http://servico:3000/x', { timeoutMs: 50 }), ErroServicoIndisponivel);

  const quatrocentos = async () => ({ status: 409, text: async () => '{"erro":"conflito"}' });
  const r = await chamarJson(quatrocentos, 'http://servico:3000/x', { timeoutMs: 50 });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.erro, 'conflito');
});
