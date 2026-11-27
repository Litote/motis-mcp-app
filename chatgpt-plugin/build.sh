#!/usr/bin/env bash
# Builds the ZIP of the ChatGPT plugin of Errance (portable format: plugin.json, mcp.json, assets/), uploaded in the
# OpenAI plugin portal (With MCP). The version is the last release (.release-please-manifest.json).
# Usage: chatgpt-plugin/build.sh  →  build/chatgpt-plugin/errance-<version>.zip
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
version=$(jq -r '."."' "$root/.release-please-manifest.json")
out="$root/build/chatgpt-plugin"
pkg="$out/errance"

rm -rf "$out"
mkdir -p "$pkg/assets"
jq --arg v "$version" '.version = $v' "$root/chatgpt-plugin/plugin.json" > "$pkg/plugin.json"
cp "$root/chatgpt-plugin/mcp.json" "$pkg/mcp.json"
cp "$root/web/public/logo-512.png" "$pkg/assets/logo.png"

# files at the root of the archive, without the extra attributes of the file system
(cd "$pkg" && zip -q -X -r "$out/errance-$version.zip" plugin.json mcp.json assets)
echo "$out/errance-$version.zip"
