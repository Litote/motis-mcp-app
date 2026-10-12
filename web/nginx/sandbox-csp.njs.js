
// njs entry point (nginx image, web/Dockerfile): appended to sandbox-csp.cjs when the image is built, so that the CSP
// of the sandbox has a single source. js_set $sandbox_csp: header value from the csp query parameter.
function header(r) {
  return buildSandboxCsp(r.args.csp || "");
}

export default { header: header };
