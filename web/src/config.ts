/**
 * Runtime configuration, read from /config.json: written by Terraform in production (public/config.json is the dev
 * default), so that the same build runs against any deployment.
 */
export interface AppConfig {
  /** MCP endpoint of the motis-mcp-app server. */
  mcpUrl: string;
  /** sandbox.html of the view sandbox, on another origin than the app. */
  sandboxUrl: string;
  /** Origins of the app allowed to embed the sandbox. */
  hostOrigins: string[];
}

let config: Promise<AppConfig> | undefined;

/** Fetched once; fetched again after a failure (e.g. a network error), which would otherwise last until a reload. */
export function loadConfig(): Promise<AppConfig> {
  config ??= fetch("/config.json", { cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error(`config.json: HTTP ${response.status}`);
    return response.json() as Promise<AppConfig>;
  });
  config.catch(() => (config = undefined));
  return config;
}
