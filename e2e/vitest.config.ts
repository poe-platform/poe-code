import { defineConfig } from "vitest/config";
import path from "path";

const e2ePackageSrc = path.resolve(__dirname, "../packages/e2e-test-runner/src");
const authStorePackageSrc = path.resolve(__dirname, "../packages/auth-store/src");

export default defineConfig({
  resolve: {
    alias: {
      "@poe-code/e2e-test-runner/matchers": path.join(e2ePackageSrc, "matchers.ts"),
      "@poe-code/e2e-test-runner": path.join(e2ePackageSrc, "index.ts"),
      "auth-store": path.join(authStorePackageSrc, "index.ts")
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
