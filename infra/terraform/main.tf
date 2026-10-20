# RegRadar on AWS: low-cost production layout
#
#   CloudFront ──► S3 (React app)
#        └─/api/*──► ALB ──► ECS Fargate "api" (Node.js) ──► ECS Fargate "ai" (Python, private via Cloud Map)
#                                     │                              │
#                                     └──────────► RDS PostgreSQL 16 + pgvector ◄┘
#   EventBridge (every N hours) ──► ALB /internal/cron/monitor  (secret header)
#
# Cost notes: no NAT gateway (Fargate tasks get public IPs, locked down by security groups);
# RDS is single-AZ db.t4g.micro. Expect roughly $45–70/month at idle. Destroy with `terraform destroy`.

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.80" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" {
  region = var.region
  default_tags { tags = { Project = "regradar", Env = var.env } }
}

locals {
  name = "regradar-${var.env}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)
}

data "aws_availability_zones" "available" { state = "available" }
data "aws_caller_identity" "me" {}

# ---------------- Network ----------------
resource "aws_vpc" "main" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = local.name }
}

resource "aws_internet_gateway" "igw" { vpc_id = aws_vpc.main.id }

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)
  availability_zone = local.azs[count.index]
  tags              = { Name = "${local.name}-private-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ---------------- Security groups ----------------
resource "aws_security_group" "alb" {
  name   = "${local.name}-alb"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "api" {
  name   = "${local.name}-api"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 4000
    to_port         = 4000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "ai" {
  name   = "${local.name}-ai"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name   = "${local.name}-db"
  vpc_id = aws_vpc.main.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id, aws_security_group.ai.id]
  }
}

# ---------------- Database ----------------
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier                 = local.name
  engine                     = "postgres"
  engine_version             = "16"
  instance_class             = var.db_instance_class
  allocated_storage          = 20
  max_allocated_storage      = 100
  storage_encrypted          = true
  db_name                    = "regradar"
  username                   = "regradar"
  password                   = random_password.db.result
  db_subnet_group_name       = aws_db_subnet_group.main.name
  vpc_security_group_ids     = [aws_security_group.db.id]
  backup_retention_period    = 7
  auto_minor_version_upgrade = true
  skip_final_snapshot        = var.env != "prod"
  final_snapshot_identifier  = var.env == "prod" ? "${local.name}-final" : null
  deletion_protection        = var.env == "prod"
}

# ---------------- Secrets ----------------
resource "random_password" "jwt" {
  length  = 48
  special = false
}

resource "random_password" "internal" {
  length  = 40
  special = false
}

resource "random_password" "cron" {
  length  = 40
  special = false
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name}/app"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id = aws_secretsmanager_secret.app.id
  secret_string = jsonencode({
    DATABASE_URL         = "postgresql://regradar:${random_password.db.result}@${aws_db_instance.main.address}:5432/regradar"
    JWT_SECRET           = random_password.jwt.result
    INTERNAL_TOKEN       = random_password.internal.result
    CRON_SECRET          = random_password.cron.result
    ANTHROPIC_API_KEY    = var.anthropic_api_key
    LLM_API_KEY          = var.llm_api_key
    SMTP_PASS            = var.smtp_pass
    RECAPTCHA_SECRET_KEY = var.recaptcha_secret_key
  })
}

# ---------------- Container registry ----------------
resource "aws_ecr_repository" "api" {
  name         = "${local.name}-api"
  force_delete = true
}

resource "aws_ecr_repository" "ai" {
  name         = "${local.name}-ai"
  force_delete = true
}
