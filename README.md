# Loja Veloz

[![CI](https://github.com/Brunacoelhob/loja-veloz-cloud-native/actions/workflows/ci.yml/badge.svg)](https://github.com/Brunacoelhob/loja-veloz-cloud-native/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A522-339933)
![License](https://img.shields.io/badge/license-MIT-blue)

Plataforma de e-commerce em **microsserviços** (Node.js + PostgreSQL), pensada para nuvem: *API Gateway*, **saga com compensação**, idempotência, observabilidade (Prometheus/Grafana), Docker Compose, Kubernetes (Kustomize) e Terraform (GKE).

```
Cliente ─► api-gateway ─┬─► estoque ──► Postgres
                        └─► pedidos ──┬─► estoque
                                      ├─► pagamentos
                                      └─► Postgres
```

## Destaques de engenharia

- **Integridade sob concorrência**: baixa de estoque atômica (`UPDATE … WHERE quantidade >= n`), sem *overselling*.
- **Saga de pedido** com compensação: falhou o pagamento, o estoque reservado volta.
- **Idempotência** por `Idempotency-Key`: reenvio não cobra duas vezes.
- **Seguro por padrão**: só o gateway é público, chave de API, rate limit, validação, contêineres não-root e somente leitura, `NetworkPolicy`.
- **Observável**: logs JSON com `x-request-id` ponta a ponta, métricas, dashboard e alertas prontos.
- **Operável**: health checks, *graceful shutdown*, migrações com *advisory lock*, HPA e PDB.
- **43 testes** automatizados + teste de integração ponta a ponta no CI.

## Como rodar

```bash
cd deployments
cp .env.example .env     # preencha as senhas/chave
docker compose up -d --build --wait
```

```bash
# catálogo (público)
curl localhost:8080/api/estoque

# criar pedido (exige chave)
curl -X POST localhost:8080/api/pedidos \
  -H "x-api-key: $API_KEY" -H "content-type: application/json" \
  -H "Idempotency-Key: pedido-0001" \
  -d '{"metodoPagamento":"pix","itens":[{"produtoId":1,"quantidade":2}]}'
```

Grafana em http://localhost:3004 · Prometheus em http://localhost:9090.

## API

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/estoque`, `/api/estoque/:id` | – | Catálogo e quantidade |
| POST | `/api/pedidos` | `x-api-key` | Cria pedido (`201` pago · `402` pagamento recusado · `409` sem estoque · `404` produto inexistente) |
| GET | `/api/pedidos`, `/api/pedidos/:id` | `x-api-key` | Consulta pedidos |
| GET | `/saude`, `/pronto` | – | Liveness / readiness |

`metodoPagamento`: `cartao`, `pix` ou `boleto`. Cabeçalho opcional `Idempotency-Key`.

## Testes

```bash
cd services/pedidos && npm ci && npm test   # idem para api-gateway, estoque e pagamentos
```

Usam o runner nativo do Node (`node --test`), sem dependências extras.

## Documentação

- [Arquitetura](docs/arquitetura.md)
- [Segurança](docs/seguranca.md)
- [Operação](docs/operacao.md)

## Estrutura

```
services/        api-gateway, pedidos, estoque, pagamentos
deployments/     Docker Compose, Prometheus, Grafana
infrastructure/  k8s (Kustomize) e terraform (GKE)
docs/            arquitetura, segurança, operação
```

## Licença

[MIT](LICENSE)
