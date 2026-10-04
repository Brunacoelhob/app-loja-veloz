# Operação

## Local (Docker Compose)

```bash
cd deployments
cp .env.example .env        # preencha DB_SENHA, API_KEY e GRAFANA_SENHA
docker compose up -d --build --wait
```

| O quê | Onde |
|---|---|
| API (gateway) | http://localhost:8080 |
| Prometheus / alertas | http://localhost:9090 |
| Grafana (dashboard "Loja Veloz: visão geral") | http://localhost:3004 |

Tudo escuta apenas em `127.0.0.1`. Para parar e apagar dados: `docker compose down -v`.

## Kubernetes

Pré-requisitos: ingress-nginx, cert-manager (ClusterIssuer `letsencrypt`) e um Postgres gerenciado.

```bash
kubectl apply -f infrastructure/k8s/base/namespace.yaml
kubectl -n loja-veloz create secret generic loja-veloz-segredos ...   # veja segredos.exemplo.yaml
kubectl apply -k infrastructure/k8s/overlays/producao
```

Fixe as versões das imagens em `overlays/producao/kustomization.yaml` (não use `latest`). Troque o domínio em `ingress.yaml`.

## Infra (Terraform / GKE)

```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars   # ajuste project_id e cidrs_autorizados
terraform init && terraform plan && terraform apply
```

Use backend remoto (`backend.tf.exemplo`) para trabalho em equipe.

## Alertas configurados

`ServicoForaDoAr` (1 min), `TaxaDeErros5xxAlta` (>5% por 5 min), `LatenciaP95Alta` (>1 s por 10 min).

## Runbook rápido

- **Pedidos `CANCELADO` com `estoque_indisponivel`/`pagamento_indisponivel`**: serviço dependente fora do ar; veja `docker compose ps` / `kubectl get pods`. Os pedidos já compensaram (estoque liberado); o cliente pode repetir.
- **Gateway responde 502/504**: o serviço de destino não respondeu no tempo limite; consulte o painel de latência e filtre os logs por `x-request-id`.
