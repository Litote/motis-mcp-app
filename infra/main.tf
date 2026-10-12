# MCP server as a native (GraalVM) Lambda, exposed by a public function URL: https://<id>.lambda-url.<region>.on.aws/mcp

locals {
  optional_env = merge(
    var.tile_url != "" ? { MOTIS_TILE_URL = var.tile_url } : {},
    var.tile_attribution != "" ? { MOTIS_TILE_ATTRIBUTION = var.tile_attribution } : {},
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
}

# Logs only: the server calls MOTIS and no other AWS service
resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
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
    }, local.optional_env)
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy_attachment.basic_execution,
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
