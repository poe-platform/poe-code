import { defineConfig } from "vitest/config";
import unitConfig from "../../vitest.config.js";
import { consumePretestShardCompletion } from "./scripts/unit-config-helper.mjs";

export default defineConfig({
  resolve: unitConfig.resolve,
  test: {
    globals: true,
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 15000,
    teardownTimeout: 15000,
    maxWorkers: 1,
    setupFiles: ["../../tests/setup.ts"],
    env: { FORCE_COLOR: "1" },
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: consumePretestShardCompletion(),
    passWithNoTests: true
  }
});
