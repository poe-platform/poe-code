import { defineConfig } from "vitest/config";
import { loadTestEnv } from "./tests/test-env.js";

loadTestEnv();

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"]
  }
});
