import { defineConfig } from "vitest/config";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
const referenceRoot = fileURLToPath(new URL("../tiny-mcp-client/src/", import.meta.url));
const redirects = new Map([
  ["index.js", "index.js"],
  ["internal.js", "index.js"],
  ["oauth-discovery.js", "oauth-discovery.js"],
  ["http-response.js", "oauth/http.js"]
].map(([original, native]) => [fileURLToPath(new URL(original, new URL("../tiny-mcp-client/src/", import.meta.url))), fileURLToPath(new URL(native, new URL("./dist/", import.meta.url)))]));
function redirect(source: string, importer: string) {
  if (source === "mcp-oauth" && importer.startsWith(referenceRoot)) return fileURLToPath(new URL("./dist/oauth/index.js", import.meta.url));
  if (!source.startsWith(".") || !importer.startsWith(referenceRoot)) return;
  return redirects.get(fileURLToPath(new URL(source, pathToFileURL(importer))));
}
export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  plugins: [{ name: "rust-client-reference-contract", enforce: "pre",
    resolveId(source, importer) { if (importer !== undefined) return redirect(source, importer); },
    transform(code, id) {
      if (!id.startsWith(referenceRoot) || !id.endsWith(".test.ts")) return;
      const parsed = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const checks: string[] = [];
      for (const statement of parsed.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const target = redirect(statement.moduleSpecifier.text, id);
        const clause = statement.importClause;
        if (target === undefined || clause === undefined || clause.isTypeOnly || clause.namedBindings === undefined || !ts.isNamedImports(clause.namedBindings)) continue;
        for (const element of clause.namedBindings.elements) {
          if (element.isTypeOnly) continue;
          const alias = `nativeContractBinding${checks.length}`;
          checks.push(`import { ${(element.propertyName ?? element.name).text} as ${alias} } from ${JSON.stringify(target)};\nif (${element.name.text} !== ${alias}) throw new Error("Client reference contracts must execute the Rust package");`);
        }
      }
      if (checks.length === 0) throw new Error(`Reference test has no verified Rust import: ${id}`);
      return { code: code + "\n" + checks.join("\n"), map: null };
    }
  }],
  test: { include: ["packages/tiny-mcp-client/src/*.test.ts"], exclude: [
    "**/mcp-client-sdk.test.ts", "**/mock-servers.test.ts", "**/package-runtime.test.ts",
    "**/utilities.test.ts", "**/transports.test.ts", "**/sse-framing.test.ts", "**/sse-limits.test.ts", "**/stdio-line-bounds.test.ts"
  ], cache: false, testTimeout: 2000 }
});
