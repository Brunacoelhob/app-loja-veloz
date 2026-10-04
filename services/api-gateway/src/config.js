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

// Lê e valida o ambiente na partida: o gateway não sobe sem chave de API forte nem sem saber para onde encaminhar.
function lerConfiguracao(env = process.env) {
  const apiKey = (env.API_KEY ?? '').trim();
  if (!apiKey) throw new Error('Variável obrigatória ausente: API_KEY (veja o .env.example).');
  if (apiKey.length < 16) throw new Error('API_KEY precisa ter pelo menos 16 caracteres.');

  return {
    porta: inteiro(env.PORT, 3000, 'PORT', 1, 65535),
    portaMetricas: inteiro(env.METRICS_PORT, 9100, 'METRICS_PORT', 1, 65535),
    apiKey,
    pedidosUrl: url(env, 'PEDIDOS_URL'),
    estoqueUrl: url(env, 'ESTOQUE_URL'),
    limitePorMinuto: inteiro(env.LIMITE_REQ_POR_MINUTO, 120, 'LIMITE_REQ_POR_MINUTO', 1, 100_000),
    // Quantos proxies confiáveis existem na frente (ingress/balanceador). Define de onde vem o IP real do cliente.
    confiarNoProxy: inteiro(env.TRUST_PROXY, 0, 'TRUST_PROXY', 0, 10),
    // Maior que a soma dos tempos limite internos (reserva + pagamento), para o gateway não cortar um pedido legítimo.
    timeoutMs: inteiro(env.TIMEOUT_MS, 10_000, 'TIMEOUT_MS', 500, 120_000),
  };
}

module.exports = { lerConfiguracao };
