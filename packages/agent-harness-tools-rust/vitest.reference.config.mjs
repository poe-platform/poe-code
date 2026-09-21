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
          id !== path(new URL("run-logs.js", own)) &&
          (!id.startsWith(path(root)) ||
            (!id.endsWith(".test.ts") &&
              !id.endsWith(".spec.ts") &&
              !id.endsWith("test-helpers.ts")))
        )
          return;
        const modules = new Map([
          ["./poe-command-execution.js", "poe-command-execution"],
          ["./run-poe-command.js", "run-poe-command"],
          ["./execution-env.js", "execution-env"],
          ["./log-stream.js", "log-stream"],
          ["./plans.js", "plans"],
          ["./plan-readiness.js", "plan-readiness"],
          ["./run-queue-summary.js", "run-queue-summary"],
          ["@poe-code/task-list", "tasks/index"],
          ["./run-logs.js", "run-logs"],
          ["./paths.js", "paths"],
          ["./participant.js", "participant"],
          ["./hooks.js", "hooks"],
          ["./stage.js", "stage"],
          ["./runner.js", "runner"],
          ["./sequence.js", "sequence"],
          ["./run-queue.js", "run-queue"],
          ["./select-agent.js", "select-agent"],
          ["./skill-config.js", "skill-config"],
          ["./worktree-path.js", "worktree-path"]
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
              // This OS process-group case belongs to manual/integration evidence,
              // not the in-memory unit reference route; it creates disk fixtures.
              if (
                id.endsWith("run-poe-command.test.ts") &&
                ts.isExpressionStatement(node) &&
                ts.isCallExpression(node.expression) &&
                node.expression.arguments.length > 0 &&
                ts.isStringLiteral(node.expression.arguments[0]) &&
                node.expression.arguments[0].text ===
                  "terminates the full wrapped host command process group on inactivity timeout"
              )
                return undefined;
              if (
                ts.isStringLiteral(node) &&
                node.text === "node:fs/promises" &&
                (id.endsWith("run-logs.test.ts") || id === path(new URL("run-logs.js", own)))
              )
                return ts.factory.createStringLiteral(
                  path(new URL("tests/logs-fs.mjs", import.meta.url))
                );
              if (ts.isStringLiteral(node) && modules.has(node.text))
                return ts.factory.createStringLiteral(
                  path(
                    new URL(
                      modules.get(node.text) + (node.text.endsWith(".json") ? "" : ".js"),
                      own
                    )
                  )
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
    include: [
      "poe-command-execution.test.ts",
      "run-poe-command.test.ts",
      "execution-env.test.ts",
      "log-stream.test.ts",
      "plans.test.ts",
      "plans-metadata.test.ts",
      "plan-readiness.test.ts",
      "run-queue-summary.test.ts",
      "run-logs.test.ts",
      "paths.test.ts",
      "participant.test.ts",
      "hooks.test.ts",
      "stage.test.ts",
      "runner.test.ts",
      "sequence.test.ts",
      "run-queue.test.ts",
      "select-agent.test.ts",
      "worktree-path.test.ts"
    ].map((name) => path(new URL(name, root))),
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
