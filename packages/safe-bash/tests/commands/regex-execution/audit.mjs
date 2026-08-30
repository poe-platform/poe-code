import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const base = fileURLToPath(new URL("./", import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const packageEvidence = JSON.parse(await readFile(resolve(base, "package-handoff-evidence.json"), "utf8"));
assert.equal(packageEvidence.pass, true);
const identities = {};
for (const [path, expected] of Object.entries(packageEvidence.sourceHashes)) {
  const actual = hash(await readFile(resolve(root, path)));
  assert.equal(actual, expected, path);
  identities[path] = actual;
}
for (const [path, expected] of Object.entries(packageEvidence.assets)) assert.equal(hash(await readFile(resolve(root, path))), expected, path);
const baseline = JSON.parse(await readFile(resolve(root, "tests/stress/regex-execution/production-review/evidence/baseline-freeze.json"), "utf8"));
for (const identity of baseline.historical) assert.equal(hash(await readFile(resolve(root, identity.path))), identity.sha256, identity.path);
const graph = [];
for (const name of ["worker", "matching", "protocol"]) {
  const path = `src/commands/regex-execution/${name}.ts`;
  const text = await readFile(resolve(root, path), "utf8");
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const imports = [];
  const constructions = [];
  function walk(node) {
    if (ts.isImportDeclaration(node)) imports.push(node.moduleSpecifier.text);
    if (ts.isNewExpression(node) && node.expression.getText(ast) === "RegExp") constructions.push(ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1);
    if (ts.isNewExpression(node)) assert.notEqual(node.expression.getText(ast), "Function");
    if (ts.isCallExpression(node)) {
      assert.notEqual(node.expression.kind, ts.SyntaxKind.ImportKeyword);
      assert(!["eval", "Function", "require", "fetch"].includes(node.expression.getText(ast)));
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  for (const specifier of imports) assert(["node:worker_threads", "node:buffer", "./protocol.js", "./matching.js"].includes(specifier), specifier);
  if (name !== "matching") assert.equal(constructions.length, 0);
  graph.push({ path, imports, dynamicRegExpConstructionLines: constructions });
}
for (const path of ["src/commands/grep.ts", "src/commands/search/matcher.ts", "src/commands/search/rg.ts", "src/commands/regex-execution/client.ts"]) {
  const text = await readFile(resolve(root, path), "utf8");
  assert(!/new\s+RegExp\b|\bRegExp\s*\(/u.test(text), path);
}
const reports = {};
for (const name of ["existing-initial.tap", "executor-initial.tap", "commands-initial.tap", "author-second.tap", "scoped-third.tap", "batch-budget-before.tap", "batch-budget-after.tap", "scoped-final.tap", "early-stop-before.tap", "early-stop-after.tap", "scoped-handoff.tap"]) {
  const bytes = await readFile(resolve(base, name));
  const text = bytes.toString();
  reports[name] = { sha256: hash(bytes), counts: Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(field => [field, Number(text.match(new RegExp(`^# ${field} (\\d+)$`, "m"))?.[1])])) };
}
assert.equal(reports["scoped-handoff.tap"].counts.tests, 730);
assert.equal(reports["scoped-handoff.tap"].counts.pass, 730);
assert.equal(reports["commands-initial.tap"].counts.fail, 1);
assert.equal(reports["batch-budget-before.tap"].counts.fail, 1);
assert.equal(reports["early-stop-before.tap"].counts.fail, 4);
const result = {
  pass: true, sourceCommit: "b1939d7", time: new Date().toISOString(), identities,
  packageArchiveSha256: packageEvidence.archive.sha256,
  immutableHistoricalArtifacts: baseline.historical.length, graph, reports,
  packageWorkers: packageEvidence.consumer.workers.length,
  packageActiveWorkers: packageEvidence.consumer.activeWorkers,
  pathological: { historical: "12 archived, untouched", priorRevisionAuthor: 0, productionAuthor: 0, productionAuthorMaximum: 2, independentMaximum: 4 },
  residualHostRegExp: ["src/commands/search/glob.ts:57 constructor", "src/commands/search/glob.ts:61/64 matches", "src/commands/search/walk.ts CLI/ignore-file call sites"],
  limitations: ["Scoped AST/import audit plus dynamic host-construction tripwire, not a general JS sandbox proof", "Root instructed no edits to glob/walk; broad untrusted-regex/default acceptance remains blocked", "No dangerous baseline or default 1000ms pathological deadline measurement", "Other-owner global typecheck diagnostic retained; scoped types/build pass", "Ignored package artifacts intentionally retained; no unrelated/native artifacts removed"]
};
await writeFile(resolve(base, "audit.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ pass: true, historical: baseline.historical.length, scoped: reports["scoped-handoff.tap"].counts, packageActiveWorkers: result.packageActiveWorkers }));
