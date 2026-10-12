terraform {
  # Partial S3 backend, shared by local deploys and CI: the bucket name embeds the AWS account id, so it is given at
  # init time (`make init` reads backend.hcl, see backend.hcl.sample; CI passes -backend-config="bucket=…").
  backend "s3" {
    key          = "motis-mcp-app/terraform.tfstate"
    region       = "eu-west-3"
    encrypt      = true
    use_lockfile = true
  }
}
