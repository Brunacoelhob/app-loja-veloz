-- Estoque: produtos e reservas por pedido.
-- As regras de integridade moram no banco: o estoque NUNCA fica negativo, mesmo sob requisições simultâneas.

CREATE TABLE IF NOT EXISTS produtos (
  id         SERIAL PRIMARY KEY,
  nome       TEXT           NOT NULL,
  preco      NUMERIC(10, 2) NOT NULL CHECK (preco >= 0),
  quantidade INTEGER        NOT NULL CHECK (quantidade >= 0)
);

-- Uma reserva por pedido (a chave primária é o que torna a reserva IDEMPOTENTE).
CREATE TABLE IF NOT EXISTS reservas (
  pedido_id   INTEGER PRIMARY KEY,
  itens       JSONB          NOT NULL,
  valor_total NUMERIC(10, 2) NOT NULL DEFAULT 0,
  criada_em   TIMESTAMPTZ    NOT NULL DEFAULT now()
);

-- Catálogo inicial de demonstração (só entra se a tabela estiver vazia).
INSERT INTO produtos (nome, preco, quantidade)
SELECT * FROM (VALUES
  ('Camiseta', 59.90, 100),
  ('Tênis', 299.90, 40),
  ('Mochila', 189.90, 25)
) AS demo(nome, preco, quantidade)
WHERE NOT EXISTS (SELECT 1 FROM produtos);
