import { defineConfig } from "vitest/config";

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
