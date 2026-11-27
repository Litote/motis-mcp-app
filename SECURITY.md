# Security Policy

If you discover a security vulnerability, please report it privately via
GitHub security advisories: https://github.com/Litote/motis-mcp-app/security

Do NOT report vulnerabilities via public issues or pull requests.

Scope:
- the MCP server and its Docker image `ghcr.io/litote/motis-mcp-app`
- the views (MCP Apps) and the web chat, and its Docker image `ghcr.io/litote/motis-mcp-app-web`
- the hosted instance https://errance.litote.org (MCP endpoint `/mcp` and web chat), and its infrastructure (`infra/`)

Out of scope:
- the data and the APIs of the MOTIS servers (Transitous by default) and of OpenRouter: report them to their maintainers
- denial of service and load testing of the hosted instance: its tool calls are rate limited, please do not test it
  beyond what's necessary to demonstrate an issue

What to include in your report:
- Clear description of the issue
- Steps to reproduce
- PoC or minimal proof-of-concept code
- Impact assessment and affected versions
- Your contact details for follow-up

Response timeline:
- Acknowledgement: within 3 business days
- Investigation: usually within 7 business days
- Fix and release: as promptly as possible; we'll coordinate disclosure with the reporter

Responsible disclosure:
- Avoid public disclosure until the issue is fixed and coordinated with the reporter
- Provide details privately
- Act in good faith and do not exploit the vulnerability beyond what's necessary to demonstrate it

Credits:
We will credit reporters as appropriate when the issue is disclosed.

Supported versions: the latest released version, and the hosted instance (deployed from `main`).
