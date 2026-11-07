# Monthly budget of the account, and kill switch: when the actual cost reaches the budget, the budget notifies an SNS
# topic, whose Lambda sets the reserved concurrency of the MCP function to 0. The function URL is public and anonymous:
# an SCP (budget action) would not block its invocations, a concurrency of 0 throttles all of them (HTTP 429).
# The next deploy (terraform apply) restores the concurrency: check the cost before. Budgets refreshes the cost data
# a few times a day, the cost may exceed the budget by a few hours of traffic.

locals {
  kill_switch_name = "${var.name}-kill-switch"
  budget_emails    = [for email in [var.budget_alert_email] : email if email != ""]
}

# ─── Budget ───────────────────────────────────────────────────────────────────

resource "aws_budgets_budget" "monthly" {
  name         = var.name
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Alerts by e-mail (when budget_alert_email is set)
  dynamic "notification" {
    for_each = length(local.budget_emails) > 0 ? [
      { threshold = 50, type = "ACTUAL" },
      { threshold = 80, type = "ACTUAL" },
      { threshold = 100, type = "FORECASTED" },
    ] : []
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value.threshold
      threshold_type             = "PERCENTAGE"
      notification_type          = notification.value.type
      subscriber_email_addresses = local.budget_emails
    }
  }

  # Kill switch
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_sns_topic_arns  = [aws_sns_topic.budget.arn]
    subscriber_email_addresses = local.budget_emails
  }

  depends_on = [aws_sns_topic_policy.budget]
}

# ─── SNS ──────────────────────────────────────────────────────────────────────

# Not encrypted: Budgets publishes to an encrypted topic only with a customer managed key, and the messages only
# contain the budget amounts
resource "aws_sns_topic" "budget" {
  name = "${var.name}-budget"
}

data "aws_iam_policy_document" "budget_topic" {
  statement {
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.budget.arn]

    principals {
      type        = "Service"
      identifiers = ["budgets.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sns_topic_policy" "budget" {
  arn    = aws_sns_topic.budget.arn
  policy = data.aws_iam_policy_document.budget_topic.json
}

resource "aws_sns_topic_subscription" "kill_switch" {
  topic_arn = aws_sns_topic.budget.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.kill_switch.arn
}

# ─── Kill switch Lambda ───────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "kill_switch" {
  name              = "/aws/lambda/${local.kill_switch_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "kill_switch" {
  name               = local.kill_switch_name
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  # Created by bootstrap/: the deploy role can only create this role with it
  permissions_boundary = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/${local.kill_switch_name}-boundary"
}

data "aws_iam_policy_document" "kill_switch" {
  statement {
    actions   = ["lambda:PutFunctionConcurrency"]
    resources = [aws_lambda_function.mcp.arn]
  }

  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.kill_switch.arn}:*"]
  }
}

resource "aws_iam_role_policy" "kill_switch" {
  name   = "kill-switch"
  role   = aws_iam_role.kill_switch.id
  policy = data.aws_iam_policy_document.kill_switch.json
}

data "archive_file" "kill_switch" {
  type        = "zip"
  output_path = "${path.module}/.terraform/kill-switch.zip"

  source {
    filename = "kill_switch.py"
    content  = <<-PYTHON
      import os

      import boto3

      FUNCTION_NAME = os.environ["FUNCTION_NAME"]


      def handler(event, context):
          """Budget exceeded (SNS notification): throttles every invocation of the MCP function."""
          for record in event.get("Records", []):
              print(record.get("Sns", {}).get("Message"))
          boto3.client("lambda").put_function_concurrency(
              FunctionName=FUNCTION_NAME, ReservedConcurrentExecutions=0
          )
          print(f"{FUNCTION_NAME}: reserved concurrency set to 0")
    PYTHON
  }
}

resource "aws_lambda_function" "kill_switch" {
  function_name = local.kill_switch_name
  role          = aws_iam_role.kill_switch.arn

  filename         = data.archive_file.kill_switch.output_path
  source_code_hash = data.archive_file.kill_switch.output_base64sha256

  runtime       = "python3.13"
  handler       = "kill_switch.handler"
  architectures = ["arm64"]
  memory_size   = 128
  timeout       = 30

  environment {
    variables = {
      FUNCTION_NAME = aws_lambda_function.mcp.function_name
    }
  }

  depends_on = [aws_cloudwatch_log_group.kill_switch, aws_iam_role_policy.kill_switch]
}

resource "aws_lambda_permission" "kill_switch_sns" {
  statement_id  = "BudgetTopic"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.kill_switch.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.budget.arn
}
