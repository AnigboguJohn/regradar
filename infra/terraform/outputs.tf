output "app_url" {
  description = "Open this in your browser."
  value       = "https://${aws_cloudfront_distribution.web.domain_name}"
}

output "web_bucket" { value = aws_s3_bucket.web.bucket }
output "cloudfront_id" { value = aws_cloudfront_distribution.web.id }
output "ecr_api" { value = aws_ecr_repository.api.repository_url }
output "ecr_ai" { value = aws_ecr_repository.ai.repository_url }
output "ecs_cluster" { value = aws_ecs_cluster.main.name }
output "region" { value = var.region }

# Used by scripts/admin-aws.sh to run the admin command-line tool as a one-off task.
output "api_task_definition" { value = aws_ecs_task_definition.api.family }
output "api_subnets" { value = join(",", aws_subnet.public[*].id) }
output "api_security_group" { value = aws_security_group.api.id }
