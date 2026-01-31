import { defineConfig } from "vitest/config";
import { loadTestEnv } from "./tests/test-env.js";
import path from "path";

loadTestEnv();

export default defineConfig({
  resolve: {
    alias: {
      // TODO: Remove when turborepo is added
      "@poe-code/agent-defs": path.resolve(__dirname, "packages/agent-defs/src/index.ts"),
      "@poe-code/design-system": path.resolve(__dirname, "packages/design-system/src/index.ts"),
      "@poe-code/config-mutations/testing": path.resolve(__dirname, "packages/config-mutations/src/testing/index.ts"),
      "@poe-code/config-mutations": path.resolve(__dirname, "packages/config-mutations/src/index.ts")
    }
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/*.test.ts",              // Collocated unit tests
      "tests/integration/**/*.test.ts", // Integration tests
      "packages/**/*.test.ts"          // Package tests
    ],
    setupFiles: ["tests/setup.ts"]
  }
});
