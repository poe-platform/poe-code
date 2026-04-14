import { defineConfig, Plugin } from "vitest/config";
import { loadTestEnv } from "./tests/test-env.js";
import path from "path";
import fs from "fs";

loadTestEnv();

// Plugin to load .hbs and .md files as raw text (like esbuild's text loader)
function rawTextPlugin(): Plugin {
  return {
    name: "raw-text",
    transform(code, id) {
      if (id.endsWith(".hbs") || id.endsWith(".md") || id.endsWith(".log")) {
        // We can just use the code that vitest already read from disk
        return {
          code: `export default ${JSON.stringify(code)};`,
          map: null
        };
      }
    }
  };
}

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

    for (const subpath of ["cli", "mcp", "sdk"]) {
      const entryPath = path.resolve(packagesDir, pkg, "src", `${subpath}.ts`);
      if (fs.existsSync(entryPath)) {
        subpathAliases[`@poe-code/${pkg}/${subpath}`] = entryPath;
      }
    }

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
  plugins: [rawTextPlugin()],
  resolve: {
    // Resolve workspace packages to source for tests (no build required)
    alias: getPackageAliases()
  },
  test: {
    globals: true,
    environment: "node",
    pool: "threads",
    include: [
      "src/**/*.test.ts",              // Collocated unit tests
      "tests/helpers/**/*.test.ts",    // Test helper tests
      "tests/integration/**/*.test.ts", // Integration tests
      "packages/**/*.test.ts",         // Package tests
      "scripts/screenshot.test.ts"     // Script tests (explicit)
    ],
    exclude: [
      "**/node_modules/**",
      "**/*.e2e.test.ts"               // E2E tests run separately
    ],
    setupFiles: ["tests/setup.ts"]
  }
});
