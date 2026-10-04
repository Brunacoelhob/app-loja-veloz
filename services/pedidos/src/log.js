'use strict';

const NIVEIS = { debug: 10, info: 20, aviso: 30, erro: 40 };

// Log estruturado (uma linha JSON por evento): fácil de filtrar e de coletar em qualquer plataforma.
// Regra de ouro: NUNCA registrar corpo de requisição, cabeçalhos nem credenciais.
function criarLog(servico, nivelMinimo = process.env.LOG_NIVEL || 'info') {
  const minimo = NIVEIS[nivelMinimo] ?? NIVEIS.info;
  const escrever =
    (nivel) =>
    (mensagem, extra = {}) => {
      if (NIVEIS[nivel] < minimo) return;
      process.stdout.write(`${JSON.stringify({ hora: new Date().toISOString(), nivel, servico, mensagem, ...extra })}\n`);
    };
  return { debug: escrever('debug'), info: escrever('info'), aviso: escrever('aviso'), erro: escrever('erro') };
}

module.exports = { criarLog };
