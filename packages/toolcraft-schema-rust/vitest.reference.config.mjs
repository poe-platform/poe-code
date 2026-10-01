import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const path = (value) => fileURLToPath(new URL(value, import.meta.url));

export default defineConfig({
  plugins: [
    {
      name: "schema-rust-host-values",
      enforce: "pre",
      resolveId(name, importer) {
        if (name === "toolcraft-schema") return path("../toolcraft-schema/src/index.ts");
        if (!importer?.startsWith(path("../toolcraft-schema/src/"))) return;
        if (name === "./validate.js" || name === "../validate.js")
          return path("tests/validate-entry.mjs");
        if (name === "./clone-default.js") return path("dist/host-values.js");
        if (name === "./json.js") return path("tests/json-entry.mjs");
      }
    }
  ],
  test: {
    include: [
      "default-cloning",
      "schema-default-isolation",
      "json-limits",
      "json-value-safety",
      "json-literal-constraints",
      "validate",
      "validation-default-options",
      "validation-no-defaults",
      "union",
      "sparse-arrays",
      "nonplain-diagnostics",
      "string-length",
      "native-json-schema",
      "standard",
      "index",
      "discriminator-metadata",
      "json-schema-document",
      "nullable-json-schema"
    ].map((suite) => path(`../toolcraft-schema/src/${suite}.test.ts`)),
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
