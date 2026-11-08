import ts from "typescript";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
const root = new URL("../providers/src/", import.meta.url),
  own = new URL("dist/", import.meta.url),
  path = (url) => fileURLToPath(url);
export default defineConfig({
  plugins: [
    {
      name: "own-provider-reference",
      enforce: "pre",
      transform(code, id) {
        if (!id.startsWith(path(root)) || !id.endsWith(".test.ts")) return;
        const modules = new Map([
          ["./index.js", "index"],
          ["./registry.js", "registry"],
          ["./provider-order.js", "provider-order"],
          ["./compatibility.js", "compatibility"],
          ["./types.js", "types"],
          ["../types.js", "types"],
          ["./api-key.js", "api-key"]
        ]);
        for (const name of ["poe", "anthropic", "openai", "cloudflare"]) {
          modules.set("./providers/" + name + ".js", "providers/" + name);
          modules.set("./" + name + ".js", "providers/" + name);
        }
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
    include: [path(new URL("**/*.test.ts", root))],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 3000,
    cache: false
  }
});
