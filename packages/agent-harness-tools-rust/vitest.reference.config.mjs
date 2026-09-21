import ts from "typescript";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = new URL("../agent-harness-tools/src/", import.meta.url),
  own = new URL("dist/", import.meta.url),
  path = (url) => fileURLToPath(url);
export default defineConfig({
  plugins: [
    {
      name: "own-harness-reference",
      enforce: "pre",
      transform(code, id) {
        if (
          !id.startsWith(path(root)) ||
          (!id.endsWith(".test.ts") && !id.endsWith(".spec.ts") && !id.endsWith("test-helpers.ts"))
        )
          return;
        const modules = new Map([["./paths.js", "paths"], ["./participant.js", "participant"], ["./hooks.js", "hooks"], ["./stage.js", "stage"], ["./runner.js", "runner"], ["./sequence.js", "sequence"], ["./run-queue.js", "run-queue"], ["./select-agent.js", "select-agent"], ["./skill-config.js", "skill-config"], ["./worktree-path.js", "worktree-path"]]);
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
                  path(new URL(modules.get(node.text) + (node.text.endsWith(".json") ? "" : ".js"), own))
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
    globals: true,
    include: ["paths.test.ts", "participant.test.ts", "hooks.test.ts", "stage.test.ts", "runner.test.ts", "sequence.test.ts", "run-queue.test.ts", "select-agent.test.ts", "worktree-path.test.ts"]
    .map((name) => path(new URL(name, root))),
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
