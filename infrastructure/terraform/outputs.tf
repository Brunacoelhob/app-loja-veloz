output "kubernetes_cluster_name" {
  value = google_container_cluster.primary.name
}

output "kubernetes_cluster_endpoint" {
  value     = google_container_cluster.primary.endpoint
  sensitive = true
}
