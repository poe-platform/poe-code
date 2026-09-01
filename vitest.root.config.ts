import { defineConfig } from "vitest/config";
import { workspaceTestExclusions } from "./scripts/workspace-test-ownership.mjs";
import unitConfig from "./vitest.config.js";

export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    exclude: [...(unitConfig.test?.exclude ?? []), ...workspaceTestExclusions(import.meta.dirname)]
  }
});
