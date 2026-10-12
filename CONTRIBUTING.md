# Contributing

## Prerequisites

- JDK 25 (Gradle toolchain, provisioned automatically)
- Gradle 9+ (use the wrapper: `./gradlew`)
- Node.js 26+ (npm on the `PATH`, or `-Pnpm=/path/to/npm`): the views (`ui/`) are bundled by the Gradle build
- For the Lambda: Docker and Terraform (see [Deploy on AWS Lambda](docs/AWS-DEPLOYMENT.md#deploy-on-aws-lambda))

## Structure

```
server/   Kotlin MCP server
  MotisGateway        MOTIS clients, place resolution, error mapping
  tools/              tool definitions (schemas, summaries)
  dto/                compact structured content for the views, polyline clipping
  apps/AppResources   ui:// resources (text/html;profile=mcp-app), CSP, tool _meta.ui
ui/       views (TypeScript, Vite, Leaflet), each bundled in a single HTML file
lambda/   AWS Lambda entry point (GraalVM native): function URL events run through a Ktor engine without socket
infra/    Terraform (Lambda, function URL, web chat on S3 + CloudFront) and Makefile (native build in Docker, deploy)
web/      web chat (OpenRouter, assistant-ui): agent loop in the browser, views in a sandbox
  nginx/              Docker image of the web chat (nginx + njs), smoke test
compose.yaml          MCP server and web chat on localhost
```

## Coding conventions

Follow the [official Kotlin conventions](https://kotlinlang.org/docs/coding-conventions.html).

## Commit signing

All commits merged into `main` **must be signed**.

See [Signing commits](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits)

## Conventional Commits

All PR titles **must** follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.
This is enforced automatically via `amannn/action-semantic-pull-request` in `ci.yml`.

### Branch naming

PR branches should mirror the PR title using the same Conventional Commits type as prefix:

```
<type>/<short-kebab-description>

# Examples:
feat/rentals-view
fix/departures-time-zone
chore/update-motis-client
```

| Type | Version bump | When to use |
|------|-------------|-------------|
| `feat:` | Minor (`0.3.0` → `0.4.0`) | New user-facing feature (tool, view, web chat feature) |
| `fix:` | Patch (`0.3.0` → `0.3.1`) | Bug fix |
| `perf:` | Patch | Performance improvement |
| `feat!:` / `BREAKING CHANGE:` | Major (`0.3.0` → `1.0.0`) | Breaking change (tool renamed or removed, incompatible parameters) |
| `chore:`, `docs:`, `test:`, `refactor:`, `ci:` | No release | Internal changes |

> **Note:** While the major version is `0`, `feat:` commits bump the minor version (not major). This is controlled by `bump-minor-pre-major: true` in `release-please-config.json`.

## Tests

No test needs network access:

- `server/`: the MCP tools against a mocked MOTIS API (Ktor `MockEngine`), with answers recorded from Transitous
  (`server/src/test/resources/motis`);
- `ui/` (vitest, jsdom): the views, loaded with a fake MCP Apps host, rendering results of the server
  (`ui/src/test/*.json`);
- `web/` (vitest, jsdom and Testing Library): the agent loop, the OpenRouter and MCP clients, the sandbox and the React
  components.

```bash
./gradlew check jacocoAggregatedReport   # server and lambda tests, coverage
cd ui && npm run coverage                # views tests (npm test: without coverage)
cd web && npm run coverage               # web chat tests
```

The pull requests also build the native Lambda and run it in the Lambda runtime emulator (`deploy-lambda.yml`), and
build the web chat image and run its smoke test (`web/nginx/smoke-test.sh`, `ci.yml`).

## Quality

The CI (`ci.yml`) analyses the project with [SonarCloud](https://sonarcloud.io/summary/new_code?id=Litote_motis-mcp-app)
(`SONAR_TOKEN` secret): the Kotlin modules with their JaCoCo coverage, the views (`ui/`), the web chat (`web/`) and the
Terraform (`infra/`). To run the analysis locally, set `systemProp.sonar.token=<token>` in `~/.gradle/gradle.properties`:

```bash
./gradlew check jacocoAggregatedReport sonar sonarCheck
```

`sonarCheck` fails if the quality gate is not OK, or if any issue or security hotspot remains.

The GitHub workflows are audited by [zizmor](https://docs.zizmor.sh) (`zizmor.yml`), and the dependencies (Gradle, npm,
GitHub Actions, Terraform providers, Docker base images) are updated by Dependabot.

## Before opening a PR

```bash
(cd ui && npm run coverage) && (cd web && npm run coverage)
./gradlew check jacocoAggregatedReport sonar sonarCheck
```

`sonarCheck` must pass (gate OK, 0 issues, 0 hotspots). It requires `systemProp.sonar.token` in
`~/.gradle/gradle.properties`; without a token, let the CI run the analysis.

After a change of the tools or a dependency upgrade, re-record the native-image metadata and commit
`lambda/src/main/resources/META-INF/native-image`:

```bash
cd infra && make trace
```

## Release

Releases are automated by [release-please](https://github.com/googleapis/release-please) (`release-please.yml`), from
the Conventional Commits:

1. each push on `main` updates the release PR (version in `.release-please-manifest.json`, `CHANGELOG.md`);
2. merging the release PR creates the tag and a **draft** GitHub release;
3. the `docker` job builds the image for `linux/amd64` and `linux/arm64`, pushes it to `ghcr.io/litote/motis-mcp-app`
   and runs a smoke test (`tools/list` over stdio);
4. the `docker-web` job does the same for the web chat image `ghcr.io/litote/motis-mcp-app-web`
   (`web/nginx/smoke-test.sh`);
5. the draft release is published once both images are pushed.

The images are tagged `<version>`, `<major>.<minor>` and `latest`. The version published is the tag version:
`VERSION_NAME` in `gradle.properties` stays `main-SNAPSHOT`.
A failed release can be published again with the `workflow_dispatch` trigger of `release-please.yml` (input: the tag).

```bash
# local images
docker build -t motis-mcp-app .
docker build -t motis-mcp-app-web web
```

## Deployment

A merge on `main` deploys the Lambda and the web chat (`deploy-lambda.yml`, `production` environment), independently
of the releases (see [Continuous deployment](docs/AWS-DEPLOYMENT.md#continuous-deployment)). A pull request
runs the native build, its smoke test in the Lambda runtime emulator and a `terraform plan` with a read-only role.
