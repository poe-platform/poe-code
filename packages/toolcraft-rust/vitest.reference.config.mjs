import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import ts from "typescript";

const path = (value) => fileURLToPath(new URL(value, import.meta.url));
const suites = ["suggest", "runtime-logging", "redaction", "package-metadata", "source-snippet"];

export default defineConfig({
  plugins: [
    {
      name: "toolcraft-rust-reference",
      enforce: "pre",
      resolveId(name, importer) {
        if (importer?.startsWith(path("../toolcraft/src/")) && name.startsWith(".")) {
          const resolved = resolve(dirname(importer), name);
          if (resolved === path("../toolcraft/src/runtime/io.js")) return path("dist/runtime-io.js");
          if (resolved === path("../toolcraft/src/human-in-loop/wiring.js")) return path("dist/approval-wiring.js");
        }
        if (importer?.startsWith(path("../toolcraft/src/")) && name === "toolcraft-schema")
          return path("../toolcraft-schema-rust/dist/index.js");
        if (
          ["clone-command-node", "toolcraft", "mcp-result", "stream", "stream-lifecycle", "schema-scope-exhausted", "schema-member-collisions", "discriminator-validation", "union-validation", "applied-default-validation"].some(
            (suite) => importer === path(`../toolcraft/src/${suite}.test.ts`)
          ) &&
          name === "./index.js"
        )
          return path("tests/definition-entry.mjs");
        if (importer?.startsWith(path("../toolcraft/src/")) && name === "./stream.js")
          return path("dist/stream.js");
        if (importer?.startsWith(path("../toolcraft/src/")) && name === "./schema-scope.js")
          return path("dist/schema-scope.js");
        if (importer?.startsWith(path("../toolcraft/src/")) && name === "./schema-member-names.js")
          return path("dist/schema-member-names.js");
        if (importer?.startsWith(path("../toolcraft/src/")) && ["./discriminator.js", "./union-validation.js", "./applied-default.js"].includes(name))
          return path(`dist/${name.slice(2)}`);
        if (
          suites.some(
            (suite) =>
              importer === path(`../toolcraft/src/${suite}.test.ts`) && name === `./${suite}.js`
          )
        )
          return ["./package-metadata.js", "./source-snippet.js"].includes(name)
            ? path(`dist/${name.slice(2)}`)
            : path("dist/index.js");
      },
      transform(code, id) {
        if (id !== path("../toolcraft/src/sdk.ts")) return;
        // Keep the reference SDK assembly/invocation while substituting the
        // native argument engine. Parse declarations rather than text patterns.
        const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true);
        const removed = source.statements.filter(statement => ts.isFunctionDeclaration(statement)
          && ["formatSegment", "validateObjectSchema"].includes(statement.name?.text));
        for (const statement of removed.reverse()) code = code.slice(0, statement.getFullStart()) + code.slice(statement.end);
        return `import { formatSegment, validateObjectSchema } from ${JSON.stringify(path("dist/sdk-validation.js"))};\nexport { validateObjectSchema };\n${code}`;
      }
    }
  ],
  test: {
    include: [
      path("tests/package-metadata-parity.test.ts"),
      path("tests/mcp-result-parity.test.ts"),
      path("tests/source-snippet-parity.test.ts"),
      path("tests/runtime-io-parity.test.ts"),
      path("../toolcraft/src/runtime/io.test.ts"),
      ...[...suites, "clone-command-node", "toolcraft", "mcp-result", "stream", "stream-lifecycle", "schema-scope", "schema-scope-exhausted", "schema-member-collisions", "discriminator-validation", "union-validation", "applied-default-validation", "sdk-validation", "sdk-runtime-options"].map((suite) =>
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
