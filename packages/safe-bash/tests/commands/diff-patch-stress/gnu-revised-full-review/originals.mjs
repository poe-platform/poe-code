import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const repository = process.cwd();
assert.equal(repository, "/Users/kjopek/Workspace/safe-bash");
const owned = dirname(fileURLToPath(import.meta.url));
const prefix = "tests/commands/diff-patch-stress/";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function historical(path, commit = "4d4f5ca") {
  const result = spawnSync("git", ["show", `${commit}:${path}`], { cwd: repository, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}
const manifestPath = `${prefix}gnu-revised-acceptance/original-manifest.json`;
const manifestBytes = historical(manifestPath, "c623665");
assert.equal(digest(readFileSync(manifestPath)), digest(manifestBytes));
const manifest = JSON.parse(manifestBytes);
const entries = Object.fromEntries(Object.entries(manifest.originalFiles).filter(([path]) => path.startsWith("tests/")));
assert.equal(Object.keys(entries).length, 237);
for (const [path, hash] of Object.entries(entries)) {
  assert.equal(digest(readFileSync(path)), hash, `live original bytes: ${path}`);
  assert.equal(digest(historical(path)), hash, `Git original bytes: ${path}`);
}
const testFiles = ["tests/commands/diff-patch", "tests/commands/diff-patch-stress"].flatMap(root => readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith(".test.ts")).map(entry => join(entry.parentPath, entry.name))).sort();
assert.deepEqual(testFiles, manifest.original3758.testFiles);
assert.equal(testFiles.length, 70);
function parse(path) {
  return ts.createSourceFile(path, historical(path).toString(), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function evaluate(text, names) {
  const source = ts.transpileModule(text.replace(/\bexport\s+/gu, ""), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText;
  return vm.runInNewContext(`${source}\nJSON.stringify({${names.join(",")}})`, {}, { timeout: 1000 });
}
function functionText(path, names) {
  const source = parse(path);
  const functions = source.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text));
  assert.equal(functions.length, names.length);
  return functions.map(statement => statement.getText(source)).join("\n");
}
const helperFunctions = functionText(`${prefix}fuzz/helpers.ts`, ["lines", "body", "golden"]);
const first = JSON.parse(evaluate(`${helperFunctions}\nconst result = golden("keep\\n", "changed\\n", "first");`, ["result"])).result;
const fixtureFunctions = functionText(`${prefix}editflows/fixtures.ts`, ["replacement"]);
const quotedInput = JSON.parse(evaluate(`${fixtureFunctions}\nconst result = replacement("first") + replacement('"alias/target"');`, ["result"])).result;
const editsSource = parse(`${prefix}fuzz/edits.test.ts`);
const malformed = editsSource.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations]).find(declaration => declaration.name.getText(editsSource) === "malformed");
assert(malformed?.initializer && ts.isObjectLiteralExpression(malformed.initializer));
const brokenInputs = Object.fromEntries(malformed.initializer.properties.map(property => {
  assert(ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name) && ts.isStringLiteral(property.initializer));
  return [property.name.text, property.initializer.text];
}));
const vectors = JSON.parse(evaluate(historical(`${prefix}emptyfile-delta/vectors.ts`).toString(), ["vectors"])).vectors;
const selected = vectors.filter(vector => vector.status === 0 && vector.expected === null && !vector.args.includes("--dry-run") && vector.args.includes("/authorized/target"));
assert.equal(selected.length, 6);
const observations = JSON.parse(readFileSync(join(owned, "native-preparation.json"))).observations.filter(item => item.dialect === "gnu");
assert.equal(observations[0].fixture.input, quotedInput);
assert.equal(observations[1].fixture.input, `${first}--- target\n+++ target\n${brokenInputs["backward-second-hunk"]}`);
for (const vector of selected) {
  const captured = observations.find(item => item.fixture.name === `GNU default: ${vector.name}`);
  assert(captured);
  assert.equal(captured.fixture.input, vector.input);
  assert.deepEqual(captured.fixture.args, vector.args.map(value => value === "/authorized/target" ? "/fixture/authorized/target" : value));
}
assert.equal(observations[8].fixture.input, `${first}--- target\n+++ target\n${brokenInputs["missing-new-body"]}`);
const inspectedPaths = ["editflows/quoted-safety.test.ts", "fuzz/edits.test.ts", "emptyfile-delta/emptyfile.test.ts"].map(path => prefix + path);
const tokenEvidence = Object.fromEntries(inspectedPaths.map(path => {
  const source = parse(path);
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source.text);
  const tokens = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) tokens.push([ts.SyntaxKind[kind], scanner.getTokenText()]);
  return [path, { sha256: digest(source.text), tokenSha256: digest(JSON.stringify(tokens)), tokenCount: tokens.length }];
}));
const result = { author: "independent reviewer", checkedAt: new Date().toISOString(), originalCommit: "4d4f5ca", manifestCommit: "c623665", manifestSha256: digest(manifestBytes), original237: entries, original70: testFiles, tokenEvidence, nativeOriginalInputMatches: 8, malformedControlMatches: 1, fixtureDerivation: "TypeScript AST extracts original pure fixture functions/data; bounded VM evaluates only those original functions and vectors, never the test callbacks/product/expectation editor outputs.", sourceEvidence: ["src/commands/diff-patch/patch.ts:236 atomic conflict exit1 before publication", "src/commands/diff-patch/patch-gnu-paths.ts:179 empty-only rmdir/no recursive fallback"], finalDeltaAudit: false, fullCohortExecuted: false };
writeFileSync(join(owned, "original-identities.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ original237: Object.keys(entries).length, original70: testFiles.length, originalNativeInputMatches: 8, finalDeltaAudit: false }));
