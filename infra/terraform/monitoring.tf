# Monitoring and alerting on AWS. Complements the app's own alert emails (admin console →
# System health), which can't fire if the API itself is down. Everything here emails
# var.alert_email through an SNS topic (confirm the subscription email AWS sends you once).
#
#   - Outside uptime check: Route 53 checks https://<app>/api/health/ready from several
#     regions every 30 s (database + AI service must answer).
#   - Load balancer: 5xx errors, no healthy API servers, slow responses.
#   - ECS: a service has no running task, or CPU / memory stays high.
#   - RDS: CPU high, storage or memory running out.

variable "alert_email" {
  description = "Email address for AWS alarms (leave empty to create the alarms without email)."
  type        = string
  default     = ""
}

# Route 53 health-check metrics only exist in us-east-1, so that alarm (and its topic) lives there.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags { tags = { Project = "regradar", Env = var.env } }
}

resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_sns_topic" "alerts_us_east_1" {
  provider = aws.us_east_1
  name     = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email_us_east_1" {
  provider  = aws.us_east_1
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts_us_east_1.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  alarm_actions = [aws_sns_topic.alerts.arn]
  alb_dims      = { LoadBalancer = aws_lb.main.arn_suffix }
  tg_dims       = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
}

# ---------------- Outside uptime check ----------------
resource "aws_route53_health_check" "app" {
  fqdn              = aws_cloudfront_distribution.web.domain_name
  type              = "HTTPS"
  port              = 443
  resource_path     = "/api/health/ready"
  request_interval  = 30
  failure_threshold = 3
  measure_latency   = true
  tags              = { Name = "${local.name}-uptime" }
}

resource "aws_cloudwatch_metric_alarm" "uptime" {
  provider            = aws.us_east_1
  alarm_name          = "${local.name}-site-down"
  alarm_description   = "RegRadar is not answering https://${aws_cloudfront_distribution.web.domain_name}/api/health/ready (database or AI service down, or the site is unreachable)."
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  dimensions          = { HealthCheckId = aws_route53_health_check.app.id }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts_us_east_1.arn]
  ok_actions          = [aws_sns_topic.alerts_us_east_1.arn]
}

# ---------------- Load balancer ----------------
resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${local.name}-api-5xx"
  alarm_description   = "The API returned 10+ server errors (5xx) in 5 minutes. Details: Admin console → Errors."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = local.alb_dims
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 10
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "api_unhealthy" {
  alarm_name          = "${local.name}-api-no-healthy-servers"
  alarm_description   = "The load balancer has no healthy API server: the app is down for everyone."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  dimensions          = local.tg_dims
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "api_slow" {
  alarm_name          = "${local.name}-api-slow"
  alarm_description   = "10% of API requests took over 15 seconds for 15 minutes."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  dimensions          = local.alb_dims
  extended_statistic  = "p90"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 15
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# ---------------- ECS services ----------------
resource "aws_cloudwatch_metric_alarm" "service_down" {
  for_each            = toset(["api", "ai"])
  alarm_name          = "${local.name}-${each.key}-not-running"
  alarm_description   = "The ${each.key} service has no running task."
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  dimensions          = { ClusterName = aws_ecs_cluster.main.name, ServiceName = each.key }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "service_cpu" {
  for_each            = toset(["api", "ai"])
  alarm_name          = "${local.name}-${each.key}-cpu-high"
  alarm_description   = "The ${each.key} service has used over 85% CPU for 15 minutes; it may need a bigger task size or a second task."
  namespace           = "AWS/ECS"
  metric_name         = "CPUUtilization"
  dimensions          = { ClusterName = aws_ecs_cluster.main.name, ServiceName = each.key }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 85
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "service_memory" {
  for_each            = toset(["api", "ai"])
  alarm_name          = "${local.name}-${each.key}-memory-high"
  alarm_description   = "The ${each.key} service has used over 85% of its memory for 15 minutes; it may be restarted when it runs out."
  namespace           = "AWS/ECS"
  metric_name         = "MemoryUtilization"
  dimensions          = { ClusterName = aws_ecs_cluster.main.name, ServiceName = each.key }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 85
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# ---------------- Database ----------------
resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  alarm_name          = "${local.name}-db-cpu-high"
  alarm_description   = "The database has used over 80% CPU for 15 minutes."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "db_storage" {
  alarm_name          = "${local.name}-db-storage-low"
  alarm_description   = "Less than 2 GB of database storage left. Increase allocated storage before it fills up."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "LessThanThreshold"
  threshold           = 2 * 1024 * 1024 * 1024
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "db_memory" {
  alarm_name          = "${local.name}-db-memory-low"
  alarm_description   = "The database has less than 64 MB of free memory for 15 minutes; queries will slow down."
  namespace           = "AWS/RDS"
  metric_name         = "FreeableMemory"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "LessThanThreshold"
  threshold           = 64 * 1024 * 1024
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

output "uptime_check_url" {
  value = "https://${aws_cloudfront_distribution.web.domain_name}/api/health/ready"
}
