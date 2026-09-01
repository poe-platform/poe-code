import { defineConfig, Plugin } from "vitest/config";
import { loadTestEnv } from "./tests/test-env.js";
import path from "path";
import fs from "fs";

loadTestEnv();

// Plugin to load .mustache and .md files as raw text (like esbuild's text loader)
function rawTextPlugin(): Plugin {
  return {
    name: "raw-text",
    transform(code, id) {
      if (id.endsWith(".mustache") || id.endsWith(".md") || id.endsWith(".log")) {
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
  const packages = fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name)
    .filter((pkg) => fs.existsSync(path.resolve(packagesDir, pkg, "package.json")));

  const mainAliases: Record<string, string> = {};
  const subpathAliases: Record<string, string> = {};
  const bareMainAliases: Record<string, string> = {};
  const bareSubpathAliases: Record<string, string> = {};

  for (const pkg of packages) {
    const packageJsonPath = path.resolve(packagesDir, pkg, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      exports?: unknown;
      name?: unknown;
    };
    const packageName = typeof packageJson.name === "string" ? packageJson.name : undefined;
    const mainEntryPath = path.resolve(packagesDir, pkg, "src/index.ts");

    // Main export: @poe-code/<name> -> packages/<name>/src/index.ts
    mainAliases[`@poe-code/${pkg}`] = mainEntryPath;
    if (packageName !== undefined) {
      bareMainAliases[packageName] = mainEntryPath;
    }

    for (const subpath of ["cli", "mcp", "sdk"]) {
      const entryPath = path.resolve(packagesDir, pkg, "src", `${subpath}.ts`);
      if (fs.existsSync(entryPath)) {
        subpathAliases[`@poe-code/${pkg}/${subpath}`] = entryPath;
        if (packageName !== undefined) {
          bareSubpathAliases[`${packageName}/${subpath}`] = entryPath;
        }
      }
    }

    // Check for /testing subpath export
    const testingEntryPath = path.resolve(packagesDir, pkg, "src/testing.ts");
    const testingIndexPath = path.resolve(packagesDir, pkg, "src/testing/index.ts");
    const resolvedTestingPath = fs.existsSync(testingEntryPath)
      ? testingEntryPath
      : fs.existsSync(testingIndexPath)
        ? testingIndexPath
        : undefined;
    if (resolvedTestingPath !== undefined) {
      subpathAliases[`@poe-code/${pkg}/testing`] = resolvedTestingPath;
      if (packageName !== undefined) {
        bareSubpathAliases[`${packageName}/testing`] = resolvedTestingPath;
      }
    }

    if (
      typeof packageJson.exports === "object" &&
      packageJson.exports !== null &&
      !Array.isArray(packageJson.exports)
    ) {
      for (const exportKey of Object.keys(packageJson.exports)) {
        if (exportKey === "." || !exportKey.startsWith("./")) {
          continue;
        }

        const subpath = exportKey.slice(2);
        const subpathEntryPath = path.resolve(packagesDir, pkg, "src", `${subpath}.ts`);
        const subpathIndexPath = path.resolve(packagesDir, pkg, "src", subpath, "index.ts");
        const resolvedSubpath = fs.existsSync(subpathEntryPath)
          ? subpathEntryPath
          : fs.existsSync(subpathIndexPath)
            ? subpathIndexPath
            : undefined;

        if (resolvedSubpath === undefined) {
          continue;
        }

        subpathAliases[`@poe-code/${pkg}/${subpath}`] = resolvedSubpath;
        if (packageName !== undefined) {
          bareSubpathAliases[`${packageName}/${subpath}`] = resolvedSubpath;
        }
      }
    }
  }

  // Subpath aliases must come first for correct resolution
  return {
    ...bareSubpathAliases,
    ...subpathAliases,
    ...bareMainAliases,
    ...mainAliases
  };
}

export default defineConfig({
  plugins: [rawTextPlugin()],
  resolve: {
    // Resolve workspace packages to source for tests (no build required)
    alias: getPackageAliases()
  },
  test: {
    silent: "passed-only",
    ...(process.env.CI && process.env.CI !== "false" && process.env.CI !== "0"
      ? { reporters: ["dot"], silent: "passed-only" as const }
      : {}),
    globals: true,
    environment: "node",
    pool: "threads",
    include: [
      "src/**/*.test.ts", // Collocated unit tests
      "tests/helpers/**/*.test.ts", // Test helper tests
      "tests/integration/**/*.test.ts", // Integration tests
      "packages/**/*.test.ts", // Package tests
      "packages/**/*.spec.ts", // Package specs
      "scripts/**/*.test.ts" // Script tests
    ],
    exclude: [
      "**/node_modules/**",
      "packages/safe-bash/**",
      "scripts/**/*.lifecycle.test.ts",
      "**/*.e2e.test.ts" // E2E tests run separately
    ],
    maxWorkers: 2,
    setupFiles: ["tests/setup.ts"]
  }
});
