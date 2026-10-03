import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

it("uses only the canonical filesystem contract in public declarations", () => {
  const source = readFileSync(new URL("./ast.ts", import.meta.url), "utf8");
  const declaration = ts.transpileDeclaration(source, {
    compilerOptions: { module: ts.ModuleKind.NodeNext },
    fileName: "ast.ts",
  }).outputText;
  // The public packager rewrites this canonical contract into the shipped closure.
  expect(ts.preProcessFile(declaration, true, true).importedFiles.map(file => file.fileName)).toEqual(["@poe-code/safe-fs/contracts"]);
});
