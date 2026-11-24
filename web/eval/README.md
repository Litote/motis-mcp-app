# Agent evaluation

Checks what models do with the tools of the server: each scenario of [scenarios.ts](scenarios.ts) is sent, as a user
message, to the agent of the web chat ([src/agent.ts](../src/agent.ts), unchanged: same system prompt, tools and loop),
which calls a real MCP server. Its tool calls and its answer are then checked ([checks.ts](checks.ts)):

- for every scenario: the run completed (not stopped by the step limit), an answer was given, no tool returned an error
  (unless the scenario expects one), and the answer is short (≤ 1500 characters: the views show the details);
- per scenario: the tools called, in order (e.g. `explore_area` then `route_details`), some arguments (e.g. `arriveBy`,
  `wheelchair`, a time of tomorrow at 08:00 in the local time of Lyon) and some properties of the answer (e.g. in English
  for an English message, or telling the service alerts given by the tools, when they give some).

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
| `EVAL_MODELS`        | recommended model of the web chat    | comma-separated OpenRouter model ids               |
| `EVAL_MCP_URL`       | `http://localhost:3001/mcp`          | MCP endpoint                                       |
| `EVAL_SCENARIOS`     | all                                  | comma-separated scenario ids, e.g. `local_time,ambiguous` |
| `EVAL_DELAY_MS`      | `0`                                  | pause between runs (free models: 20 requests/min)  |

A full run is 16 scenarios × about 2 to 4 model calls per model: with a free model (50 requests per day without
credits), run a few scenarios at a time with `EVAL_SCENARIOS`.

The report is written to `web/eval/results/<date>.md` (and `.json`, git-ignored): a table scenario × model (checks
passed, model calls, duration), then the tool calls and the answer of each failed run. Vitest also lists the failed
checks of each scenario.

## Scores and the recommended model

Each run also updates [src/model-scores.json](../src/model-scores.json): the last result of each scenario per model
(passed or not, duration, day). Commit it: the web chat chooses its free model from it ([src/modelScores.ts](../src/modelScores.ts)).

- Score of a model: (scenarios passed + 1) / (scenarios run + 2), so that a model run on few scenarios does not rank
  above one run on many with a few failures (1/1 scores 0.67, 3/3 0.8, 15/16 0.89). Equal scores: the fastest first.
- A run ended by an error (rate limited, model no longer free, network…) measured nothing: it is shown as "not
  evaluated" and leaves the score unchanged.
- Recommended model: the best one still free on OpenRouter, unless the user chose another one. Fallbacks of a free
  model: the next ones (3 at most), scoring at least 0.5.

To evaluate a new free model, run it with `EVAL_MODELS`: it is recommended as soon as it ranks first.

## Daily evaluation

[model-scores.yml](../../.github/workflows/model-scores.yml) completes the scores every day, with 25 model calls at
most (`EVAL_AUTO=1`, `EVAL_MAX_CALLS=25`: half of the 50 daily requests of a free OpenRouter account):

- runs planned ([plan.ts](plan.ts)): the scenarios without result of the free models listed by OpenRouter, the models
  already scored first (best first), then the new ones (newest first). A model that failed twice and scores under 0.5
  is no longer completed. Nothing is planned, and nothing called, once every free model listed is evaluated;
- a scenario is started only with 4 calls left at least, and a model is skipped after 2 errors in a row (rate
  limited…);
- the budget is also bounded by the free requests left today (`GET /api/v1/key`): with fewer than 4, nothing is
  planned. An error of the account ([account.ts](account.ts): invalid key, negative balance or key limit, daily quota
  reached) stops the evaluation: the scores obtained before it are committed, then the run fails, to be notified. A
  model failing a check does not fail it;
- the scores are committed to the branch `model-scores`, in a pull request merged once approved (auto-merge).

It needs the `OPENROUTER_API_KEY` secret (nothing is evaluated without it). Locally, the same run:
`EVAL_AUTO=1 EVAL_MAX_CALLS=25 OPENROUTER_API_KEY=sk-or-... npm run eval`.

## Add a scenario

Add it to [scenarios.ts](scenarios.ts): an `id`, the `prompt`, and the expected `tools` with checks of their `args` and
of the `answer`. Prefer checks on the arguments (what the model understood) to checks on the answer (which depends on
the data of the day).
