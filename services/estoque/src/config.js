'use strict';

function inteiro(valor, padrao, nome, minimo, maximo) {
  if (valor === undefined || valor === '') return padrao;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < minimo || n > maximo) {
    throw new Error(`Variável ${nome} inválida: use um inteiro de ${minimo} a ${maximo} (recebido "${valor}").`);
  }
  return n;
}

// Lê e valida o ambiente na partida: o serviço não sobe com configuração inválida ou incompleta.
function lerConfiguracao(env = process.env) {
  const databaseUrl = (env.DATABASE_URL ?? '').trim();
  if (!databaseUrl) throw new Error('Variável obrigatória ausente: DATABASE_URL (veja o .env.example).');
  return {
    porta: inteiro(env.PORT, 3000, 'PORT', 1, 65535),
    portaMetricas: inteiro(env.METRICS_PORT, 9100, 'METRICS_PORT', 1, 65535),
    databaseUrl,
  };
}

module.exports = { lerConfiguracao };
