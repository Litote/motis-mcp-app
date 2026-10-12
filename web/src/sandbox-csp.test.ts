import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { buildSandboxCsp, handler } = createRequire(import.meta.url)("../sandbox-csp.cjs");

describe("buildSandboxCsp", () => {
  it("allows the declared domains of the view", () => {
    const csp = buildSandboxCsp(JSON.stringify({ resourceDomains: ["https://tile.openstreetmap.org"] }));
    expect(csp).toContain("img-src 'self' data: blob: https://tile.openstreetmap.org");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("drops entries that could inject directives, and survives invalid JSON", () => {
    const csp = buildSandboxCsp(JSON.stringify({ connectDomains: ["https://ok.example", "x; script-src *", "'unsafe-eval'"] }));
    expect(csp).toContain("connect-src 'self' https://ok.example;");
    expect(csp).not.toContain("script-src *");
    expect(buildSandboxCsp("{not json")).toContain("connect-src 'self';");
  });

  it("is applied by the CloudFront Function from the url-encoded query parameter", () => {
    const csp = encodeURIComponent(JSON.stringify({ resourceDomains: ["https://tiles.example"] }));
    const response = handler({ request: { querystring: { csp: { value: csp } } }, response: { headers: {} } });
    expect(response.headers["content-security-policy"].value).toContain("https://tiles.example");
    expect(response.headers["cache-control"].value).toBe("no-store");
  });
});
