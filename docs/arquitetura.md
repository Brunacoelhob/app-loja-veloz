# Arquitetura

## Visão geral

```
 Internet ──► api-gateway ──┬─► estoque ───► Postgres (estoque_db)
 (x-api-key)   (único       │
               exposto)     └─► pedidos ──┬─► estoque     (reserva/liberação)
                                          ├─► pagamentos  (cobrança)
                                          └─► Postgres (pedidos_db)
```

| Serviço | Responsabilidade | Dados |
|---|---|---|
| api-gateway | Porta de entrada: autenticação por chave, rate limit, timeouts, repasse de `Idempotency-Key`/`x-request-id`. Não expõe pagamentos, reservas nem métricas. | nenhum |
| pedidos | Orquestra a *saga* de criação de pedido. | `pedidos_db` |
| estoque | Catálogo e quantidades; reserva atômica. | `estoque_db` |
| pagamentos | Simula a cobrança (substitua pelo provedor real). | nenhum |

Cada serviço é dono do seu banco; nenhum acessa o banco do outro (só via HTTP).

## Fluxo de criação de pedido (saga com compensação)

1. **Idempotência**: se a `Idempotency-Key` já existe, devolve o pedido original (cabeçalho `idempotent-replayed: true`). Evita cobrança dupla em reenvios/retries.
2. Cria o pedido `PENDENTE`.
3. **Reserva estoque** (no serviço de estoque): transação única; para cada item `UPDATE … SET quantidade = quantidade - n WHERE quantidade >= n`. Sem estoque → `409` → pedido `CANCELADO (estoque_insuficiente)`.
4. **Cobra** (serviço de pagamentos). Recusado → `402` → **compensação**: libera a reserva → `CANCELADO (pagamento_recusado)`.
5. Sucesso → `PAGO`.

Falha técnica de um dependente (timeout, indisponível) também dispara compensação e deixa o pedido `CANCELADO` com o motivo correspondente; nunca fica estoque preso.

## Decisões de projeto

- **Concorrência**: a verificação e a baixa do estoque são uma única instrução condicional, e os itens são processados em ordem de `produtoId` para evitar *deadlock*. Reservar o mesmo pedido duas vezes é idempotente (`ON CONFLICT DO NOTHING`).
- **Resiliência**: timeout por chamada; erros de dependência viram respostas controladas (nunca vazam stack trace); *graceful shutdown* (SIGTERM drena conexões).
- **Migrações**: SQL versionado, aplicado no start sob *advisory lock* (várias réplicas subindo juntas não colidem).
- **Observabilidade**: logs JSON com `x-request-id` atravessando os serviços; métricas Prometheus em porta interna separada (9100); dashboard e alertas provisionados.
- **Segurança**: veja [seguranca.md](seguranca.md).
