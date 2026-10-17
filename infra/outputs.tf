output "mcp_url" {
  description = "MCP endpoint, to declare as a remote connector (Claude, ChatGPT, VS Code…)."
  value       = "${local.app_origin}/mcp"
}

output "function_url" {
  description = "Lambda function URL, behind the /mcp* behavior of the app distribution."
  value       = aws_lambda_function_url.mcp.function_url
}

output "function_name" {
  value = aws_lambda_function.mcp.function_name
}

output "log_group" {
  value = aws_cloudwatch_log_group.lambda.name
}

output "web_url" {
  description = "Web chat (OpenRouter, bring your own key)."
  value       = "${local.app_origin}/"
}

output "web_bucket" {
  description = "Bucket of the web chat files (make web / CI: aws s3 sync)."
  value       = aws_s3_bucket.web.id
}

output "web_distribution_ids" {
  description = "CloudFront distributions to invalidate after an upload."
  value       = [aws_cloudfront_distribution.app.id, aws_cloudfront_distribution.sandbox.id]
}

output "certificate_validation_records" {
  description = "CNAME records validating the custom domain certificate, to create at the DNS provider (make certificate)."
  value = local.custom_domain ? {
    for option in aws_acm_certificate.web[0].domain_validation_options : option.resource_record_name => option.resource_record_value
  } : {}
}

output "dns_records" {
  description = "CNAME records of the custom domains, to create at the DNS provider."
  value = local.custom_domain ? {
    (var.domain_name)      = aws_cloudfront_distribution.app.domain_name
    (local.sandbox_domain) = aws_cloudfront_distribution.sandbox.domain_name
  } : {}
}
