'use strict';

// Respostas de erro num formato único em todos os serviços: { erro, detalhes? }.
function naoEncontrado(_req, res) {
  res.status(404).json({ erro: 'Rota não encontrada.' });
}

// Tem que ser registrado POR ÚLTIMO. Erros esperados viram 4xx; o resto vira 500 genérico
// (o detalhe vai só para o log, nunca para o cliente).
function tratarErros(log) {
  // eslint-disable-next-line no-unused-vars
  return (erro, req, res, _next) => {
    if (erro.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido no corpo da requisição.' });
    if (erro.type === 'entity.too.large') return res.status(413).json({ erro: 'Corpo da requisição grande demais.' });
    log.erro('erro_inesperado', { id: req.id, mensagem: erro.message });
    return res.status(500).json({ erro: 'Erro interno. Tente novamente mais tarde.' });
  };
}

module.exports = { naoEncontrado, tratarErros };
