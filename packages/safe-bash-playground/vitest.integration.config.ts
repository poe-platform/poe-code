import { defineConfig } from "vitest/config";
import base from "../../vitest.config.js";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["packages/safe-bash-playground/src/session.integration.ts"]
  }
});
