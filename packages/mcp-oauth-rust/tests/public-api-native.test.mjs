import { test } from "node:test";
import assert from "node:assert/strict";
import * as own from "../dist/index.js";
process.env.TSX_DISABLE_CACHE = "1";
const { tsImport } = await import("tsx/esm/api");
const original = await tsImport("../../mcp-oauth/src/index.ts", import.meta.url);
test("Rust root exports every original public runtime API", () => {
  for (const name of Object.keys(original)) assert.equal(typeof own[name], typeof original[name], `missing public API: ${name}`);
  assert.equal(own.normalizeOAuthScope("write read read"), "read write");
});

test("Rust declarations expose every named original public type", async () => {
  const { readFile } = await import("node:fs/promises"), { default: ts } = await import("typescript");
  const originalSource = ts.createSourceFile("index.ts", await readFile(new URL("../../mcp-oauth/src/index.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const ownSource = ts.createSourceFile("index.d.ts", await readFile(new URL("../dist/index.d.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = new Set(ownSource.statements.filter(node => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)).flatMap(node => node.name ? [node.name.text] : []));
  for (const statement of originalSource.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.isTypeOnly || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    for (const name of statement.exportClause.elements) assert.ok(names.has(name.name.text), `missing public type: ${name.name.text}`);
  }
});
