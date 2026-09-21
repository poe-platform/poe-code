import ts from "typescript";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = new URL("../task-list/src/", import.meta.url),
  own = new URL("dist/", import.meta.url),
  path = (url) => fileURLToPath(url);
export default defineConfig({
  plugins: [
    {
      name: "own-task-state-reference",
      enforce: "pre",
      transform(code, id) {
        if (!id.startsWith(path(root)) || !id.endsWith(".test.ts")) return;
        const modules = new Map([
          ["./state.js", "state"],
          ["./state-machine.js", "state-machine"],
          ["./types.js", "types"],
          ["../types.js", "types"],
          ["./utils.js", "backends/utils"]
        ]);
        const source = ts.createSourceFile(
          id,
          code,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS
        );
        const result = ts.transform(source, [
          (context) => (root) =>
            ts.visitNode(root, function visit(node) {
              if (ts.isStringLiteral(node) && modules.has(node.text))
                return ts.factory.createStringLiteral(
                  path(new URL(modules.get(node.text) + ".js", own))
                );
              return ts.visitEachChild(node, visit, context);
            })
        ]);
        try {
          return { code: ts.createPrinter().printFile(result.transformed[0]), map: null };
        } finally {
          result.dispose();
        }
      }
    }
  ],
  test: {
    include: ["state.test.ts", "state-machine.test.ts", "backends/utils.test.ts"].map((name) =>
      path(new URL(name, root))
    ),
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
