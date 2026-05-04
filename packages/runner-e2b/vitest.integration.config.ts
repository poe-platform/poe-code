import { defineConfig } from "vitest/config";
import rootConfig from "../../vitest.config.js";

export default defineConfig({
  ...rootConfig,
  test: {
    ...rootConfig.test,
    include: ["packages/runner-e2b/src/e2b-execution-env.integration.ts"]
  }
});
