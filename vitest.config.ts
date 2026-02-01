import { defineConfig } from "vitest/config";
import { loadTestEnv } from "./tests/test-env.js";
import path from "path";
import fs from "fs";

loadTestEnv();

function getPackageAliases(): Record<string, string> {
  const packagesDir = path.resolve(__dirname, "packages");
  const packages = fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  const mainAliases: Record<string, string> = {};
  const subpathAliases: Record<string, string> = {};

  for (const pkg of packages) {
    // Main export: @poe-code/<name> -> packages/<name>/src/index.ts
    mainAliases[`@poe-code/${pkg}`] = path.resolve(packagesDir, pkg, "src/index.ts");

    // Check for /testing subpath export
    const testingIndexPath = path.resolve(packagesDir, pkg, "src/testing/index.ts");
    if (fs.existsSync(testingIndexPath)) {
      subpathAliases[`@poe-code/${pkg}/testing`] = testingIndexPath;
    }
  }

  // Subpath aliases must come first for correct resolution
  return { ...subpathAliases, ...mainAliases };
}

export default defineConfig({
  resolve: {
    // Resolve workspace packages to source for tests (no build required)
    alias: getPackageAliases()
  },
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
