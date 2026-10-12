/**
 * MCP client of the motis-mcp-app server, from the browser (Streamable HTTP; the Lambda endpoint is stateless and allows
 * any origin). One connection per page, shared by the agent loop and the views.
 */
import type { McpUiResourceCsp, McpUiResourcePermissions } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Resource,
  type Tool,
} from "@modelcontextprotocol/client";
import { loadConfig } from "./config";
import { RESOURCE_MIME_TYPE, isAppOnlyTool, toolUiResourceUri } from "./mcp-apps";
import type { ChatTool } from "./openrouter";

export const IMPLEMENTATION = { name: "MOTIS explorer", version: "1.0.0" };

export interface McpServer {
  client: Client;
  /** Instructions of the server, for the system prompt. */
  instructions: string;
  tools: Map<string, Tool>;
  resources: Map<string, Resource>;
}

export interface ViewResource {
  html: string;
  csp?: McpUiResourceCsp;
  permissions?: McpUiResourcePermissions;
}

let server: Promise<McpServer> | undefined;

export function connectMcp(): Promise<McpServer> {
  server ??= (async () => {
    const { mcpUrl } = await loadConfig();
    const client = new Client(IMPLEMENTATION);
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
    const [{ tools }, { resources }] = await Promise.all([client.listTools(), client.listResources()]);
    return {
      client,
      instructions: client.getInstructions() ?? "",
      tools: new Map(tools.map((tool) => [tool.name, tool])),
      resources: new Map(resources.map((resource) => [resource.uri, resource])),
    };
  })();
  server.catch(() => (server = undefined));
  return server;
}

/** Tools offered to the model: the ones reserved to the views (visibility app-only) are excluded. */
export function modelTools(mcp: McpServer): ChatTool[] {
  return [...mcp.tools.values()]
    .filter((tool) => !isAppOnlyTool(tool))
    .map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    }));
}

export async function callTool(mcp: McpServer, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (!mcp.tools.has(name)) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    return (await mcp.client.callTool({ name, arguments: args })) as CallToolResult;
  } catch (e) {
    return { content: [{ type: "text", text: `Tool call failed: ${e instanceof Error ? e.message : e}` }], isError: true };
  }
}

/** Text of a tool result, as given back to the model. */
export function resultText(result: CallToolResult): string {
  return result.content
    .map((part) => (part.type === "text" ? part.text : `[${part.type}]`))
    .join("\n");
}

const viewCache = new Map<string, Promise<ViewResource>>();

/** View (`ui://` resource) rendering the results of [toolName], if any. */
export function toolView(mcp: McpServer, toolName: string): Promise<ViewResource> | undefined {
  const tool = mcp.tools.get(toolName);
  const uri = tool && toolUiResourceUri(tool);
  if (!uri) return undefined;
  let view = viewCache.get(uri);
  if (!view) {
    view = readView(mcp, uri);
    viewCache.set(uri, view);
    view.catch(() => viewCache.delete(uri));
  }
  return view;
}

async function readView(mcp: McpServer, uri: string): Promise<ViewResource> {
  const { contents } = await mcp.client.readResource({ uri });
  const content = contents[0];
  if (!content || content.mimeType !== RESOURCE_MIME_TYPE) throw new Error(`Not an MCP App view: ${uri}`);
  const html = "blob" in content ? atob(content.blob) : content.text;
  // _meta of the content first, of the resource listing otherwise
  type UiMeta = { ui?: { csp?: McpUiResourceCsp; permissions?: McpUiResourcePermissions } };
  const ui = (content._meta as UiMeta | undefined)?.ui ?? (mcp.resources.get(uri)?._meta as UiMeta | undefined)?.ui;
  return { html, csp: ui?.csp, permissions: ui?.permissions };
}
