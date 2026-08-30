import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@poe-code/safe-js": fileURLToPath(new URL("../src/index.ts", import.meta.url))
    }
  },
  test: {
    include: ["packages/safe-js/test/final-async-proof*.test.ts"],
    pool: "forks",
    maxWorkers: 1,
    testTimeout: 2000
  }
});
