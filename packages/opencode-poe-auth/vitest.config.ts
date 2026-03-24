import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import baseConfig from "../../vitest.config.js";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, "../..");

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    setupFiles: [path.join(repoRoot, "tests/setup.ts")]
  }
});
