# syntax=docker/dockerfile:1

# MCP server (stdio or Streamable HTTP) on a JVM. The views and the jar are built once on the build platform. The Java
# runtime (jlink) and the AOT cache depend on the target platform (linux/amd64, linux/arm64): they are made on it, with
# QEMU for the other one (about 1 minute for arm64).

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
COPY web/public/logo.svg web/public/logo-128.png web/public/
# included by settings.gradle.kts: their build file is enough
COPY lambda/build.gradle.kts lambda/
COPY tools/station-names/build.gradle.kts tools/station-names/
COPY --from=ui /build/ui/dist ui/dist
ARG VERSION_NAME=main-SNAPSHOT
# the views are bundled by the ui stage: no npm in this stage
RUN ./gradlew --no-daemon --console=plain :server:installDist -x :server:npmInstall -x :server:buildUi \
    -PVERSION_NAME="$VERSION_NAME"
# readable by the unprivileged user of the runtime image
RUN chmod -R a+rX server/build/install/server

# ─── Java runtime (jlink) ─────────────────────────────────────────────────────
# Only the modules of the JDK used by the server (jdeps): a runtime of ~70 MB instead of the full JRE. Temurin ships no
# jmods, jlink links the runtime it runs on: this stage runs on the target platform.
FROM eclipse-temurin:25-jdk@sha256:83f4a7fc27df94dcc7b8de04d14cbbba8da14406f921e966969c3b09000aa507 AS jre
RUN jlink --add-modules java.base,java.desktop,java.instrument,java.logging,java.management,java.naming,jdk.unsupported \
    --strip-debug --no-man-pages --no-header-files --compress=zip-6 --output /opt/jre

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM debian:trixie-slim@sha256:8aa5a7bf5a1955bddbe7d74fcdd0b91ab30e74362a8b73af672b0481b35b44a0
ARG VERSION_NAME=main-SNAPSHOT
LABEL org.opencontainers.image.title="motis-mcp-app" \
      org.opencontainers.image.description="MCP App to explore the public transport data of a MOTIS server (Transitous)" \
      org.opencontainers.image.source="https://github.com/Litote/motis-mcp-app" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="$VERSION_NAME" \
      io.modelcontextprotocol.server.name="org.litote/motis-mcp-app"
ENV JAVA_HOME=/opt/java
ENV PATH="$JAVA_HOME/bin:$PATH"
COPY --from=jre /opt/jre /opt/java
COPY --from=server /build/server/build/install/server /opt/motis-mcp-app
# AOT cache (JEP 483, 514, 515): the classes loaded and linked, and the profiles of a training run, at the start of the
# server (stdio: initialize, the tools, the views). Built with the runtime and the jars of this image: they must not
# change after.
COPY docker/aot-training.jsonl /tmp/aot-training.jsonl
RUN MOTIS_APP_CONTACT=aot-training JAVA_OPTS="-XX:AOTCacheOutput=/opt/motis-mcp-app/server.aot" \
      /opt/motis-mcp-app/bin/server --stdio < /tmp/aot-training.jsonl > /dev/null \
    && rm /tmp/aot-training.jsonl && chmod a+r /opt/motis-mcp-app/server.aot
ENV JAVA_OPTS="-XX:AOTCache=/opt/motis-mcp-app/server.aot"
USER nobody
EXPOSE 3001
ENTRYPOINT ["/opt/motis-mcp-app/bin/server"]
CMD ["--stdio"]
