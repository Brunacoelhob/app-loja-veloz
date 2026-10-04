'use strict';

const COLUNAS = `id, chave_idempotencia AS "chaveIdempotencia", status, motivo, valor_total::float8 AS "valorTotal",
  itens, metodo_pagamento AS "metodoPagamento", criado_em AS "criadoEm", atualizado_em AS "atualizadoEm"`;

// Única porta para o banco no serviço de pedidos.
class RepositorioPedidos {
  constructor(pool) {
    this.pool = pool;
  }

  /** Cria o pedido PENDENTE. Devolve null se a chave de idempotência já existe (violação do UNIQUE). */
  async criar({ chave, itens, metodoPagamento }) {
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO pedidos (chave_idempotencia, status, itens, metodo_pagamento) VALUES ($1, 'PENDENTE', $2, $3) RETURNING ${COLUNAS}`,
        [chave ?? null, JSON.stringify(itens), metodoPagamento],
      );
      return rows[0];
    } catch (erro) {
      if (erro.code === '23505') return null;
      throw erro;
    }
  }

  async atualizar(id, { status, motivo = null, valorTotal = null }) {
    const { rows } = await this.pool.query(
      `UPDATE pedidos SET status = $2, motivo = $3, valor_total = COALESCE($4, valor_total), atualizado_em = now() WHERE id = $1 RETURNING ${COLUNAS}`,
      [id, status, motivo, valorTotal],
    );
    return rows[0];
  }

  async obter(id) {
    const { rows } = await this.pool.query(`SELECT ${COLUNAS} FROM pedidos WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async obterPorChave(chave) {
    const { rows } = await this.pool.query(`SELECT ${COLUNAS} FROM pedidos WHERE chave_idempotencia = $1`, [chave]);
    return rows[0] ?? null;
  }

  async listar({ status, limite, deslocamento }) {
    const filtro = status ? 'WHERE status = $1' : '';
    const parametros = status ? [status] : [];
    const total = await this.pool.query(`SELECT count(*)::int AS total FROM pedidos ${filtro}`, parametros);
    const { rows } = await this.pool.query(
      `SELECT ${COLUNAS} FROM pedidos ${filtro} ORDER BY id DESC LIMIT $${parametros.length + 1} OFFSET $${parametros.length + 2}`,
      [...parametros, limite, deslocamento],
    );
    return { total: total.rows[0].total, itens: rows };
  }
}

module.exports = { RepositorioPedidos };
