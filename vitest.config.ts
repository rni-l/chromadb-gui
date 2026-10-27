import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "web/src/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
