import { defineConfig } from "vitest/config";

// places without time zone are shown in the time zone of the browser: the tests run in the one of their data
process.env.TZ = "Europe/Paris";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test/**", "src/shared/types.ts"],
      // lcov for SonarCloud, with paths from the root of the repository
      reporter: ["text-summary", ["lcov", { projectRoot: ".." }]],
    },
  },
});
