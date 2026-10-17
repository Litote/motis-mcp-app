# Custom domain (optional, var.domain_name): https://<domain>/ serves the web chat and https://<domain>/mcp the MCP
# endpoint (both on the app distribution, web.tf), the view sandbox is on its own domain (another origin).
# The DNS is managed outside AWS: the certificate validation records and the CNAME records to the distributions are
# created by hand at the DNS provider (outputs certificate_validation_records and dns_records, docs/AWS-DEPLOYMENT.md).

locals {
  custom_domain  = var.domain_name != ""
  sandbox_domain = var.sandbox_domain_name != "" ? var.sandbox_domain_name : "sandbox.${var.domain_name}"
}

resource "aws_acm_certificate" "web" {
  count    = local.custom_domain ? 1 : 0
  provider = aws.us_east_1

  domain_name               = var.domain_name
  subject_alternative_names = [local.sandbox_domain]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Waits until the certificate is issued, i.e. until the validation records are published (`make certificate` first)
resource "aws_acm_certificate_validation" "web" {
  count    = local.custom_domain ? 1 : 0
  provider = aws.us_east_1

  certificate_arn = aws_acm_certificate.web[0].arn

  timeouts {
    create = "15m"
  }
}
