terraform {
  required_version = ">= 1.11"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    # zip of the kill switch Lambda (budget.tf)
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
    # secret of the origin header sent by CloudFront to the function URL (main.tf)
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project = var.name
    }
  }
}

# CloudFront only uses ACM certificates of us-east-1
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      Project = var.name
    }
  }
}
