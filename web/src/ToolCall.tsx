import { Suspense, createContext, lazy, useContext, useEffect, useState } from "react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { connectMcp } from "./mcp";
import { t } from "./i18n";
import { toolUiResourceUri } from "./mcp-apps";

// AppBridge loaded with the first view
const McpAppView = lazy(() => import("./McpAppView").then((module) => ({ default: module.McpAppView })));

/** Sends a user message to the thread: used by the views (ui/message). */
export const AppendMessageContext = createContext<(text: string) => void>(() => undefined);

function useHasView(toolName: string): boolean {
  const [hasView, setHasView] = useState(false);
  useEffect(() => {
    let active = true;
    connectMcp()
      .then((mcp) => {
        const tool = mcp.tools.get(toolName);
        if (active) setHasView(!!tool && !!toolUiResourceUri(tool));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [toolName]);
  return hasView;
}

/** A tool call of the assistant: status line (arguments on demand), then the view of the result when the tool has one. */
export function ToolCall({ toolCallId, toolName, args, argsText, result, isError, status }: ToolCallMessagePartProps) {
  const append = useContext(AppendMessageContext);
  const hasView = useHasView(toolName);
  const mcpResult = result as CallToolResult | undefined;
  const running = status.type === "running" || mcpResult === undefined;
  const errorText = isError ? mcpResult?.content.map((part) => (part.type === "text" ? part.text : "")).join(" ") : null;

  let toolStatus = "done";
  if (running) toolStatus = "running";
  else if (isError) toolStatus = "error";

  return (
    <div className="tool-call">
      <details className="tool-call-header">
        <summary>
          <span className={`tool-status ${toolStatus}`} />
          <code>{toolName}</code>
          {running && <span className="tool-running">{t("tool.running")}</span>}
        </summary>
        <div className="tool-call-label">{t("tool.arguments")}</div>
        <pre>{argsText || JSON.stringify(args, null, 2)}</pre>
        {mcpResult && (
          <>
            <div className="tool-call-label">{t("tool.result")}</div>
            <pre>{JSON.stringify(mcpResult, null, 2)}</pre>
          </>
        )}
      </details>
      {errorText && <div className="tool-error">{errorText}</div>}
      {hasView && mcpResult && !isError && (
        <Suspense fallback={<div className="view view-loading" />}>
          <McpAppView
            toolCallId={toolCallId}
            toolName={toolName}
            args={args as Record<string, unknown>}
            result={mcpResult}
            onMessage={append}
          />
        </Suspense>
      )}
    </div>
  );
}
