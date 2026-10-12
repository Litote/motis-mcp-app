# Contributing

## Prerequisites

- JDK 25 (Gradle toolchain, provisioned automatically)
- Gradle 9+ (use the wrapper: `./gradlew`)
- Node.js 22+ (npm on the `PATH`, or `-Pnpm=/path/to/npm`): the views (`ui/`) are bundled by the Gradle build
- For the Lambda: Docker and Terraform (see [Deploy on AWS Lambda](README.md#deploy-on-aws-lambda))

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

## Before opening a PR

```bash
./gradlew check jacocoAggregatedReport sonar sonarCheck
(cd web && npm test)
```

`sonarCheck` must pass (gate OK, 0 issues, 0 hotspots). It requires `systemProp.sonar.token` in
`~/.gradle/gradle.properties`; without a token, let the CI run the analysis.

After a change of the tools or a dependency upgrade, re-record the native-image metadata and commit
`lambda/src/main/resources/META-INF/native-image`:

```bash
cd infra && make trace
```

## Release

Releases are automated by `release-please.yml`:

1. each push on `main` updates the release PR (version in `.release-please-manifest.json`, `CHANGELOG.md`);
2. merging the release PR creates the tag and a **draft** GitHub release;
3. the `docker` job builds the image for `linux/amd64` and `linux/arm64`, pushes it to `ghcr.io/litote/motis-mcp-app`
   and runs a smoke test (`tools/list` over stdio);
4. the draft release is published.

The version published is the tag version: `VERSION_NAME` in `gradle.properties` stays `main-SNAPSHOT`.
A failed release can be published again with the `workflow_dispatch` trigger of `release-please.yml` (input: the tag).

## Deployment

A merge on `main` deploys the Lambda and the web chat (`deploy-lambda.yml`, `production` environment). A pull request
runs the native build, its smoke test in the Lambda runtime emulator and a `terraform plan` with a read-only role.
