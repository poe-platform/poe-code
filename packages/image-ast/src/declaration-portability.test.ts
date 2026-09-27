import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

it("emits self-contained public filesystem declarations", () => {
  const source = readFileSync(new URL("./ast.ts", import.meta.url), "utf8");
  const declaration = ts.transpileDeclaration(source, {
    compilerOptions: { module: ts.ModuleKind.NodeNext },
    fileName: "ast.ts",
  }).outputText;
  // This declaration is shared by the Node and browser exports. Consumers must
  // resolve it without access to any unpublished workspace package.
  expect(ts.preProcessFile(declaration, true, true).importedFiles).toEqual([]);
});
