'use strict';

// Sobe o servidor HTTP e o servidor de métricas, e encerra com elegância em SIGTERM/SIGINT:
// para de aceitar conexões, espera as em andamento terminarem e só então fecha o banco e sai.
// É o que evita erros para o cliente quando o Kubernetes troca uma réplica durante um deploy.
function iniciar({ app, appMetricas, config, log, aoEncerrar }) {
  const servidor = app.listen(config.porta, () => log.info('servidor_iniciado', { porta: config.porta }));
  const metricas = appMetricas.listen(config.portaMetricas);

  let encerrando = false;
  const encerrar = (sinal) => {
    if (encerrando) return;
    encerrando = true;
    log.info('encerrando', { sinal });
    servidor.close(async () => {
      metricas.close();
      try {
        await aoEncerrar?.();
      } finally {
        process.exit(0);
      }
    });
    servidor.closeIdleConnections?.();
    setTimeout(() => process.exit(1), 10_000).unref(); // última defesa: não ficar pendurado para sempre
  };
  process.on('SIGTERM', () => encerrar('SIGTERM'));
  process.on('SIGINT', () => encerrar('SIGINT'));
  return { servidor, metricas };
}

module.exports = { iniciar };
