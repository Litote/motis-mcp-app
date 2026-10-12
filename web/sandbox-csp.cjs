// Content-Security-Policy of the view sandbox (sandbox.html), built from the `csp` query parameter: the `_meta.ui.csp`
// of the view resource (McpUiResourceCsp: resourceDomains, connectDomains, frameDomains, baseUriDomains).
//
// Single source shared by the Vite dev server (vite.config.ts) and the CloudFront Function of the sandbox distribution
// (infra/web.tf, cloudfront-js-2.0): plain JavaScript (CommonJS export guarded, ignored by CloudFront), `handler` is
// the CloudFront entry point.

// Rejects entries that could break out of a directive (`;`, quotes, whitespace) or inject keywords
function sanitizeCspDomains(domains) {
  if (!Array.isArray(domains)) return [];
  return domains.filter(function (domain) {
    return typeof domain === "string" && /^[a-zA-Z0-9.:/*_-]+$/.test(domain) && domain.length < 256;
  });
}

function buildSandboxCsp(cspJson) {
  var csp = {};
  if (cspJson) {
    try {
      csp = JSON.parse(cspJson) || {};
    } catch (e) {
      csp = {};
    }
  }
  var resourceDomains = sanitizeCspDomains(csp.resourceDomains).join(" ");
  var connectDomains = sanitizeCspDomains(csp.connectDomains).join(" ");
  var frameDomains = sanitizeCspDomains(csp.frameDomains).join(" ");
  var baseUriDomains = sanitizeCspDomains(csp.baseUriDomains).join(" ");
  return [
    "default-src 'self' 'unsafe-inline'",
    ("script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: " + resourceDomains).trim(),
    ("style-src 'self' 'unsafe-inline' blob: data: " + resourceDomains).trim(),
    ("img-src 'self' data: blob: " + resourceDomains).trim(),
    ("font-src 'self' data: blob: " + resourceDomains).trim(),
    ("media-src 'self' data: blob: " + resourceDomains).trim(),
    ("connect-src 'self' " + connectDomains).trim(),
    ("worker-src 'self' blob: " + resourceDomains).trim(),
    frameDomains ? "frame-src " + frameDomains : "frame-src 'none'",
    "object-src 'none'",
    baseUriDomains ? "base-uri " + baseUriDomains : "base-uri 'none'",
  ].join("; ");
}

// CloudFront Function (viewer response) of the sandbox distribution
// eslint-disable-next-line no-unused-vars
function handler(event) {
  var response = event.response;
  var csp = event.request.querystring.csp;
  response.headers["content-security-policy"] = {
    value: buildSandboxCsp(csp ? decodeURIComponent(csp.value) : ""),
  };
  response.headers["cache-control"] = { value: "no-store" };
  return response;
}

if (typeof module !== "undefined") {
  module.exports = { buildSandboxCsp: buildSandboxCsp, handler: handler };
}
