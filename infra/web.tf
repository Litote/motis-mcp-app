# Web chat (web/): static files on S3, served by two CloudFront distributions:
#   - app:     the chat (index.html), with a strict CSP (the OpenRouter key of the user lives in this origin), and the
#              MCP endpoint (/mcp*, proxied to the Lambda function URL): one origin for the chat and its MCP server
#   - sandbox: sandbox.html, the outer frame of the MCP App views, on another origin so that a view cannot reach the
#              app; its CSP is built per view by a CloudFront Function (web/sandbox-csp.cjs)
# The files are uploaded by `make web` / CI (aws s3 sync); config.json is written here.

data "aws_caller_identity" "current" {}

locals {
  function_url_host = trimsuffix(trimprefix(aws_lambda_function_url.mcp.function_url, "https://"), "/")

  app_origin     = "https://${local.custom_domain ? var.domain_name : aws_cloudfront_distribution.app.domain_name}"
  sandbox_origin = "https://${local.custom_domain ? local.sandbox_domain : aws_cloudfront_distribution.sandbox.domain_name}"

  # CloudFront certificate: the custom domain one, or the default *.cloudfront.net one
  acm_certificate_arn = local.custom_domain ? aws_acm_certificate_validation.web[0].certificate_arn : null

  # Scripts of the app only; models and MCP (same origin) called from the browser; views only in the sandbox frames
  app_csp = join("; ", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' https://openrouter.ai",
    "frame-src ${local.sandbox_origin}",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ])
}

# ─── Bucket ───────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "web" {
  bucket        = "${var.name}-web-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Runtime configuration of the app and of the sandbox (web/src/config.ts)
resource "aws_s3_object" "config" {
  bucket        = aws_s3_bucket.web.id
  key           = "config.json"
  content_type  = "application/json"
  cache_control = "no-cache"
  content = jsonencode({
    mcpUrl      = "${local.app_origin}/mcp"
    sandboxUrl  = "${local.sandbox_origin}/sandbox.html"
    hostOrigins = [local.app_origin]
  })
}

# Read access for the two distributions only (origin access control)
data "aws_iam_policy_document" "web_bucket" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.app.arn, aws_cloudfront_distribution.sandbox.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket     = aws_s3_bucket.web.id
  policy     = data.aws_iam_policy_document.web_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.web]
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.name}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

# A function URL rejects a Host header other than its own
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

# ─── App distribution ─────────────────────────────────────────────────────────

resource "aws_cloudfront_response_headers_policy" "app" {
  name = "${var.name}-app"

  security_headers_config {
    content_security_policy {
      content_security_policy = local.app_csp
      override                = true
    }
    content_type_options {
      override = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = false
      override                   = true
    }
  }
}

resource "aws_cloudfront_distribution" "app" {
  enabled             = true
  comment             = "${var.name} web chat"
  default_root_object = "index.html"
  price_class         = var.web_price_class
  http_version        = "http2and3"
  aliases             = local.custom_domain ? [var.domain_name] : []

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = "mcp"
    domain_name = local.function_url_host
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      # the Lambda timeout (var.timeout_seconds); 60 s is the CloudFront maximum without a quota increase
      origin_read_timeout = 60
    }
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.app.id
  }

  # MCP endpoint (/mcp and /mcp/<host>): not cached, every method, CORS answered by the function URL
  ordered_cache_behavior {
    path_pattern             = "/mcp*"
    target_origin_id         = "mcp"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.custom_domain
    acm_certificate_arn            = local.acm_certificate_arn
    ssl_support_method             = local.custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.custom_domain ? "TLSv1.2_2021" : null
  }
}

# ─── Sandbox distribution ─────────────────────────────────────────────────────

resource "aws_cloudfront_function" "sandbox_csp" {
  name    = "${var.name}-sandbox-csp"
  runtime = "cloudfront-js-2.0"
  comment = "CSP of the MCP App view sandbox, from the csp query parameter"
  publish = true
  code    = file("${path.module}/../web/sandbox-csp.cjs")
}

resource "aws_cloudfront_distribution" "sandbox" {
  enabled             = true
  comment             = "${var.name} view sandbox"
  default_root_object = "sandbox.html"
  price_class         = var.web_price_class
  http_version        = "http2and3"
  aliases             = local.custom_domain ? [local.sandbox_domain] : []

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  # sandbox.html: not cached, its CSP depends on the query parameter
  default_cache_behavior {
    target_origin_id       = "web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.disabled.id

    function_association {
      event_type   = "viewer-response"
      function_arn = aws_cloudfront_function.sandbox_csp.arn
    }
  }

  # scripts of sandbox.html
  ordered_cache_behavior {
    path_pattern           = "/assets/*"
    target_origin_id       = "web"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.custom_domain
    acm_certificate_arn            = local.acm_certificate_arn
    ssl_support_method             = local.custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.custom_domain ? "TLSv1.2_2021" : null
  }
}
