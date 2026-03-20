import { defineConfig } from "vitest/config";
import path from "path";

const e2ePackageSrc = path.resolve(__dirname, "../packages/e2e-docker-test-runner/src");
const authPackageSrc = path.resolve(__dirname, "../packages/poe-auth/src");

export default defineConfig({
  resolve: {
    alias: {
      "@poe-code/e2e-docker-test-runner/matchers": path.join(e2ePackageSrc, "matchers.ts"),
      "@poe-code/e2e-docker-test-runner": path.join(e2ePackageSrc, "index.ts"),
      "@poe-code/poe-auth": path.join(authPackageSrc, "index.ts")
    }
  },
  test: {
    root: __dirname,
    testTimeout: 300000,
    hookTimeout: 300000,
    include: ["*.test.ts"],
    maxWorkers: 1,
    globalSetup: "./setup.ts",
    setupFiles: [path.join(e2ePackageSrc, "matchers.ts")]
  }
});
