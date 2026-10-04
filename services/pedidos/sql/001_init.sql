-- Pedidos. O estado do pedido evolui: PENDENTE -> PAGO ou PENDENTE -> CANCELADO.

CREATE TABLE IF NOT EXISTS pedidos (
  id                 SERIAL PRIMARY KEY,
  -- Chave de idempotência enviada pelo cliente: repetir o POST com a mesma chave NÃO cria outro pedido.
  chave_idempotencia TEXT UNIQUE,
  status             TEXT           NOT NULL CHECK (status IN ('PENDENTE', 'PAGO', 'CANCELADO')),
  motivo             TEXT,
  valor_total        NUMERIC(10, 2),
  itens              JSONB          NOT NULL,
  metodo_pagamento   TEXT           NOT NULL,
  criado_em          TIMESTAMPTZ    NOT NULL DEFAULT now(),
  atualizado_em      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pedidos_status_idx ON pedidos (status);
CREATE INDEX IF NOT EXISTS pedidos_criado_em_idx ON pedidos (criado_em DESC);
