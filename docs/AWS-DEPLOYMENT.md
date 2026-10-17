# AWS deployment

Deployment of the MCP server on AWS Lambda and of the web chat on S3 + CloudFront.
See the [README](../README.md) for an overview and the [MCP server reference](MCP-SERVER.md) for its configuration.

## Deploy on AWS Lambda

`lambda/` packages the server as a GraalVM native executable for the `provided.al2023` runtime, exposed by a public
Lambda function URL (`https://<id>.lambda-url.<region>.on.aws/mcp`). `infra/` holds the Terraform and a Makefile.

Requirements: Docker (the GraalVM build runs in `ghcr.io/graalvm/native-image-community:25`), Terraform,
AWS credentials.

```bash
cd infra
make bootstrap                                 # once per AWS account: state bucket + GitHub Actions deploy and plan roles
cp backend.hcl.sample backend.hcl              # set the state bucket printed by bootstrap
cp terraform.tfvars.sample terraform.tfvars    # set motis_app_contact
make init
make deploy        # make build (native zip: lambda/build/libs/lambda.zip) + terraform apply
make logs
```

`make apply` deploys the zip in `lambda/build/libs/` as it is: it refuses a zip older than the last commit of the server
(`server/`, `lambda/`, `ui/`, Gradle files), which would replace the function deployed by CI with an old one. Run
`make build` first, or `ALLOW_STALE_ZIP=1 make apply` to deploy it anyway.

`bootstrap/` keeps a local state (gitignored): keep `infra/bootstrap/terraform.tfstate`. It reuses the GitHub OIDC
identity provider of the account; on an account without one, run it with `-var create_github_oidc_provider=true`, and
keep that variable on every later apply: without it, Terraform would delete the provider it created (`prevent_destroy`
makes that apply fail instead).
The roles trust the `sub` claim of the GitHub OIDC tokens: `github_sub_prefix` is the immutable prefix of this
repository (`gh api repos/<owner>/<name>/actions/oidc/customization/sub`); for a fork, set your own (or `null` with
legacy claims).

### Architecture

The Lambda runs on **arm64** (Graviton, cheaper than x86_64) by default, Terraform variable `architecture`.
`native-image` compiles for the platform it runs on, so the zip must be built on the same architecture:

- **CI** builds on an arm64 runner (`ubuntu-24.04-arm`), and checks that `bootstrap` is `aarch64`.
- **`make`** builds for the **host** architecture (`LAMBDA_ARCH`, from `uname -m`) and passes the same value to
  Terraform: from an x86_64 host the function runs on x86_64 until the next CI deploy. `LAMBDA_ARCH=arm64` on an
  x86_64 host builds under QEMU emulation, which takes hours.

### Continuous deployment

`.github/workflows/deploy-lambda.yml` (paths `server/`, `lambda/`, `ui/`, `web/`, `infra/`, Gradle files):

| Event            | Jobs                                                                                    |
|------------------|-----------------------------------------------------------------------------------------|
| pull request     | build (tests, native arm64 zip, smoke test in the Lambda runtime emulator), web chat build → `terraform plan` (read-only role) |
| push to `main`   | build → `terraform apply` (deploys the zip) → smoke test of the deployed endpoint → web chat upload |
| manual           | same as a push                                                                          |

The AWS jobs (`terraform plan`, `terraform apply`, web chat upload) are skipped while the `AWS_REGION` variable is not
set: the builds and their smoke tests still run.

GitHub configuration:

| Kind                         | Name                                            | Value                                                |
|------------------------------|-------------------------------------------------|------------------------------------------------------|
| secret                       | `AWS_ROLE_ARN`                                  | `deploy_role_arn` output of `make bootstrap`         |
| secret                       | `AWS_PLAN_ROLE_ARN`                             | `plan_role_arn` output of `make bootstrap` (read-only, pull requests) |
| secret (optional)            | `GRADLE_ENCRYPTION_KEY`                         | Gradle configuration cache encryption key            |
| secret (optional)            | `SONAR_TOKEN`                                   | SonarCloud analysis of `ci.yml`                      |
| secret                       | `RELEASE_PLEASE_APP_ID`, `RELEASE_PLEASE_APP_PRIVATE_KEY` | GitHub App of `release-please.yml`      |
| variable                     | `AWS_REGION`                                    | e.g. `eu-west-3`                                     |
| variable                     | `TF_STATE_BUCKET`                               | `state_bucket` output of `make bootstrap`            |
| variable                     | `MOTIS_APP_CONTACT`                             | contact sent in the User-Agent (Transitous policy)   |
| variable (optional)          | `MOTIS_TILE_URL`, `MOTIS_TILE_ATTRIBUTION`      | tile provider                                        |
| variable (optional)          | `MOTIS_VIEW_DOMAINS`                            | dedicated origin of the views per host, JSON: `{"chatgpt":"https://…"}` |
| variable (optional)          | `WEB_DOMAIN`                                    | custom domain of the chat and of the MCP endpoint, see [Custom domain](#custom-domain) |
| variable (optional)          | `RESERVED_CONCURRENCY`                          | default 10; `-1` while the account concurrency quota is below 20 (new accounts: 10) |
| environment                  | `production`                                    | deployment branch policy: `main` only                |

The endpoint uses the **stateless** Streamable HTTP mode: successive requests of a client may reach different Lambda
instances, so no session is kept and every request is answered in JSON (no SSE stream, `GET` returns 405). The DNS
rebinding protection is disabled (public endpoint) and CORS is handled by the function URL.

The native image needs reflection/resources metadata, recorded by replaying MCP requests against MOTIS under the
native-image agent: run `make trace` after changing the tools or upgrading the dependencies, and commit
`lambda/src/main/resources/META-INF/native-image`.

The endpoint has no authentication: bound the load on MOTIS and the cost with `reserved_concurrency`, and configure a
tile provider (`tile_url`) for a public use.

## Web chat

Deployment (`infra/web.tf`): an S3 bucket and two CloudFront distributions (chat, sandbox); `config.json` (MCP
endpoint, sandbox URL, allowed origins) is written by Terraform. `make web` (part of `make deploy`) builds and uploads the
files; CI does the same after `terraform apply`. Terraform output `web_url`.

The chat distribution also serves the MCP endpoint: `/mcp*` is proxied to the Lambda function URL, so the chat and its
MCP server share one origin, and the `mcp_url` output is `https://<chat domain>/mcp`. The function URL (output
`function_url`) still answers directly.

## Custom domain

`domain_name` (GitHub variable `WEB_DOMAIN`) serves the chat on `https://<domain>/` and the MCP endpoint on
`https://<domain>/mcp`; the view sandbox needs another origin: `sandbox_domain_name`, by default `sandbox.<domain>`.
The certificate (ACM, us-east-1 as required by CloudFront) covers both. With a DNS provider outside AWS:

1. Set `domain_name` in `terraform.tfvars`, and run `make certificate`: it requests the certificate and prints its
   validation records (output `certificate_validation_records`).
2. Create these CNAME records at the DNS provider, and the CNAME records of the domains to the distributions: output
   `dns_records` (`terraform output dns_records`), e.g. `motis.example.org. CNAME d111111abcdef8.cloudfront.net.`
3. Set the GitHub variable `WEB_DOMAIN` to the same domain (otherwise the next CI deploy removes it), and run
   `make apply` (or push): it waits until the certificate is issued (15 min at most), then adds the domains to the
   distributions.

The records must stay: ACM renews the certificate with the validation records. The deploy role needs the ACM
permissions of `bootstrap/` (`make bootstrap` again on an account bootstrapped before).
