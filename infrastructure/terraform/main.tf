# Cluster GKE da Loja Veloz.
# Uso:  terraform init && terraform plan -var="project_id=SEU_PROJETO"
# O estado (terraform.tfstate) contém dados sensíveis: em produção use backend remoto (veja backend.tf.exemplo).

terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_service_account" "nos" {
  account_id   = "gke-nos-loja-veloz"
  display_name = "Nós do cluster Loja Veloz (mínimo privilégio)"
}

resource "google_project_iam_member" "nos_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.nos.email}"
}

resource "google_project_iam_member" "nos_metricas" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.nos.email}"
}

resource "google_container_cluster" "primary" {
  name     = var.cluster_name
  location = var.region

  # O node pool padrão é descartado e substituído por um gerenciado separadamente (boa prática).
  remove_default_node_pool = true
  initial_node_count       = 1
  deletion_protection      = var.protecao_contra_exclusao

  # Nós sem IP público; só o plano de controle é alcançável (restrito por CIDR autorizado).
  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  ip_allocation_policy {}

  master_authorized_networks_config {
    dynamic "cidr_blocks" {
      for_each = var.cidrs_autorizados
      content {
        cidr_block   = cidr_blocks.value
        display_name = "autorizado-${cidr_blocks.key}"
      }
    }
  }

  # Permite NetworkPolicy (usadas em infrastructure/k8s/base/networkpolicies.yaml).
  network_policy {
    enabled  = true
    provider = "CALICO"
  }
  addons_config {
    network_policy_config {
      disabled = false
    }
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  release_channel {
    channel = "REGULAR"
  }
}

resource "google_container_node_pool" "principal" {
  name     = "principal"
  cluster  = google_container_cluster.primary.id
  location = var.region

  autoscaling {
    min_node_count = var.nos_minimos
    max_node_count = var.nos_maximos
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }

  node_config {
    machine_type    = var.tipo_maquina
    disk_size_gb    = 30
    service_account = google_service_account.nos.email
    oauth_scopes    = ["https://www.googleapis.com/auth/cloud-platform"]

    shielded_instance_config {
      enable_secure_boot          = true
      enable_integrity_monitoring = true
    }
    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
}
