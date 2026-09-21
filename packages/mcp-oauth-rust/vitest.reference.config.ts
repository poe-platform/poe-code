import { defineConfig } from "vitest/config";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const referenceRoot = fileURLToPath(new URL("../mcp-oauth/src/", import.meta.url));
const redirects = new Map(
  [
    ["index.js", "index.js"],
    ["http-fetch.js", "http.js"],
    ["http-response.js", "http.js"],
    ["resource-indicator.js", "resource.js"],
    ["client/default-oauth-client-provider.js", "provider.js"],
    ["client/auth-store-session-store.js", "session-store.js"],
    ["client/loopback-authorization.js", "loopback.js"],
    ["client/token-endpoint.js", "tokens.js"],
    ["client/token-grant.js", "token-grant.js"],
    ["client/authorization-state.js", "state.js"],
    ["client/pkce.js", "pkce.js"],
    ["client/scope.js", "scope.js"],
    ["client/client-registration.js", "registration.js"],
    ["client/session-transaction.js", "transaction.js"],
    ["server/jwks-token-verifier.js", "jwks.js"]
  ].map(([original, native]) => [
    fileURLToPath(new URL(original, new URL("../mcp-oauth/src/", import.meta.url))),
    fileURLToPath(new URL(native, new URL("./dist/", import.meta.url)))
  ])
);
function redirect(source: string, importer: string) {
  if (!source.startsWith(".") || !importer.startsWith(referenceRoot)) return;
  return redirects.get(fileURLToPath(new URL(source, pathToFileURL(importer))));
}
export default defineConfig({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  plugins: [
    {
      name: "rust-oauth-reference-contract",
      enforce: "pre",
      resolveId(source, importer) {
        if (importer !== undefined) return redirect(source, importer);
      },
      transform(code, id) {
        if (!id.startsWith(referenceRoot) || !id.endsWith(".test.ts")) return;
        const parsed = ts.createSourceFile(
          id,
          code,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TS
        );
        const checks: string[] = [];
        for (const statement of parsed.statements) {
          if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
            continue;
          const target = redirect(statement.moduleSpecifier.text, id);
          const clause = statement.importClause;
          if (
            target === undefined ||
            clause === undefined ||
            clause.isTypeOnly ||
            clause.namedBindings === undefined ||
            !ts.isNamedImports(clause.namedBindings)
          )
            continue;
          for (const element of clause.namedBindings.elements) {
            if (element.isTypeOnly) continue;
            const alias = `nativeContractBinding${checks.length}`;
            checks.push(
              `import { ${(element.propertyName ?? element.name).text} as ${alias} } from ${JSON.stringify(target)};\nif (${element.name.text} !== ${alias}) throw new Error("OAuth reference contracts must execute the Rust package");`
            );
          }
        }
        if (checks.length === 0)
          throw new Error(`Reference test has no verified Rust import: ${id}`);
        return { code: code + "\n" + checks.join("\n"), map: null };
      }
    }
  ],
  test: {
    include: ["packages/mcp-oauth/src/**/*.test.ts"],
    cache: false,
    testTimeout: 2000
  }
});
