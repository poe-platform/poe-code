import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import ts from "typescript";
import { canonicalFsExports, canonicalFsTypeImports } from "../packages/package-lint/src/bundle-policy.js";

function manifest(file: string) {
  return JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
}
function resolve(value: any, conditions: string[]): any {
  if (value === null || typeof value === "string") return value;
  for (const [key, target] of Object.entries(value ?? {})) {
    if (key === "default" || conditions.includes(key)) return resolve(target, conditions);
  }
}
const root = manifest("../package.json");
it.each(["./safe-fs", "./safe-fs/core"])("resolves %s to the portable publisher under workerd", route => {
  const entry = root.exports[route];
  expect(resolve(entry, ["workerd", "worker", "import"])).toBe(entry.browser);
  expect(resolve(entry, ["types", "workerd", "import"])).toBe(entry.types.browser);
  expect(entry).toEqual(canonicalFsExports[route]);
});
it.each(["./safe-js", "./safe-js/core", "./safejs", "./safejs/core", "./safe-js/workerd"])("resolves %s to the workerd runtime and declarations", route => {
  expect(resolve(root.exports[route], ["workerd", "worker", "import"])).toBe("./packages/safe-js/dist/workerd.js");
  expect(resolve(root.exports[route], ["types", "workerd", "import"])).toBe("./dist/types/safe-js/workerd.d.ts");
});
it("selects portable filesystem platform declarations under workerd", () => {
  expect(resolve(canonicalFsTypeImports["#safe-fs-platform"], ["types", "workerd", "import"])).toBe("./dist/types/safe-fs/platform/browser.d.ts");
});
it.each(["./contracts", "./contracts/index", "./contracts/path", "./commands/op", "./commands/docx", "./commands/python", "./commands/python/worker", "./commands/playwright", "./playwright"])("keeps portable safe-bash route %s ahead of import", route => {
  const entry = manifest("../packages/safe-bash/package.json").exports[route];
  expect(resolve(entry, ["workerd", "worker", "import"])).toBe(entry.browser);
  expect(resolve(entry, ["browser", "import"])).toBe(entry.browser);
});
it.each(["safe-fs", "safe-js"])("keeps the %s workspace root portable", name => {
  const entry = manifest("../packages/" + name + "/package.json").exports["."];
  expect(resolve(entry, ["workerd", "import"])).toBe(name === "safe-fs" ? "./dist/core.js" : "./dist/workerd.js");
  expect(resolve(entry, ["browser", "import"])).toBe("./dist/core.js");
});
it("exports optional Shell and agentCommands from the portable core", () => {
  const source = ts.createSourceFile("optional.ts", readFileSync(new URL("../packages/safe-bash/src/optional.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const entry = source.statements.find(statement => ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.some(element => element.name.text === "Shell")) as ts.ExportDeclaration;
  expect((entry.moduleSpecifier as ts.StringLiteral).text).toBe("./core.js");
});
it("includes the workerd bundle in the root published files", () => {
  expect(root.files).toContain("packages/safe-js/dist/workerd.js");
});
