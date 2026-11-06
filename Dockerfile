# syntax=docker/dockerfile:1

# MCP server (stdio or Streamable HTTP) on a JVM. The views and the jar are built once on the build platform: the
# target images (linux/amd64, linux/arm64) only copy them, no emulation.

# ─── Views (ui/) ──────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS ui
WORKDIR /build/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ui/ ./
RUN npm run build

# ─── Server ───────────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM eclipse-temurin:25-jdk@sha256:83f4a7fc27df94dcc7b8de04d14cbbba8da14406f921e966969c3b09000aa507 AS server
WORKDIR /build
COPY gradlew settings.gradle.kts build.gradle.kts gradle.properties ./
COPY gradle gradle
COPY server server
# included by settings.gradle.kts: its build file is enough
COPY lambda/build.gradle.kts lambda/
COPY --from=ui /build/ui/dist ui/dist
ARG VERSION_NAME=main-SNAPSHOT
# the views are bundled by the ui stage: no npm in this stage
RUN ./gradlew --no-daemon --console=plain :server:installDist -x :server:npmInstall -x :server:buildUi \
    -PVERSION_NAME="$VERSION_NAME"
# readable by the unprivileged user of the runtime image
RUN chmod -R a+rX server/build/install/server

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM eclipse-temurin:25-jre@sha256:ecdc0adb37bde1a281c4d245a3cd535004b1fc8322d560f5b09463b248c81df0
ARG VERSION_NAME=main-SNAPSHOT
LABEL org.opencontainers.image.title="motis-mcp-app" \
      org.opencontainers.image.description="MCP App to explore the public transport data of a MOTIS server (Transitous)" \
      org.opencontainers.image.source="https://github.com/Litote/motis-mcp-app" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="$VERSION_NAME"
COPY --from=server /build/server/build/install/server /opt/motis-mcp-app
USER nobody
EXPOSE 3001
ENTRYPOINT ["/opt/motis-mcp-app/bin/server"]
CMD ["--stdio"]
