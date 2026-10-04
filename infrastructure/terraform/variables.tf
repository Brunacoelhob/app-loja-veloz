variable "project_id" {
  description = "ID do projeto no Google Cloud."
  type        = string
}

variable "region" {
  description = "Região do cluster."
  type        = string
  default     = "us-central1"
}

variable "cluster_name" {
  type    = string
  default = "cluster-loja-veloz"
}

variable "tipo_maquina" {
  type    = string
  default = "e2-medium"
}

variable "nos_minimos" {
  description = "Mínimo de nós por zona."
  type        = number
  default     = 1
}

variable "nos_maximos" {
  description = "Máximo de nós por zona."
  type        = number
  default     = 3
}

variable "cidrs_autorizados" {
  description = "Redes autorizadas a acessar a API do Kubernetes (ex.: o IP do escritório/CI). Vazio = ninguém."
  type        = map(string)
  default     = {}
}

variable "protecao_contra_exclusao" {
  description = "Impede 'terraform destroy' acidental do cluster."
  type        = bool
  default     = true
}
