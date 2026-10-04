'use strict';

function inteiro(valor, padrao, nome, minimo, maximo) {
  if (valor === undefined || valor === '') return padrao;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < minimo || n > maximo) {
    throw new Error(`Variável ${nome} inválida: use um inteiro de ${minimo} a ${maximo} (recebido "${valor}").`);
  }
  return n;
}

function url(env, nome) {
  const valor = (env[nome] ?? '').trim().replace(/\/+$/, '');
  if (!valor) throw new Error(`Variável obrigatória ausente: ${nome} (veja o .env.example).`);
  try {
    new URL(valor);
  } catch {
    throw new Error(`Variável ${nome} não é uma URL válida: "${valor}".`);
  }
  return valor;
}

// Lê e valida o ambiente na partida: o serviço não sobe com configuração inválida ou incompleta.
function lerConfiguracao(env = process.env) {
  const databaseUrl = (env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) throw new Error('Variável obrigatória ausente: DATABASE_URL (veja o .env.example).');
  return {
    porta: inteiro(env.PORT, 3000, 'PORT', 1, 65535),
    portaMetricas: inteiro(env.METRICS_PORT, 9100, 'METRICS_PORT', 1, 65535),
    databaseUrl,
    estoqueUrl: url(env, 'ESTOQUE_URL'),
    pagamentosUrl: url(env, 'PAGAMENTOS_URL'),
    // Tempo máximo esperando outro serviço. Sem isso, um serviço lento travaria todos os pedidos.
    timeoutMs: inteiro(env.TIMEOUT_MS, 3000, 'TIMEOUT_MS', 100, 60_000),
  };
}

module.exports = { lerConfiguracao };
