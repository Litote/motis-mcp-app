/**
 * Tool metadata helpers of the MCP Apps specification, same as the ones of `@modelcontextprotocol/ext-apps/app-bridge`:
 * importing them from there would load the whole AppBridge with the chat, instead of with the first view.
 */
import type { Tool } from "@modelcontextprotocol/client";

export const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

type UiMeta = { ui?: { resourceUri?: unknown; visibility?: string[] }; "ui/resourceUri"?: unknown };

/** `ui://` view of a tool (`_meta.ui.resourceUri`, or the deprecated `_meta["ui/resourceUri"]`). */
export function toolUiResourceUri(tool: Partial<Tool>): string | undefined {
  const meta = tool._meta as UiMeta | undefined;
  const uri = meta?.ui?.resourceUri ?? meta?.["ui/resourceUri"];
  if (uri === undefined) return undefined;
  if (typeof uri === "string" && uri.startsWith("ui://")) return uri;
  throw new Error(`Invalid UI resource URI: ${JSON.stringify(uri)}`);
}

/** Tool reserved to the views (visibility `["app"]`): not offered to the model. */
export function isAppOnlyTool(tool: Partial<Tool>): boolean {
  const visibility = (tool._meta as UiMeta | undefined)?.ui?.visibility;
  return visibility?.length === 1 && visibility[0] === "app";
}
