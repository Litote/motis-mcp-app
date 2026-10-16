# Agent evaluation

Checks what models do with the tools of the server: each scenario of [scenarios.ts](scenarios.ts) is sent, as a user
message, to the agent of the web chat ([src/agent.ts](../src/agent.ts), unchanged: same system prompt, tools and loop),
which calls a real MCP server. Its tool calls and its answer are then checked ([checks.ts](checks.ts)):

- for every scenario: the run completed (not stopped by the step limit), an answer was given, no tool returned an error
  (unless the scenario expects one), and the answer is short (≤ 1500 characters: the views show the details);
- per scenario: the tools called, in order (e.g. `explore_area` then `route_details`), some arguments (e.g. `arriveBy`,
  `wheelchair`, a time of tomorrow at 08:00 in the local time of Lyon) and some properties of the answer (e.g. in English
  for an English message).

The checks bear on the tool calls rather than on the facts of the answer, which depend on the timetable of the day.

## Run

```bash
# MCP server (or EVAL_MCP_URL=<deployed endpoint>)
MOTIS_APP_CONTACT=you@example.org server/build/install/server/bin/server --http --port 3001

cd web
OPENROUTER_API_KEY=sk-or-... npm run eval
```

| Variable             | Default                              |                                                    |
|----------------------|--------------------------------------|----------------------------------------------------|
| `OPENROUTER_API_KEY` | —                                    | required (skipped without it)                      |
| `EVAL_MODELS`        | default model of the web chat        | comma-separated OpenRouter model ids               |
| `EVAL_MCP_URL`       | `http://localhost:3001/mcp`          | MCP endpoint                                       |
| `EVAL_SCENARIOS`     | all                                  | comma-separated scenario ids, e.g. `local_time,ambiguous` |
| `EVAL_DELAY_MS`      | `0`                                  | pause between runs (free models: 20 requests/min)  |

A full run is 15 scenarios × about 2 to 4 model calls per model: with a free model (50 requests per day without
credits), run a few scenarios at a time with `EVAL_SCENARIOS`.

The report is written to `web/eval/results/<date>.md` (and `.json`, git-ignored): a table scenario × model (checks
passed, model calls, duration), then the tool calls and the answer of each failed run. Vitest also lists the failed
checks of each scenario.

## Add a scenario

Add it to [scenarios.ts](scenarios.ts): an `id`, the `prompt`, and the expected `tools` with checks of their `args` and
of the `answer`. Prefer checks on the arguments (what the model understood) to checks on the answer (which depends on
the data of the day).
