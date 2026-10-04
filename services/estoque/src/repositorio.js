'use strict';

const centavos = (valor) => Math.round(valor * 100) / 100;

// Única porta para o banco no serviço de estoque.
class RepositorioEstoque {
  constructor(pool) {
    this.pool = pool;
  }

  async listar() {
    const { rows } = await this.pool.query('SELECT id, nome, preco::float8 AS preco, quantidade FROM produtos ORDER BY id');
    return rows;
  }

  async obter(id) {
    const { rows } = await this.pool.query('SELECT id, nome, preco::float8 AS preco, quantidade FROM produtos WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  /**
   * Reserva os itens de um pedido de forma ATÔMICA e IDEMPOTENTE.
   *  - tudo ou nada: se um item faltar, nada é reservado (ROLLBACK);
   *  - o UPDATE condicional (quantidade >= pedido) + o CHECK do banco impedem estoque negativo mesmo
   *    com milhares de pedidos simultâneos, sem precisar de trava explícita;
   *  - os itens são processados em ordem de id: pedidos concorrentes pegam as linhas na mesma ordem, o que evita deadlock;
   *  - a PK de reservas torna a operação idempotente: repetir o mesmo pedido devolve a reserva existente.
   */
  async reservar(pedidoId, itens) {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');

      const novo = await cliente.query('INSERT INTO reservas (pedido_id, itens) VALUES ($1, $2) ON CONFLICT (pedido_id) DO NOTHING RETURNING pedido_id', [
        pedidoId,
        JSON.stringify(itens),
      ]);
      if (novo.rowCount === 0) {
        const { rows } = await cliente.query('SELECT itens, valor_total::float8 AS valor FROM reservas WHERE pedido_id = $1', [pedidoId]);
        await cliente.query('COMMIT');
        return { ok: true, repetida: true, valorTotal: rows[0].valor, itens: rows[0].itens };
      }

      let total = 0;
      for (const item of [...itens].sort((a, b) => a.produtoId - b.produtoId)) {
        const r = await cliente.query(
          'UPDATE produtos SET quantidade = quantidade - $2 WHERE id = $1 AND quantidade >= $2 RETURNING preco::float8 AS preco',
          [item.produtoId, item.quantidade],
        );
        if (r.rowCount === 0) {
          await cliente.query('ROLLBACK');
          const existe = await this.pool.query('SELECT 1 FROM produtos WHERE id = $1', [item.produtoId]);
          return { ok: false, motivo: existe.rowCount > 0 ? 'estoque_insuficiente' : 'produto_inexistente', produtoId: item.produtoId };
        }
        total += r.rows[0].preco * item.quantidade;
      }

      total = centavos(total);
      await cliente.query('UPDATE reservas SET valor_total = $2 WHERE pedido_id = $1', [pedidoId, total]);
      await cliente.query('COMMIT');
      return { ok: true, repetida: false, valorTotal: total, itens };
    } catch (erro) {
      await cliente.query('ROLLBACK').catch(() => {});
      throw erro;
    } finally {
      cliente.release();
    }
  }

  /** Devolve ao estoque o que o pedido reservou (compensação). Idempotente: sem reserva, não faz nada. */
  async liberar(pedidoId) {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      const { rows } = await cliente.query('DELETE FROM reservas WHERE pedido_id = $1 RETURNING itens', [pedidoId]);
      if (rows.length === 0) {
        await cliente.query('COMMIT');
        return false;
      }
      for (const item of [...rows[0].itens].sort((a, b) => a.produtoId - b.produtoId)) {
        await cliente.query('UPDATE produtos SET quantidade = quantidade + $2 WHERE id = $1', [item.produtoId, item.quantidade]);
      }
      await cliente.query('COMMIT');
      return true;
    } catch (erro) {
      await cliente.query('ROLLBACK').catch(() => {});
      throw erro;
    } finally {
      cliente.release();
    }
  }
}

module.exports = { RepositorioEstoque };
