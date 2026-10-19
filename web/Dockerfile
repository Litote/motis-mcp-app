# syntax=docker/dockerfile:1

# Web chat (web/) on nginx: the app and the view sandbox on two ports (two origins), the CSP of the sandbox built by njs
# from web/sandbox-csp.cjs. The files are built once on the build platform: the target images only copy them.

# ─── Build ────────────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:26-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . ./
RUN npm run build \
    # config.json is rendered when the container starts (nginx/templates)
    && rm dist/config.json \
    && cat sandbox-csp.cjs nginx/sandbox-csp.njs.js > sandbox-csp.js

# ─── Runtime ──────────────────────────────────────────────────────────────────
FROM nginx:1.31.6-alpine
ARG VERSION_NAME=main-SNAPSHOT
LABEL org.opencontainers.image.title="motis-mcp-app-web" \
      org.opencontainers.image.description="Web chat (OpenRouter) of motis-mcp-app, with the MCP App views" \
      org.opencontainers.image.source="https://github.com/Litote/motis-mcp-app" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="$VERSION_NAME"
# Public URLs, as seen by the browser
ENV MCP_URL=http://localhost:3001/mcp \
    APP_ORIGIN=http://localhost:8080 \
    SANDBOX_ORIGIN=http://localhost:8081
RUN rm /etc/nginx/conf.d/default.conf /usr/share/nginx/html/*
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/templates /etc/nginx/templates
COPY --from=build /build/sandbox-csp.js /etc/nginx/njs/sandbox-csp.js
COPY --from=build /build/dist /usr/share/nginx/html
EXPOSE 8080 8081
