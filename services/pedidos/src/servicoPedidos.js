'use strict';

const { ErroServicoIndisponivel } = require('./clientes');

const METODOS = ['cartao', 'pix', 'boleto'];
const MAX_ITENS = 50;
const MAX_QUANTIDADE = 1000;

function validarPedido(corpo) {
  const erros = [];
  if (!METODOS.includes(corpo?.metodoPagamento)) erros.push(`metodoPagamento deve ser um destes: ${METODOS.join(', ')}.`);

  const itens = corpo?.itens;
  if (!Array.isArray(itens) || itens.length === 0 || itens.length > MAX_ITENS) {
    erros.push(`itens deve ser uma lista de 1 a ${MAX_ITENS} itens.`);
    return erros;
  }
  const vistos = new Set();
  itens.forEach((item, i) => {
    if (!Number.isInteger(item?.produtoId) || item.produtoId <= 0) erros.push(`itens[${i}].produtoId deve ser um inteiro positivo.`);
    if (!Number.isInteger(item?.quantidade) || item.quantidade < 1 || item.quantidade > MAX_QUANTIDADE) {
      erros.push(`itens[${i}].quantidade deve ser um inteiro de 1 a ${MAX_QUANTIDADE}.`);
    }
    if (vistos.has(item?.produtoId)) erros.push(`itens[${i}]: o produto ${item.produtoId} aparece mais de uma vez.`);
    vistos.add(item?.produtoId);
  });
  return erros;
}

// Estado final do pedido -> status HTTP devolvido ao cliente.
function statusHttp(pedido) {
  if (pedido.status === 'PAGO') return 201;
  if (pedido.status === 'PENDENTE') return 202;
  return { produto_inexistente: 404, estoque_insuficiente: 409, pagamento_recusado: 402 }[pedido.motivo] ?? 503;
}

/**
 * Orquestra a venda (padrão SAGA, versão orquestrada):
 *   1. cria o pedido PENDENTE;  2. reserva o estoque;  3. cobra o pagamento;  4. confirma (PAGO).
 * Se qualquer passo falhar, DESFAZ o que já foi feito (compensação): devolve o estoque e cancela o pedido.
 * Limitação conhecida: se o próprio serviço de estoque estiver fora no momento de devolver, a devolução fica
 * pendente (registrada em log e no motivo); uma evolução natural é uma fila/outbox para reprocessar.
 */
class ServicoPedidos {
  constructor({ repositorio, estoque, pagamentos, log }) {
    Object.assign(this, { repositorio, estoque, pagamentos, log });
  }

  async criar({ itens, metodoPagamento }, { chave, requestId } = {}) {
    if (chave) {
      const existente = await this.repositorio.obterPorChave(chave);
      if (existente) return { pedido: existente, repetido: true, httpStatus: statusHttp(existente) };
    }

    let pedido = await this.repositorio.criar({ chave, itens, metodoPagamento });
    if (!pedido) {
      // Duas requisições com a mesma chave chegaram juntas: a segunda recebe o pedido da primeira.
      const existente = await this.repositorio.obterPorChave(chave);
      return { pedido: existente, repetido: true, httpStatus: statusHttp(existente) };
    }

    const cancelar = async (motivo, { liberar }) => {
      if (liberar) await this.liberarEstoque(pedido.id, requestId);
      pedido = await this.repositorio.atualizar(pedido.id, { status: 'CANCELADO', motivo });
      return { pedido, repetido: false, httpStatus: statusHttp(pedido) };
    };

    // --- passo 1: reservar o estoque ---
    let reserva;
    try {
      reserva = await this.estoque.reservar(pedido.id, itens, requestId);
    } catch (erro) {
      this.log.aviso('estoque_indisponivel', { pedidoId: pedido.id, mensagem: erro.message });
      return cancelar('estoque_indisponivel', { liberar: true }); // a resposta pode ter se perdido depois de reservar
    }
    if (reserva.status === 404) return cancelar('produto_inexistente', { liberar: false });
    if (reserva.status === 409) return cancelar('estoque_insuficiente', { liberar: false });
    if (reserva.status !== 200 && reserva.status !== 201) return cancelar('estoque_indisponivel', { liberar: true });

    const valorTotal = reserva.corpo.valorTotal;

    // --- passo 2: cobrar ---
    let pagamento;
    try {
      pagamento = await this.pagamentos.cobrar(pedido.id, valorTotal, metodoPagamento, requestId);
    } catch (erro) {
      this.log.aviso('pagamentos_indisponivel', { pedidoId: pedido.id, mensagem: erro.message });
      return cancelar('pagamento_indisponivel', { liberar: true });
    }
    if (pagamento.status === 402) return cancelar('pagamento_recusado', { liberar: true });
    if (pagamento.status !== 200 && pagamento.status !== 201) return cancelar('pagamento_indisponivel', { liberar: true });

    // --- passo 3: confirmar ---
    pedido = await this.repositorio.atualizar(pedido.id, { status: 'PAGO', valorTotal });
    this.log.info('pedido_pago', { pedidoId: pedido.id, valorTotal });
    return { pedido, repetido: false, httpStatus: 201 };
  }

  async liberarEstoque(pedidoId, requestId) {
    try {
      await this.estoque.liberar(pedidoId, requestId);
    } catch (erro) {
      // Não dá para devolver agora. Fica registrado para ação manual / reprocessamento.
      this.log.erro('liberacao_pendente', { pedidoId, mensagem: erro.message });
    }
  }
}

module.exports = { ServicoPedidos, validarPedido, statusHttp, METODOS, ErroServicoIndisponivel };
