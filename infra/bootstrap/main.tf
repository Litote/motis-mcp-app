# Once per AWS account (`make bootstrap`): the Terraform state bucket and the role assumed by the GitHub Actions deploy
# workflow through OIDC (no long-lived keys). Intentional local state: keep terraform.tfstate of this folder.

terraform {
  required_version = ">= 1.11"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project   = var.name
      ManagedBy = "terraform-bootstrap"
    }
  }
}

variable "aws_region" {
  description = "AWS region of the state bucket and of the Lambda."
  type        = string
  default     = "eu-west-3"
}

variable "name" {
  description = "Name of the Lambda function (the deploy role is limited to the resources prefixed by it)."
  type        = string
  default     = "motis-mcp-app"
}

variable "github_repo" {
  description = "GitHub repository allowed to assume the deploy and plan roles (owner/name)."
  type        = string
  default     = "Litote/motis-mcp-app"
}

variable "create_github_oidc_provider" {
  description = "Creates the GitHub Actions OIDC identity provider. false: reuses the one of the account (a single provider per URL and account, e.g. already created for another project)."
  type        = bool
  default     = false
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  github_oidc_provider_arn = (
    var.create_github_oidc_provider
    ? aws_iam_openid_connect_provider.github[0].arn
    : data.aws_iam_openid_connect_provider.github[0].arn
  )
}

# ─── State bucket ─────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "tfstate" {
  bucket = "${var.name}-tfstate-${local.account_id}"
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "tfstate" {
  statement {
    sid       = "HttpsOnly"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.tfstate.arn, "${aws_s3_bucket.tfstate.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "tfstate" {
  bucket     = aws_s3_bucket.tfstate.id
  policy     = data.aws_iam_policy_document.tfstate.json
  depends_on = [aws_s3_bucket_public_access_block.tfstate]
}

# ─── GitHub Actions OIDC ──────────────────────────────────────────────────────

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_github_oidc_provider ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 0 : 1
  url   = "https://token.actions.githubusercontent.com"
}

# Only the `production` environment (deploy, restricted to main by a deployment branch policy) may assume the deploy
# role; pull requests (terraform plan) assume the read-only plan role
data "aws_iam_policy_document" "deploy_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:environment:production"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name               = "github-actions-deploy-${var.name}"
  description        = "GitHub Actions deploy role of ${var.github_repo}"
  assume_role_policy = data.aws_iam_policy_document.deploy_assume_role.json
}

# Permissions of the Terraform of infra/, limited to the resources named after var.name
data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "State"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.tfstate.arn]
  }

  statement {
    sid       = "StateObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.tfstate.arn}/*"]
  }

  statement {
    sid       = "Lambda"
    actions   = ["lambda:*"]
    resources = ["arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${var.name}"]
  }

  statement {
    sid = "LambdaRole"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies",
      "iam:ListInstanceProfilesForRole",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/${var.name}-lambda"]
  }

  statement {
    sid       = "PassLambdaRole"
    actions   = ["iam:PassRole"]
    resources = ["arn:aws:iam::${local.account_id}:role/${var.name}-lambda"]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }

  statement {
    sid = "Logs"
    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:PutRetentionPolicy",
      "logs:DeleteRetentionPolicy",
      "logs:ListTagsForResource",
      "logs:TagResource",
      "logs:UntagResource",
    ]
    resources = [
      "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/aws/lambda/${var.name}",
      "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/aws/lambda/${var.name}:*",
    ]
  }

  # Describe* cannot be limited to a resource
  statement {
    sid       = "LogsDescribe"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }

  # Web chat: bucket (Terraform, and the file upload of the workflow)
  statement {
    sid     = "WebBucket"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::${var.name}-web-${local.account_id}",
      "arn:aws:s3:::${var.name}-web-${local.account_id}/*",
    ]
  }

  # Web chat: distributions, origin access control, function, response headers policy, invalidations. Their ids are
  # generated at creation: they cannot be limited to names.
  statement {
    sid       = "WebCloudFront"
    actions   = ["cloudfront:*"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}

# Pull requests of the repository: terraform plan only. A pull request branch can change the workflow, so this role
# cannot write anything (state lock included: the plan runs with -lock=false)
data "aws_iam_policy_document" "plan_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:pull_request"]
    }
  }
}

resource "aws_iam_role" "plan" {
  name               = "github-actions-plan-${var.name}"
  description        = "GitHub Actions read-only (terraform plan) role of ${var.github_repo}"
  assume_role_policy = data.aws_iam_policy_document.plan_assume_role.json
}

# Read access to the state and to the resources of infra/
data "aws_iam_policy_document" "plan" {
  statement {
    sid       = "State"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.tfstate.arn]
  }

  statement {
    sid       = "StateObjects"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.tfstate.arn}/*"]
  }

  statement {
    sid       = "Lambda"
    actions   = ["lambda:Get*", "lambda:List*"]
    resources = ["arn:aws:lambda:${var.aws_region}:${local.account_id}:function:${var.name}"]
  }

  statement {
    sid = "LambdaRole"
    actions = [
      "iam:GetRole",
      "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies",
    ]
    resources = ["arn:aws:iam::${local.account_id}:role/${var.name}-lambda"]
  }

  statement {
    sid     = "Logs"
    actions = ["logs:ListTagsForResource"]
    resources = [
      "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/aws/lambda/${var.name}",
      "arn:aws:logs:${var.aws_region}:${local.account_id}:log-group:/aws/lambda/${var.name}:*",
    ]
  }

  # Describe* cannot be limited to a resource
  statement {
    sid       = "LogsDescribe"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }

  statement {
    sid     = "WebBucket"
    actions = ["s3:Get*", "s3:List*"]
    resources = [
      "arn:aws:s3:::${var.name}-web-${local.account_id}",
      "arn:aws:s3:::${var.name}-web-${local.account_id}/*",
    ]
  }

  # Ids generated at creation: they cannot be limited to names
  statement {
    sid       = "WebCloudFront"
    actions   = ["cloudfront:Get*", "cloudfront:List*", "cloudfront:Describe*"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "plan" {
  name   = "plan"
  role   = aws_iam_role.plan.id
  policy = data.aws_iam_policy_document.plan.json
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "state_bucket" {
  description = "Bucket of backend.hcl, and of the GitHub variable TF_STATE_BUCKET."
  value       = aws_s3_bucket.tfstate.id
}

output "deploy_role_arn" {
  description = "Role of the GitHub secret AWS_ROLE_ARN."
  value       = aws_iam_role.deploy.arn
}

output "plan_role_arn" {
  description = "Role of the GitHub secret AWS_PLAN_ROLE_ARN."
  value       = aws_iam_role.plan.arn
}
