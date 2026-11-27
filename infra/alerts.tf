# Abuse alarms, by e-mail (budget_alert_email): the Lambda logs a line with a marker when it rejects a request
# (RequestGuard.kt), counted by a metric filter; an alarm goes off when it counts one in 5 minutes, and is notified
# once until it is back to OK. Without e-mail, the alarms are only visible in the CloudWatch console.
#   - origin rejected: the function URL called directly, without the origin header of CloudFront (logged once a
#     minute per instance)
#   - rate limited: a client above rate_limit_per_minute tool calls (logged once per client and per minute, with a
#     pseudonym of the client, no IP address)

locals {
  alarm_namespace = var.name
  abuse_alarms = {
    origin-rejected = {
      marker      = "ORIGIN_REJECTED"
      metric      = "OriginRejected"
      description = "Requests to the function URL without the origin header of CloudFront (called directly): see the logs of ${aws_cloudwatch_log_group.lambda.name}."
    }
    rate-limited = {
      marker      = "RATE_LIMITED"
      metric      = "RateLimited"
      description = "Clients above ${var.rate_limit_per_minute} tool calls a minute: see the logs of ${aws_cloudwatch_log_group.lambda.name}."
    }
  }
}

# Another topic than the budget one: its subscription is the kill switch. Not encrypted: CloudWatch publishes to an
# encrypted topic only with a customer managed key (1 USD a month), and the messages only contain the alarm states
resource "aws_sns_topic" "alerts" {
  name = "${var.name}-alerts"
}

# To confirm from the e-mail sent by AWS
resource "aws_sns_topic_subscription" "alerts_email" {
  for_each  = toset(local.budget_emails)
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

resource "aws_cloudwatch_log_metric_filter" "abuse" {
  for_each       = local.abuse_alarms
  name           = "${var.name}-${each.key}"
  log_group_name = aws_cloudwatch_log_group.lambda.name
  pattern        = "\"${each.value.marker}\""

  metric_transformation {
    name      = each.value.metric
    namespace = local.alarm_namespace
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "abuse" {
  for_each          = local.abuse_alarms
  alarm_name        = "${var.name}-${each.key}"
  alarm_description = each.value.description

  namespace           = local.alarm_namespace
  metric_name         = each.value.metric
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]

  depends_on = [aws_cloudwatch_log_metric_filter.abuse]
}
