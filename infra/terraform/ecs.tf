# ---------------- ECS cluster, roles, logs ----------------
resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name}"
  retention_in_days = 30
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.app.arn] }]
  })
}

resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# ---------------- Service discovery (api -> ai) ----------------
resource "aws_service_discovery_private_dns_namespace" "internal" {
  name = "regradar.internal"
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "ai" {
  name = "ai"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.internal.id
    dns_records {
      type = "A"
      ttl  = 10
    }
  }
  health_check_custom_config { failure_threshold = 1 }
}

locals {
  secret = aws_secretsmanager_secret.app.arn
  log = {
    logDriver = "awslogs"
    options = {
      awslogs-group         = aws_cloudwatch_log_group.app.name
      awslogs-region        = var.region
      awslogs-stream-prefix = "app"
    }
  }
  app_url = "https://${aws_cloudfront_distribution.web.domain_name}"
}

# ---------------- AI service (Python) ----------------
resource "aws_ecs_task_definition" "ai" {
  family                   = "${local.name}-ai"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name         = "ai"
    image        = "${aws_ecr_repository.ai.repository_url}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = 8000 }]
    environment = [
      { name = "ANSWER_MODEL", value = var.answer_model },
      { name = "PGSSLMODE", value = "require" },
      { name = "IMPACT_MODEL", value = var.answer_model },
      { name = "LLM_PROVIDER", value = var.llm_provider },
      { name = "LLM_MODEL", value = var.llm_model },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${local.secret}:DATABASE_URL::" },
      { name = "INTERNAL_TOKEN", valueFrom = "${local.secret}:INTERNAL_TOKEN::" },
      { name = "ANTHROPIC_API_KEY", valueFrom = "${local.secret}:ANTHROPIC_API_KEY::" },
      { name = "LLM_API_KEY", valueFrom = "${local.secret}:LLM_API_KEY::" },
    ]
    logConfiguration = local.log
  }])
}

resource "aws_ecs_service" "ai" {
  name            = "ai"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ai.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ai.id]
    assign_public_ip = true # outbound internet without a NAT gateway (regulator sites, Claude API)
  }
  service_registries { registry_arn = aws_service_discovery_service.ai.arn }
}

# ---------------- API service (Node.js) ----------------
resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name         = "api"
    image        = "${aws_ecr_repository.api.repository_url}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = 4000 }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "DB_SSL", value = "true" },
      { name = "AI_SERVICE_URL", value = "http://ai.regradar.internal:8000" },
      { name = "CORS_ORIGINS", value = local.app_url },
      { name = "APP_URL", value = local.app_url },
      { name = "CRON_INTERVAL_MINUTES", value = "0" },
      { name = "SMTP_HOST", value = var.smtp_host },
      { name = "SMTP_PORT", value = tostring(var.smtp_port) },
      { name = "SMTP_USER", value = var.smtp_user },
      { name = "MAIL_FROM", value = var.mail_from },
      { name = "RECAPTCHA_SITE_KEY", value = var.recaptcha_site_key },
      { name = "OPS_ALERT_EMAILS", value = var.alert_email },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = "${local.secret}:DATABASE_URL::" },
      { name = "JWT_SECRET", valueFrom = "${local.secret}:JWT_SECRET::" },
      { name = "INTERNAL_TOKEN", valueFrom = "${local.secret}:INTERNAL_TOKEN::" },
      { name = "CRON_SECRET", valueFrom = "${local.secret}:CRON_SECRET::" },
      { name = "SMTP_PASS", valueFrom = "${local.secret}:SMTP_PASS::" },
      { name = "RECAPTCHA_SECRET_KEY", valueFrom = "${local.secret}:RECAPTCHA_SECRET_KEY::" },
    ]
    logConfiguration = local.log
  }])
}

resource "aws_ecs_service" "api" {
  name            = "api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 4000
  }
  depends_on = [aws_lb_listener.http]
}

# ---------------- Load balancer ----------------
resource "aws_lb" "main" {
  name               = local.name
  load_balancer_type = "application"
  subnets            = aws_subnet.public[*].id
  security_groups    = [aws_security_group.alb.id]
  idle_timeout       = 300
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-api"
  port        = 4000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path    = "/healthz"
    matcher = "200"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
