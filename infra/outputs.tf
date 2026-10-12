output "mcp_url" {
  description = "MCP endpoint, to declare as a remote connector (Claude, ChatGPT, VS Code…)."
  value       = "${trimsuffix(aws_lambda_function_url.mcp.function_url, "/")}/mcp"
}

output "function_name" {
  value = aws_lambda_function.mcp.function_name
}

output "log_group" {
  value = aws_cloudwatch_log_group.lambda.name
}

output "web_url" {
  description = "Web chat (OpenRouter, bring your own key)."
  value       = "https://${aws_cloudfront_distribution.app.domain_name}/"
}

output "web_bucket" {
  description = "Bucket of the web chat files (make web / CI: aws s3 sync)."
  value       = aws_s3_bucket.web.id
}

output "web_distribution_ids" {
  description = "CloudFront distributions to invalidate after an upload."
  value       = [aws_cloudfront_distribution.app.id, aws_cloudfront_distribution.sandbox.id]
}
