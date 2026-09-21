import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = new URL("./", import.meta.url),
  path = (name) => fileURLToPath(new URL(name, root));
const args = path("../agent-spawn/src/agent-spawn.test.ts"),
  configs = path("../agent-spawn/src/configs/configs.test.ts"),
  types = path("../agent-spawn/src/types.test.ts");
export default defineConfig({
  plugins: [
    {
      name: "rust-spawn-planning-reference",
      enforce: "pre",
      resolveId(name, importer) {
        if (importer === path("../agent-spawn/src/retry.test.ts") && name === "./retry.js")
          return path("dist/retry.js");
        if (importer === path("../agent-spawn/src/parallel.test.ts")) {
          if (name === "./parallel.js") return path("dist/parallel.js");
          if (name === "./spawn.js") return path("tests/parallel-spawn.mjs");
        }
        if (
          [
            path("../agent-spawn/src/run-command.test.ts"),
            path("../agent-spawn/src/run-command.integration.test.ts")
          ].includes(importer) &&
          name === "./run-command.js"
        )
          return path("dist/run-command.js");
        if (importer === types && name === "./types.js") return path("dist/types.js");
        if (importer === configs) {
          if (["./index.js", "./mcp.js", "./resolve-config.js", "../types.js"].includes(name))
            return path("dist/index.js");
          if (name.startsWith("./")) return path("dist/configs/" + name.slice(2));
        }
        if (importer === args) {
          if (["./index.js", "./spawn.js", "./types.js"].includes(name))
            return path("dist/index.js");
          if (name === "./mcp-args.js") return path("dist/mcp-args.js");
          if (name === "./model-utils.js") return path("dist/model-utils.js");
          if (name.startsWith("./configs/"))
            return path("dist/configs/" + name.slice("./configs/".length));
        }
      },
      transform(code, id) {
        if (id !== args) return;
        const ast = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const transformed = ts.transform(ast, [
          (context) => (node) => {
            const visit = (current) => {
              if (
                ts.isExpressionStatement(current) &&
                ts.isCallExpression(current.expression) &&
                ts.isIdentifier(current.expression.expression) &&
                current.expression.expression.text === "describe"
              ) {
                const title = current.expression.arguments[0];
                if (
                  ts.isStringLiteral(title) &&
                  !["buildSpawnArgs", "stripModelNamespace"].includes(title.text)
                )
                  return undefined;
              }
              return ts.visitEachChild(current, visit, context);
            };
            return ts.visitNode(node, visit);
          }
        ]);
        const result = ts.createPrinter().printFile(transformed.transformed[0]);
        transformed.dispose();
        return result;
      }
    }
  ],
  test: {
    include: [
      args,
      configs,
      types,
      path("../agent-spawn/src/retry.test.ts"),
      path("../agent-spawn/src/parallel.test.ts"),
      path("../agent-spawn/src/run-command.test.ts"),
      path("../agent-spawn/src/run-command.integration.test.ts")
    ],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
