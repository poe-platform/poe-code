import ts from "typescript";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = new URL("../poe-code-config/src/", import.meta.url),
  own = new URL("dist/", import.meta.url),
  path = (url) => fileURLToPath(url);
export default defineConfig({
  plugins: [
    {
      name: "own-config-reference",
      enforce: "pre",
      transform(code, id) {
        if (
          !id.startsWith(path(root)) ||
          (!id.endsWith(".test.ts") && !id.endsWith(".spec.ts") && !id.endsWith("test-helpers.ts"))
        )
          return;
        const modules = new Map([
          ["./schema-compiler.js","compile/schema-compiler"], ["../core.js","core"], ["../index.js","index"], ["../../../../src/config.js","index"],
          ["./configured-services.js", "configured-services"], ["./config.js", "config"], ["./jobs.js", "state/jobs"], ["./templates.js", "state/templates"], ["./index.js", id.endsWith("/state/state.test.ts")?"state/index":"index"],
          ["./inspect.js", "inspect"], ["./merge.js", "merge"],
          ["./resolve.js", "resolve"], ["./schema.js", "schema"],
          ["./store.js", "store"], ["./runtime.js", "runtime"],
          ["./memory.js", "memory"], ["./merge-callbacks.js", "merge-callbacks"],
          ["./provider-config.js", "provider-config"]
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
    include: ["compile/schema-compiler.test.ts", "configured-services.test.ts", "state/state.test.ts", "poe-code-config.test.ts", "runtime.test.ts", "memory.test.ts", "merge-callbacks.test.ts", "provider-config.test.ts"
    ].map((name) => path(new URL(name, root))),
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
