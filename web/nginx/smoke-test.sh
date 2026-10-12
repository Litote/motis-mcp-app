#!/usr/bin/env bash
# Smoke test of the web chat image (CI): headers of the app and of the sandbox, config.json rendered from the
# environment. Usage: web/nginx/smoke-test.sh <image>
set -euo pipefail

image=$1
container=$(docker run -d --rm -p 127.0.0.1::8080 -p 127.0.0.1::8081 \
  -e MCP_URL=https://mcp.example.org/mcp -e APP_ORIGIN=https://chat.example.org \
  -e SANDBOX_ORIGIN=https://sandbox.example.org "$image")
# logs of the container on failure
trap 'status=$?; [ "$status" = 0 ] || docker logs "$container"; docker stop "$container" > /dev/null' EXIT
app=http://$(docker port "$container" 8080)
sandbox=http://$(docker port "$container" 8081)

for _ in $(seq 30); do curl -sf -o /dev/null "$app/" && break; sleep 1; done

fail() { echo "✗ $*" >&2; exit 1; }

curl -sf "$app/" | grep -q '<div id="root">' || fail "index.html"
curl -sfI "$app/" | grep -i '^content-security-policy:' | grep -q "connect-src 'self' https://openrouter.ai https://mcp.example.org/mcp; frame-src https://sandbox.example.org;" \
  || fail "app CSP"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$app/sandbox.html")" = 404 ] || fail "sandbox.html served by the app"

curl -sf "$sandbox/config.json" | jq -e '.mcpUrl == "https://mcp.example.org/mcp"
  and .sandboxUrl == "https://sandbox.example.org/sandbox.html" and .hostOrigins == ["https://chat.example.org"]' > /dev/null \
  || fail "config.json"

# njs: domains of the csp query parameter, invalid entries dropped
csp=$(jq -rn '{resourceDomains: ["https://tiles.example.org", "https://x.org;evil"]} | tojson | @uri')
header=$(curl -sfI "$sandbox/sandbox.html?csp=$csp" | grep -i '^content-security-policy:') || fail "sandbox CSP missing"
echo "$header" | grep -q "img-src 'self' data: blob: https://tiles.example.org;" || fail "sandbox CSP: $header"
echo "$header" | grep -q "evil" && fail "sandbox CSP not sanitized: $header"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$sandbox/index.html")" = 404 ] || fail "index.html served by the sandbox"

echo "✓ web chat image"
