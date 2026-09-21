import ts from "typescript";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = new URL("./", import.meta.url),
  path = (name) => fileURLToPath(new URL(name, root));
const providers = path("../poe-agent/src/runtime/resolve-provider.test.ts"),
  names = path("../poe-agent/src/runtime/tool-names.test.ts");
export default defineConfig({
  plugins: [
    {
      name: "rust-agent-runtime-reference",
      enforce: "pre",
      transform(code, id) {
        if (id !== path("../poe-agent/src/runtime/runtime.test.ts")) return;
        const source = ts.createSourceFile(
          id,
          code,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS
        );
        const selected = new Set([
          "runtime errors",
          "normalizeTool",
          "ToolRegistry",
          "runtime/config"
        ]);
        const ranges = source.statements
          .filter(
            (statement) =>
              ts.isExpressionStatement(statement) &&
              ts.isCallExpression(statement.expression) &&
              statement.expression.expression.getText(source) === "describe" &&
              ts.isStringLiteral(statement.expression.arguments[0]) &&
              !selected.has(statement.expression.arguments[0].text)
          )
          .map((statement) => [statement.getFullStart(), statement.end]);
        let output = code;
        for (const [start, end] of ranges.reverse())
          output =
            output.slice(0, start) +
            [...output.slice(start, end)].map((char) => (char === "\n" ? char : " ")).join("") +
            output.slice(end);
        return { code: output, map: null };
      },
      resolveId(name, importer) {
        if (importer === path("../poe-agent/src/runtime/runtime.test.ts")) {
          if (name === "./config.js") return path("dist/config.js");
          if (name === "./tools.js") return path("dist/tools.js");
          if (name === "./errors.js") return path("dist/errors.js");
          if (name === "./tool-names.js") return path("dist/tool-names.js");
        }
        if (
          importer === path("../poe-agent/src/runtime/file-awareness.test.ts") &&
          name === "./file-awareness.js"
        )
          return path("dist/file-awareness.js");
        if (importer === providers && name === "./resolve-provider.js")
          return path("dist/providers.js");
        if (
          importer === path("../poe-agent/src/session-store.test.ts") &&
          name === "./session-store.js"
        )
          return path("dist/session-store.js");
        if (
          importer === path("../poe-agent/src/runtime/session/session-store.test.ts") &&
          name === "./session-store.js"
        )
          return path("dist/session-log.js");
        if (importer === names && name === "./tool-names.js") return path("dist/tool-names.js");
      }
    }
  ],
  test: {
    include: [
      providers,
      path("../poe-agent/src/runtime/file-awareness.test.ts"),
      names,
      path("../poe-agent/src/session-store.test.ts"),
      path("../poe-agent/src/runtime/session/session-store.test.ts"),
      path("../poe-agent/src/runtime/runtime.test.ts")
    ],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
