'use strict';

function inteiro(valor, padrao, nome, minimo, maximo) {
  if (valor === undefined || valor === '') return padrao;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < minimo || n > maximo) {
    throw new Error(`Variável ${nome} inválida: use um inteiro de ${minimo} a ${maximo} (recebido "${valor}").`);
  }
  return n;
}

// Lê e valida o ambiente na partida: o serviço não sobe com configuração inválida.
function lerConfiguracao(env = process.env) {
  return {
    porta: inteiro(env.PORT, 3000, 'PORT', 1, 65535),
    portaMetricas: inteiro(env.METRICS_PORT, 9100, 'METRICS_PORT', 1, 65535),
    // Pagamentos acima deste valor são recusados (simula a análise de risco de um gateway real).
    limiteAprovacao: inteiro(env.LIMITE_APROVACAO, 5000, 'LIMITE_APROVACAO', 1, 1_000_000),
  };
}

module.exports = { lerConfiguracao };
