import { defineConfig } from "vitest/config";

// the dates of the scenarios ("tomorrow at 8") and the time zone given to the model are those of Lyon and Paris
process.env.TZ = "Europe/Paris";

/** Evaluation of the agent with real models (eval/README.md): `npm run eval`, never in the unit tests. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["eval/**/*.eval.ts"],
    setupFiles: ["src/test-setup.ts"],
    // one model call is up to a minute with a free model, a scenario takes a few of them
    testTimeout: 300_000,
    // one run at a time: the free models are rate limited
    fileParallelism: false,
  },
});
