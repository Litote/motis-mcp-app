/** Markdown report of an evaluation. */
import type { CheckResult, RunRecord, Scenario } from "./checks";

export interface Run {
  model: string;
  scenario: Scenario;
  record: RunRecord;
  checks: CheckResult[];
  seconds: number;
}

const passed = (checks: CheckResult[]) => checks.filter((c) => c.ok).length;

/** Markdown report: a table scenario × model, then the details of the failed runs. */
export function report(runs: Run[], mcpUrl: string, date: Date = new Date()): string {
  const ids = [...new Set(runs.map((r) => r.scenario.id))];
  const names = [...new Set(runs.map((r) => r.model))];
  const cell = (model: string, id: string) => {
    const r = runs.find((run) => run.model === model && run.scenario.id === id);
    if (!r) return "";
    const ok = r.checks.every((c) => c.ok);
    return `${ok ? "✓" : "✗"} ${passed(r.checks)}/${r.checks.length} · ${r.record.steps} steps · ${Math.round(r.seconds)} s`;
  };
  const score = (model: string) => {
    const mine = runs.filter((r) => r.model === model);
    return `${mine.filter((r) => r.checks.every((c) => c.ok)).length}/${mine.length} scenarios`;
  };
  const lines = [
    `# Agent evaluation — ${date.toISOString().slice(0, 16)}`,
    "",
    `MCP server: ${mcpUrl}`,
    "",
    `| Scenario | ${names.join(" | ")} |`,
    `|---|${names.map(() => "---").join("|")}|`,
    ...ids.map((id) => `| ${id} | ${names.map((m) => cell(m, id)).join(" | ")} |`),
    `| **Total** | ${names.map((m) => `**${score(m)}**`).join(" | ")} |`,
    "",
  ];
  for (const r of runs.filter((run) => !run.checks.every((c) => c.ok))) {
    lines.push(
      `## ✗ ${r.scenario.id} — ${r.model}`,
      "",
      `> ${r.scenario.prompt}`,
      "",
      `Failed: ${r.checks.filter((c) => !c.ok).map((c) => c.label).join("; ")}`,
      ...(r.record.error ? ["", `Error: ${r.record.error}`] : []),
      "",
      "Tool calls:",
      ...r.record.calls.map(
        (c) => `- ${c.isError ? "✗ " : ""}\`${c.tool}\` \`${JSON.stringify(c.args)}\`${c.isError ? ` → ${c.result.split("\n")[0]}` : ""}`,
      ),
      ...(r.record.calls.length ? [] : ["- none"]),
      "",
      "Answer:",
      "",
      ...(r.record.answer || "(none)").split("\n").map((line) => `> ${line}`),
      "",
    );
  }
  return lines.join("\n");
}
