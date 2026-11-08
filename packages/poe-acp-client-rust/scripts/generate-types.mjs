// Manual development reference: contracts only, never original implementations.
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
for (const name of [
  "types",
  "index",
  "jsonrpc",
  "jsonrpc-message-layer",
  "acp-transport",
  "acp-client",
  "stream-helpers",
  "run-report"
]) {
  const source = ts.createSourceFile(
    name + ".d.ts",
    readFileSync(new URL("../poe-acp-client/dist/" + name + ".d.ts", root), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const transformed = ts.transform(source, [
    (context) => (node) => {
      const visit = (current) => {
        if (ts.isClassDeclaration(current))
          current = ts.factory.updateClassDeclaration(
            current,
            current.modifiers,
            current.name,
            current.typeParameters,
            current.heritageClauses,
            current.members.filter(
              (member) =>
                !member.modifiers?.some(
                  (modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword
                )
            )
          );
        return ts.visitEachChild(current, visit, context);
      };
      return ts.visitNode(node, visit);
    }
  ]);
  writeFileSync(
    new URL("src/" + name + ".d.ts", root),
    ts.createPrinter().printFile(transformed.transformed[0])
  );
  transformed.dispose();
}
