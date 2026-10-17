ROOT  := $(abspath ..)
ZIP   := $(ROOT)/lambda/build/libs/lambda.zip
TF    := terraform
IMAGE := ghcr.io/graalvm/native-image-community:25
CACHE := motis-gradle-native-cache

# Lambda architecture (Terraform `architecture`). native-image compiles for the platform it runs on, so the default is
# the host's: a cross build runs under QEMU emulation, which takes hours. CI deploys arm64 (arm64 runner); a deploy
# from an x86_64 host runs the function on x86_64 until the next CI deploy.
LAMBDA_ARCH     ?= $(if $(filter arm64 aarch64,$(shell uname -m)),arm64,x86_64)
LAMBDA_PLATFORM := $(if $(filter x86_64,$(LAMBDA_ARCH)),linux/amd64,linux/arm64)
TF_VARS         := -var="lambda_zip=$(ZIP)" -var="architecture=$(LAMBDA_ARCH)"

# GraalVM native build in Docker. The views (ui/) are bundled on the host, the image has no Node.js;
# motis-ktor-client snapshots are read from the host ~/.m2.
DOCKER_GRADLE := docker run --rm \
	--platform $(LAMBDA_PLATFORM) \
	--entrypoint sh \
	--user $(shell id -u):$(shell id -g) \
	-e GRADLE_USER_HOME=/gradle-home \
	-e "GRADLE_OPTS=-Dorg.gradle.native=false" \
	-e MOTIS_APP_CONTACT \
	-v "$(ROOT):/project" \
	-v $(CACHE):/gradle-home \
	-v "$(HOME)/.m2:/m2:ro" \
	-w /project \
	$(IMAGE) \
	-c
GRADLE := ./gradlew --no-daemon --console=plain -Dmaven.repo.local=/m2/repository \
	-Pkotlin.compiler.execution.strategy=in-process -x :server:npmInstall -x :server:buildUi

# ─── Build ────────────────────────────────────────────────────────────────────

.PHONY: build
build: ui gradle-permissions
	$(DOCKER_GRADLE) "$(GRADLE) :lambda:packageNative"
	@echo "✓ Lambda zip ($(LAMBDA_ARCH)): $(ZIP)"

# Re-records the native-image metadata (lambda/src/main/resources/META-INF/native-image) by replaying MCP requests
# against MOTIS under the native-image agent: run it after a change of the tools or of the dependencies.
.PHONY: trace
trace: ui gradle-permissions
	$(DOCKER_GRADLE) "$(GRADLE) :lambda:tracing -Pagent && $(GRADLE) :lambda:metadataCopy"

.PHONY: ui
ui:
	cd $(ROOT) && ./gradlew --console=plain :server:buildUi

# The cache volume is created by Docker as root
.PHONY: gradle-permissions
gradle-permissions:
	docker run --rm -v $(CACHE):/gradle-home alpine chown -R $(shell id -u):$(shell id -g) /gradle-home

# ─── Deploy ───────────────────────────────────────────────────────────────────

# Once per AWS account: Terraform state bucket and GitHub Actions OIDC deploy role (local state, see bootstrap/)
.PHONY: bootstrap
bootstrap:
	cd bootstrap && $(TF) init && $(TF) apply
	@echo "⚠️  Put the state bucket shown above into backend.hcl (see backend.hcl.sample)"

.PHONY: init
init:
	$(TF) init -backend-config=backend.hcl

.PHONY: plan
plan:
	$(TF) plan $(TF_VARS)

# Custom domain (domain_name): requests the certificate and prints its validation records, to create at the DNS
# provider before `make apply` (which waits until the certificate is issued)
.PHONY: certificate
certificate:
	$(TF) apply $(TF_VARS) -target=aws_acm_certificate.web
	$(TF) output certificate_validation_records

# Deploys the zip built by `make build`
.PHONY: apply
apply:
	@test -f $(ZIP) || (echo "✗ $(ZIP) missing: run make build" && exit 1)
	$(TF) apply $(TF_VARS)

.PHONY: deploy
deploy: build apply web

# Web chat (web/): build, upload to the bucket, invalidate the CDN. config.json is written by Terraform (make apply).
.PHONY: web
web:
	cd $(ROOT)/web && npm ci --no-audit --no-fund && npm test && npm run build
	aws s3 sync $(ROOT)/web/dist/assets s3://$$($(TF) output -raw web_bucket)/assets \
		--cache-control "public, max-age=31536000, immutable"
	aws s3 sync $(ROOT)/web/dist s3://$$($(TF) output -raw web_bucket) --delete \
		--exclude "assets/*" --exclude config.json --cache-control "no-cache"
	for id in $$($(TF) output -json web_distribution_ids | jq -r '.[]'); do \
		aws cloudfront create-invalidation --distribution-id $$id --paths "/*" --no-cli-pager > /dev/null; done
	@echo "✓ Web chat: $$($(TF) output -raw web_url)"

.PHONY: logs
logs:
	aws logs tail $$($(TF) output -raw log_group) --follow
