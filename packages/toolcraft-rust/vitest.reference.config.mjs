import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const path = (value) => fileURLToPath(new URL(value, import.meta.url));
const suites = ["suggest", "runtime-logging", "redaction", "package-metadata"];

export default defineConfig({
  plugins: [
    {
      name: "toolcraft-rust-reference",
      enforce: "pre",
      resolveId(name, importer) {
        if (
          ["clone-command-node", "toolcraft"].some(
            (suite) => importer === path(`../toolcraft/src/${suite}.test.ts`)
          ) &&
          name === "./index.js"
        )
          return path("tests/definition-entry.mjs");
        if (
          suites.some(
            (suite) =>
              importer === path(`../toolcraft/src/${suite}.test.ts`) && name === `./${suite}.js`
          )
        )
          return name === "./package-metadata.js"
            ? path("dist/package-metadata.js")
            : path("dist/index.js");
      }
    }
  ],
  test: {
    include: [
      path("tests/package-metadata-parity.test.ts"),
      ...[...suites, "clone-command-node", "toolcraft"].map((suite) =>
        path(`../toolcraft/src/${suite}.test.ts`)
      )
    ],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
