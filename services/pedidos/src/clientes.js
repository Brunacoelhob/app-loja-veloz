'use strict';

class ErroServicoIndisponivel extends Error {}

// Chamada JSON a outro serviço, SEMPRE com tempo limite. Erro de rede ou timeout vira ErroServicoIndisponivel;
// resposta 4xx/5xx NÃO lança: o chamador decide o que fazer com o status.
async function chamarJson(fetchImpl, url, { metodo = 'GET', corpo, requestId, timeoutMs }) {
  const controle = new AbortController();
  const temporizador = setTimeout(() => controle.abort(), timeoutMs);
  try {
    const resposta = await fetchImpl(url, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(requestId ? { 'x-request-id': requestId } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: controle.signal,
    });
    const texto = await resposta.text();
    let json = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      // corpo não era JSON: segue com null
    }
    return { status: resposta.status, corpo: json };
  } catch (erro) {
    throw new ErroServicoIndisponivel(`Falha ao chamar ${new URL(url).host}: ${erro.name === 'AbortError' ? 'tempo esgotado' : erro.message}`);
  } finally {
    clearTimeout(temporizador);
  }
}

function criarClienteEstoque({ url, timeoutMs, fetchImpl = fetch }) {
  return {
    reservar: (pedidoId, itens, requestId) =>
      chamarJson(fetchImpl, `${url}/estoque/reservas`, { metodo: 'POST', corpo: { pedidoId, itens }, requestId, timeoutMs }),
    liberar: (pedidoId, requestId) => chamarJson(fetchImpl, `${url}/estoque/reservas/${pedidoId}`, { metodo: 'DELETE', requestId, timeoutMs }),
  };
}

function criarClientePagamentos({ url, timeoutMs, fetchImpl = fetch }) {
  return {
    cobrar: (pedidoId, valor, metodo, requestId) =>
      chamarJson(fetchImpl, `${url}/pagamentos`, { metodo: 'POST', corpo: { pedidoId, valor, metodo }, requestId, timeoutMs }),
  };
}

module.exports = { ErroServicoIndisponivel, chamarJson, criarClienteEstoque, criarClientePagamentos };
