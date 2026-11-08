# MCP server as a native (GraalVM) Lambda, exposed by a public function URL: https://<id>.lambda-url.<region>.on.aws/mcp

locals {
  optional_env = merge(
    var.tile_url != "" ? { MOTIS_TILE_URL = var.tile_url } : {},
    var.tile_attribution != "" ? { MOTIS_TILE_ATTRIBUTION = var.tile_attribution } : {},
    var.rail_overlay != "" ? { MOTIS_RAIL_OVERLAY = var.rail_overlay } : {},
    { for host, domain in var.view_domains : "MOTIS_VIEW_DOMAIN_${upper(host)}" => domain if domain != "" },
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
    }, local.optional_env)
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy_attachment.basic_execution,
    aws_iam_role_policy.city_stations,
  ]
}

# ─── Function URL ─────────────────────────────────────────────────────────────

# Public endpoint without authentication, like a remote MCP connector without OAuth
resource "aws_lambda_function_url" "mcp" {
  function_name      = aws_lambda_function.mcp.function_name
  authorization_type = "NONE"

  # CORS handled here: the Ktor CORS plugin is not on the Lambda classpath
  cors {
    allow_origins  = var.cors_allow_origins
    allow_methods  = ["POST", "GET", "DELETE"]
    allow_headers  = ["content-type", "accept", "authorization", "mcp-protocol-version", "mcp-session-id", "last-event-id"]
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
