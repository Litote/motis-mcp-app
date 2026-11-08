import type { ThreadMessage } from "@assistant-ui/react";
import { describe, expect, it } from "vitest";
import { MAX_EXPORTED_RESULT_CHARS, transcript } from "./transcript";

const CONTEXT = {
  page: "https://errance.litote.org/",
  model: "openai/gpt-5",
  locale: "fr-FR",
  userAgent: "Firefox",
  date: new Date("2026-11-08T10:00:00Z"),
};

const user = (text: string) => ({ id: "u", role: "user", content: [{ type: "text", text }] }) as unknown as ThreadMessage;
const assistant = (content: unknown[], status: unknown = { type: "complete", reason: "stop" }) =>
  ({ id: "a", role: "assistant", content, status }) as unknown as ThreadMessage;

describe("transcript", () => {
  it("writes the context, then the messages with their tool calls", () => {
    const markdown = transcript(
      [
        user("Departures at Lyon"),
        assistant([
          { type: "text", text: "Here:" },
          {
            type: "tool-call",
            toolName: "departures",
            args: { stop: "Lyon" },
            argsText: '{"stop":"Lyon"}',
            result: { content: [{ type: "text", text: "12:04" }, { type: "image" }] },
          },
          { type: "tool-call", toolName: "trip_details", args: {}, argsText: "", result: { content: [{ type: "text", text: "unknown trip" }] }, isError: true },
          { type: "tool-call", toolName: "lines", args: { q: "T1" }, argsText: "" },
        ]),
      ],
      CONTEXT,
    );

    expect(markdown).toBe(`## Context

- Page: https://errance.litote.org/
- Model: \`openai/gpt-5\`
- Locale: fr-FR
- Browser: Firefox
- Exported: 2026-11-08T10:00:00.000Z

## Conversation

### User

Departures at Lyon

### Assistant

Here:

<details><summary>Tool <code>departures</code></summary>

Arguments:

\`\`\`json
{"stop":"Lyon"}
\`\`\`

Result:

\`\`\`
12:04
[image]
\`\`\`

</details>

<details><summary>Tool <code>trip_details</code> (error)</summary>

Arguments:

\`\`\`json
{}
\`\`\`

Result:

\`\`\`
unknown trip
\`\`\`

</details>

<details><summary>Tool <code>lines</code> (no result)</summary>

Arguments:

\`\`\`json
{
  "q": "T1"
}
\`\`\`

</details>
`);
  });

  it("keeps the code blocks closed, and truncates the long results", () => {
    const markdown = transcript(
      [
        assistant([
          {
            type: "tool-call",
            toolName: "route",
            args: {},
            argsText: "{}",
            result: { content: [{ type: "text", text: "```" + "x".repeat(MAX_EXPORTED_RESULT_CHARS) }] },
          },
        ]),
      ],
      CONTEXT,
    );

    expect(markdown).toContain("````\n```x");
    expect(markdown).toContain("[… 3 characters truncated]\n````");
  });

  it("gives the models that answered", () => {
    const answer = { ...assistant([{ type: "text", text: "Done" }]), metadata: { custom: { models: ["a/first:free", "b/fallback:free"] } } };

    expect(transcript([answer as unknown as ThreadMessage], CONTEXT)).toContain(
      "### Assistant\n\nDone\n\n_Models: `a/first:free` → `b/fallback:free`_\n",
    );
  });

  it("says why an answer is incomplete", () => {
    const markdown = transcript(
      [
        assistant([], { type: "incomplete", reason: "error", error: "Rate limited\nretry later" }),
        assistant([{ type: "text", text: "Part" }], { type: "incomplete", reason: "cancelled" }),
        assistant([{ type: "text", text: "" }], { type: "running" }),
      ],
      CONTEXT,
    );

    expect(markdown).toContain("### Assistant\n\n> **Incomplete (error)**: Rate limited\n> retry later\n");
    expect(markdown).toContain("Part\n\n_(stopped by the user)_");
    expect(markdown).toContain("### Assistant\n\n_(still running at the export)_");
  });
});
