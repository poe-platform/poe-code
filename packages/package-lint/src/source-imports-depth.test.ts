import { expect, it } from "vitest";
import { extractRelevantImports } from "./source-imports.js";

it("finds imports in source order across deeply nested minified expressions", () => {
  const source = `import "first"; const value = (require("deep"),${"0,".repeat(20_000)}import("last"));`;
  expect(extractRelevantImports(source, "bundle.js")).toEqual([
    { specifier: "first", typeOnly: false, importAttributes: false },
    { specifier: "deep", typeOnly: false, importAttributes: false },
    { specifier: "last", typeOnly: false, importAttributes: false }
  ]);
});
