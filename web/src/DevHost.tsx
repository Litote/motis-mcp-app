/**
 * Dev host of the views: calls a tool of the MCP server with arguments typed by hand and renders its view, as the chat
 * does after a tool call of the model, without OpenRouter. Served by the Vite dev server only (dev.html).
 */
import { Suspense, lazy, useEffect, useState } from "react";
import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import { callTool, connectMcp, resultText, type McpServer } from "./mcp";
import { toolUiResourceUri } from "./mcp-apps";

const McpAppView = lazy(() => import("./McpAppView").then((module) => ({ default: module.McpAppView })));

const ARGS_STORAGE = "dev-args:";
const TOOL_STORAGE = "dev-tool";

interface Call {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result: CallToolResult;
  hasView: boolean;
}

/**
 * Example arguments of each tool of the server. route_details and trip_details take ids returned by other tools
 * (explore_area, departures): the trip id is dated, replace it by one of a recent departures call.
 */
export const EXAMPLES: Record<string, Record<string, unknown>> = {
  search_places: { text: "Lyon Part-Dieu", limit: 5 },
  server_info: {},
  explore_area: { place: "Lyon Part-Dieu", radiusKm: 1 },
  route_details: { routeIdx: 1342389 },
  reachability: { place: "Lyon Part-Dieu", maxTravelTimeMinutes: 30 },
  departures: { stop: "Lyon Part-Dieu", count: 10 },
  trip_details: { tripId: "20261016_20:00_it-trenitalia_0083_680083_0_v_68-6655-7E2F-0083_v_68-6655-7E2F-0083" },
  plan_journey: { from: "Lyon Part-Dieu", to: "Paris Gare de Lyon" },
  rentals: { place: "Lyon Part-Dieu", radiusKm: 0.5 },
};

type Schema = { properties?: Record<string, { default?: unknown; examples?: unknown[] }>; required?: string[] };

/** Arguments last sent to [tool], or its example arguments. */
export function initialArgs(tool: Tool): string {
  return load(ARGS_STORAGE + tool.name) ?? exampleArgs(tool);
}

/** Example arguments of [tool], or its required arguments (default or example value when the schema gives one). */
export function exampleArgs(tool: Tool): string {
  const example = EXAMPLES[tool.name];
  if (example) return JSON.stringify(example, null, 2);
  const schema = tool.inputSchema as Schema;
  const args = Object.fromEntries(
    (schema.required ?? []).map((name) => {
      const property = schema.properties?.[name];
      return [name, property?.default ?? property?.examples?.[0] ?? ""];
    }),
  );
  return JSON.stringify(args, null, 2);
}

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage unavailable
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable: not kept
  }
}

export function DevHost() {
  const [mcp, setMcp] = useState<McpServer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toolName, setToolName] = useState("");
  const [argsText, setArgsText] = useState("{}");
  const [calls, setCalls] = useState<Call[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const selectTool = (server: McpServer, name: string) => {
    setToolName(name);
    const tool = server.tools.get(name);
    if (!tool) return;
    setArgsText(initialArgs(tool));
    // stored values: a tool of the server, not the typed input
    save(TOOL_STORAGE, tool.name);
  };

  useEffect(() => {
    connectMcp()
      .then((server) => {
        setMcp(server);
        // last selected tool, or the first one with a view
        const last = server.tools.get(load(TOOL_STORAGE) ?? "");
        const first = last ?? [...server.tools.values()].find((tool) => toolUiResourceUri(tool)) ?? server.tools.values().next().value;
        if (first) selectTool(server, first.name);
      })
      .catch((e: unknown) => setError(`MCP server unavailable: ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  const run = async () => {
    if (!mcp) return;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argsText) as Record<string, unknown>;
    } catch (e) {
      setError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const tool = mcp.tools.get(toolName);
    if (!tool) return;
    setError(null);
    // stored values: a tool of the server and the parsed arguments, not the typed input
    save(ARGS_STORAGE + tool.name, JSON.stringify(args));
    setRunning(true);
    const result = await callTool(mcp, toolName, args);
    setRunning(false);
    const call = { id: `dev-${Date.now()}`, toolName, args, result, hasView: !!toolUiResourceUri(tool) };
    setCalls((previous) => [call, ...previous]);
  };

  const tools = mcp ? [...mcp.tools.values()] : [];
  const description = mcp?.tools.get(toolName)?.description;

  return (
    <div className="dev">
      <form
        className="dev-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <select aria-label="Tool" value={toolName} onChange={(event) => mcp && selectTool(mcp, event.target.value)}>
          {tools.map((tool) => (
            <option key={tool.name} value={tool.name}>
              {tool.name}
              {toolUiResourceUri(tool) ? "" : " (no view)"}
            </option>
          ))}
        </select>
        {description && <p className="dev-description">{description}</p>}
        <textarea
          aria-label="Arguments"
          className="dev-args"
          rows={8}
          spellCheck={false}
          value={argsText}
          onChange={(event) => setArgsText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void run();
            }
          }}
        />
        <div className="dev-actions">
          <button type="submit" className="primary" disabled={!mcp || running}>
            {running ? "Calling…" : "Call (Ctrl+Enter)"}
          </button>
          <button
            type="button"
            disabled={!mcp?.tools.has(toolName)}
            onClick={() => {
              const tool = mcp?.tools.get(toolName);
              if (tool) setArgsText(exampleArgs(tool));
            }}
          >
            Example
          </button>
        </div>
        {error && <p className="message-error">{error}</p>}
      </form>
      {messages.length > 0 && (
        <ul className="dev-messages" aria-label="Messages of the views">
          {messages.map((message, index) => (
            <li key={`${index}-${message}`}>ui/message: {message}</li>
          ))}
        </ul>
      )}
      {calls.map((call) => (
        <div key={call.id} className="tool-call">
          <details className="tool-call-header" open={!call.hasView}>
            <summary>
              <span className={`tool-status ${call.result.isError ? "error" : "done"}`} />
              <code>{call.toolName}</code>
            </summary>
            <pre>{JSON.stringify(call.args, null, 2)}</pre>
            <pre>{resultText(call.result)}</pre>
          </details>
          {call.result.isError && <div className="tool-error">{resultText(call.result)}</div>}
          {call.hasView && !call.result.isError && (
            <Suspense fallback={<div className="view view-loading" />}>
              <McpAppView
                toolCallId={call.id}
                toolName={call.toolName}
                args={call.args}
                result={call.result}
                onMessage={(text) => setMessages((previous) => [...previous, text])}
              />
            </Suspense>
          )}
        </div>
      ))}
    </div>
  );
}
