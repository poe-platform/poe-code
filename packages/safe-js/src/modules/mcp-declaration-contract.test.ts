import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

it("emits the MCP host contract without a private runtime dependency", () => {
  const fileName = new URL("./mcp-transport.ts", import.meta.url).pathname;
  const { outputText, diagnostics } = ts.transpileDeclaration(readFileSync(fileName, "utf8"), {
    fileName, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext }
  });
  expect(diagnostics).toEqual([]);
  const declaration = ts.createSourceFile("mcp-transport.d.ts", outputText, ts.ScriptTarget.Latest, true);
  const imports = declaration.statements.filter(ts.isImportDeclaration)
    .map(statement => (statement.moduleSpecifier as ts.StringLiteral).text);
  expect(imports).not.toContain("tiny-mcp-client");
});
