import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const path = (value) => fileURLToPath(new URL(value, import.meta.url));
const suites = ["suggest", "runtime-logging", "redaction", "package-metadata", "source-snippet"];

export default defineConfig({
  plugins: [
    {
      name: "toolcraft-rust-reference",
      enforce: "pre",
      resolveId(name, importer) {
        if (
          ["clone-command-node", "toolcraft", "mcp-result", "stream", "stream-lifecycle", "schema-scope-exhausted"].some(
            (suite) => importer === path(`../toolcraft/src/${suite}.test.ts`)
          ) &&
          name === "./index.js"
        )
          return path("tests/definition-entry.mjs");
        if (importer?.startsWith(path("../toolcraft/src/")) && name === "./stream.js")
          return path("dist/stream.js");
        if (importer?.startsWith(path("../toolcraft/src/")) && name === "./schema-scope.js")
          return path("dist/schema-scope.js");
        if (
          suites.some(
            (suite) =>
              importer === path(`../toolcraft/src/${suite}.test.ts`) && name === `./${suite}.js`
          )
        )
          return ["./package-metadata.js", "./source-snippet.js"].includes(name)
            ? path(`dist/${name.slice(2)}`)
            : path("dist/index.js");
      }
    }
  ],
  test: {
    include: [
      path("tests/package-metadata-parity.test.ts"),
      path("tests/mcp-result-parity.test.ts"),
      path("tests/source-snippet-parity.test.ts"),
      ...[...suites, "clone-command-node", "toolcraft", "mcp-result", "stream", "stream-lifecycle", "schema-scope", "schema-scope-exhausted"].map((suite) =>
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
