import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/safe-js/test/integration/input-error-projection.test.ts"],
    environment: "node",
    maxWorkers: 1,
    hookTimeout: 15000,
    testTimeout: 10000
  }
});
