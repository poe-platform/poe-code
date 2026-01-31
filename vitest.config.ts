import { defineConfig } from "vitest/config";
import { loadTestEnv } from "./tests/test-env.js";

loadTestEnv();

export default defineConfig({
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
