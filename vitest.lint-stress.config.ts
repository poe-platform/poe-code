import { defineConfig } from "vitest/config";
import unitConfig from "./vitest.config.js";

export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    include: ["scripts/lint-eslint.stress.ts"],
    maxWorkers: 1,
    fileParallelism: false,
    sequence: { ...unitConfig.test?.sequence, concurrent: false },
    bail: 0,
    passWithNoTests: false
  }
});
