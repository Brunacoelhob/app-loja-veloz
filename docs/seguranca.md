# Segurança

| Risco | Mitigação |
|---|---|
| Qualquer um criar/ver pedidos | Rotas de pedidos exigem `x-api-key` (comparação em tempo constante); chave obrigatória com ≥16 caracteres (o gateway não sobe sem ela). |
| Acesso direto a serviços internos | Só o gateway é publicado. No Compose a rede `interna` não tem acesso externo; no Kubernetes há `NetworkPolicy` negando tudo por padrão. |
| Métricas expostas | Porta separada (9100), nunca roteada pelo gateway; no K8s só o namespace `monitoring` alcança. |
| Abuso / força bruta | Rate limit no gateway; corpo de requisição limitado. |
| Entradas maliciosas | Validação estrita do payload (tipos, faixas, métodos de pagamento permitidos); SQL 100% parametrizado. |
| Cobrança duplicada | `Idempotency-Key` + saga com compensação. |
| Segredos no repositório | `.env` ignorado pelo Git; Compose usa `${VAR:?}` (falha se faltar); K8s lê de `Secret` criado fora do Git. |
| Contêiner comprometido | Usuário não-root, sistema de arquivos somente leitura, `cap_drop: ALL`, `no-new-privileges`, `seccomp RuntimeDefault`, Pod Security `restricted`. |
| Dependências vulneráveis | `npm audit` no CI; a imagem instala apenas dependências de produção. |
| Cabeçalhos HTTP | `helmet` em todos os serviços; `x-powered-by` desligado. |
| Infra | Cluster GKE com nós privados, API restrita por CIDR, conta de serviço de mínimo privilégio, Shielded Nodes, proteção contra exclusão. |

## Limitações conhecidas

- A autenticação é uma chave de API compartilhada (adequada para B2B/demonstração). Para usuários finais, adote OAuth2/OIDC no gateway.
- O serviço de pagamentos é um simulador.
- A comunicação interna não usa mTLS; em produção, considere uma *service mesh* (Linkerd/Istio).
- No Kubernetes o Postgres deve ser gerenciado (ex.: Cloud SQL); o repositório não provisiona o banco.
