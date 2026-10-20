# ---------------- Frontend: private S3 bucket behind CloudFront ----------------
resource "aws_s3_bucket" "web" {
  bucket        = "${local.name}-web-${data.aws_caller_identity.me.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${local.name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" { name = "Managed-CachingOptimized" }
data "aws_cloudfront_cache_policy" "disabled" { name = "Managed-CachingDisabled" }
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" { name = "Managed-AllViewerExceptHostHeader" }

# Single-page app: app paths such as /ask, /settings or /admin/users have no file in S3,
# so they are served index.html and the React router takes over. Paths with a file
# extension (/assets/index-abc.js, /favicon.ico) are left alone.
resource "aws_cloudfront_function" "spa" {
  name    = "${local.name}-spa"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var req = event.request;
      var last = req.uri.split("/").pop();
      if (last.indexOf(".") === -1) req.uri = "/index.html";
      return req;
    }
  EOT
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_All" # includes edge locations in Africa

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = "api"
    domain_name = aws_lb.main.dns_name
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only" # add an ACM cert + HTTPS listener when you attach a domain
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  default_cache_behavior {
    target_origin_id       = "web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  # Single-page app routing is done by the "spa" function on the web behaviour only. (Distribution-wide
  # custom_error_response would also turn the API's own 403/404 JSON errors into the web page.)

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate { cloudfront_default_certificate = true }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.web.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.web.arn } }
    }]
  })
}

# ---------------- Scheduled monitoring (EventBridge -> API) ----------------
resource "aws_cloudwatch_event_connection" "cron" {
  name               = "${local.name}-cron"
  authorization_type = "API_KEY"
  auth_parameters {
    api_key {
      key   = "x-cron-secret"
      value = random_password.cron.result
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "cron" {
  name                             = "${local.name}-monitor"
  connection_arn                   = aws_cloudwatch_event_connection.cron.arn
  invocation_endpoint              = "http://${aws_lb.main.dns_name}/internal/cron/monitor"
  http_method                      = "POST"
  invocation_rate_limit_per_second = 1
}

resource "aws_cloudwatch_event_rule" "monitor" {
  name                = "${local.name}-monitor"
  schedule_expression = "rate(${var.monitor_every_hours} hours)"
}

resource "aws_iam_role" "events" {
  name = "${local.name}-events"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "events.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "events" {
  role = aws_iam_role.events.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "events:InvokeApiDestination", Resource = aws_cloudwatch_event_api_destination.cron.arn }]
  })
}

resource "aws_cloudwatch_event_target" "monitor" {
  rule     = aws_cloudwatch_event_rule.monitor.name
  arn      = aws_cloudwatch_event_api_destination.cron.arn
  role_arn = aws_iam_role.events.arn
  http_target {
    header_parameters = { "content-type" = "application/json" }
  }
  input = "{}"
}
