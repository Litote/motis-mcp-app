# MCP server as a native (GraalVM) Lambda, exposed by a public function URL: https://<id>.lambda-url.<region>.on.aws/mcp

locals {
  # Dedicated origins of the views on the custom domain. Behind CloudFront, the function receives the requests with the
  # host of its URL, not the public one: the Claude origin, computed from the URL of the endpoint, would not be the one
  # registered in Claude (https://<domain_name>/mcp/claude). var.view_domains overrides them.
  default_view_domains = var.domain_name == "" ? {} : {
    chatgpt = "https://${var.domain_name}"
    claude  = "${substr(sha256("https://${var.domain_name}/mcp/claude"), 0, 32)}.claudemcpcontent.com"
  }
  view_domains = merge(local.default_view_domains, var.view_domains)

  optional_env = merge(
    var.tile_url != "" ? { MOTIS_TILE_URL = var.tile_url } : {},
    var.tile_attribution != "" ? { MOTIS_TILE_ATTRIBUTION = var.tile_attribution } : {},
    var.rail_overlay != "" ? { MOTIS_RAIL_OVERLAY = var.rail_overlay } : {},
    var.vector_tile_url != "" ? { MOTIS_VECTOR_TILE_URL = var.vector_tile_url } : {},
    # name of the instance shown by the MCP clients, e.g. Errance; its website: the web chat on the custom domain
    var.app_title != "" ? { MOTIS_APP_TITLE = var.app_title } : {},
    var.domain_name != "" ? { MOTIS_APP_WEBSITE_URL = "https://${var.domain_name}" } : {},
    { for host, domain in local.view_domains : "MOTIS_VIEW_DOMAIN_${upper(host)}" => domain if domain != "" },
  )
}

# ─── Logs ─────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_days
}

# ─── IAM ──────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.name}-lambda"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  # Created by bootstrap/: the deploy role can only create this role with it
  permissions_boundary = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/${var.name}-lambda-boundary"
}

# Logs
resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Stations of the journeys between cities: read and written by the Lambda
data "aws_iam_policy_document" "city_stations" {
  statement {
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
    resources = [aws_dynamodb_table.city_stations.arn]
  }
}

resource "aws_iam_role_policy" "city_stations" {
  name   = "city-stations"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.city_stations.json
}

# ─── DynamoDB ─────────────────────────────────────────────────────────────────

# Stations of the journeys between two cities (e.g. Paris Montparnasse and Massy TGV to Nantes), discovered from the
# journeys between their centers: a cache, rebuilt by the server when lost (no backup). Pairs not discovered again
# for 30 days are deleted by the TTL.
resource "aws_dynamodb_table" "city_stations" {
  name         = "${var.name}-city-stations"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pair"

  attribute {
    name = "pair"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

# ─── Origin secret ────────────────────────────────────────────────────────────

# Sent by CloudFront to the function URL (custom origin header, web.tf) and checked by the Lambda: the function URL
# stays public (an OAC would need the SHA-256 of the body of every POST from the MCP clients), but its requests that do
# not come through CloudFront are rejected (403) before any work. Changed by `terraform apply -replace=random_password.origin_secret`:
# the requests fail until both the Lambda and the distribution are updated.
resource "random_password" "origin_secret" {
  length  = 40
  special = false
}

# ─── Lambda ───────────────────────────────────────────────────────────────────

resource "aws_lambda_function" "mcp" {
  function_name = var.name
  role          = aws_iam_role.lambda.arn

  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)

  runtime       = "provided.al2023"
  handler       = "bootstrap"
  architectures = [var.architecture]
  memory_size   = var.memory_mb
  timeout       = var.timeout_seconds

  reserved_concurrent_executions = var.reserved_concurrency

  environment {
    variables = merge({
      MOTIS_APP_CONTACT = var.motis_app_contact
      MOTIS_BASE_URL    = var.motis_base_url
      MOTIS_LOG_LEVEL   = var.motis_log_level
      # AWS_REGION is set by Lambda
      MOTIS_CITY_STATIONS_TABLE = aws_dynamodb_table.city_stations.name
      MOTIS_ORIGIN_SECRET       = random_password.origin_secret.result
      # tool calls a minute of a client on one instance (RequestGuard.kt)
      MOTIS_RATE_LIMIT_PER_MINUTE = tostring(var.rate_limit_per_minute)
    }, local.optional_env)
  }

  # MOTIS_APP_LOG_LEVEL (level of the logs, warn when not set) is set by the workflow lambda-log-level.yml, without
  # deploy: kept by the deploys
  lifecycle {
    ignore_changes = [environment[0].variables["MOTIS_APP_LOG_LEVEL"]]
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy_attachment.basic_execution,
    aws_iam_role_policy.city_stations,
  ]
}

# ─── Function URL ─────────────────────────────────────────────────────────────

# Public endpoint without authentication, like a remote MCP connector without OAuth, behind the app distribution: the
# requests without its origin header are rejected by the Lambda
resource "aws_lambda_function_url" "mcp" {
  function_name      = aws_lambda_function.mcp.function_name
  authorization_type = "NONE"

  # CORS handled here: the Ktor CORS plugin is not on the Lambda classpath
  # (cache-control: sent by some clients on the SSE GET, as the MCP Kotlin SDK in a browser)
  cors {
    allow_origins  = var.cors_allow_origins
    allow_methods  = ["POST", "GET", "DELETE"]
    allow_headers  = ["content-type", "accept", "authorization", "mcp-protocol-version", "mcp-session-id", "last-event-id", "cache-control"]
    expose_headers = ["mcp-session-id"]
    max_age        = 86400
  }
}

# A public function URL needs both permissions (lambda:InvokeFunctionUrl, and lambda:InvokeFunction via the URL)
resource "aws_lambda_permission" "function_url" {
  statement_id           = "FunctionUrlPublicAccess"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.mcp.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "function_url_invoke" {
  statement_id             = "FunctionUrlInvokeFunction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.mcp.function_name
  principal                = "*"
  invoked_via_function_url = true
}
