import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { changes, digest } from "../gnu-revised-full/delta-v1.mjs";

const owned = dirname(fileURLToPath(import.meta.url));
const marker = readFileSync("/tmp/safe-bash-diff-revised-full-editor.closed", "utf8");
assert(marker.includes("ROOT RELEASE") && marker.includes("5ddce1b"));
const editorCommit = "5ddce1b0550ad7de8f2a8082f0402fae7aa001b7";
function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const editorPaths = git(["ls-tree", "-r", "--name-only", editorCommit, "--", "tests/commands/diff-patch-stress/gnu-revised-full"]).trim().split("\n");
const editorHashes = Object.fromEntries(editorPaths.map(path => {
  const bytes = readFileSync(path);
  assert.equal(digest(bytes), digest(git(["show", `${editorCommit}:${path}`])), path);
  return [path, digest(bytes)];
}));
assert.equal(editorPaths.length, 11);
const native = JSON.parse(readFileSync(join(owned, "native-preparation.json")));
const expectedNames = native.observations.filter(item => item.dialect === "gnu").slice(0, 8).map(item => item.fixture.name).sort();
assert.deepEqual(changes.flatMap(change => change.names).sort(), expectedNames);
assert.deepEqual(changes.map(change => change.file).sort(), ["editflows/quoted-safety.test.ts", "emptyfile-delta/emptyfile.test.ts", "fuzz/edits.test.ts"].map(path => `tests/commands/diff-patch-stress/${path}`).sort());
function tokens(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const result = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) result.push([kind, scanner.getTokenText()]);
  return result;
}
function mask(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.equal(source.parseDiagnostics.length, 0);
  const quoted = file.includes("quoted-safety");
  const fuzz = file.includes("fuzz/");
  const start = text.indexOf(quoted ? "for (const [name, quoted, linkTarget, linkPath]" : fuzz ? "for (const [name, broken]" : "for (const vector of vectors)");
  assert(start >= 0);
  const stop = quoted ? text.length : text.indexOf(fuzz ? "for (const atomic of" : "for (const format of formats)", start);
  assert(stop > start);
  const spans = [];
  function visit(node) {
    if (node.getStart(source) >= start && node.end <= stop) {
      if (ts.isCallExpression(node) && ["assert.equal", "assert.deepEqual"].includes(node.expression.getText(source))) {
        const actual = node.arguments[0]?.getText(source);
        const allowed = quoted ? ["result.status", "result.stdout", "await fileBytes(filesystem, Object.keys(files))"]
          : fuzz ? ["result.exitCode"] : ["observed.mutations.map(({ method, path }) => ({ method, path }))"];
        if (allowed.includes(actual)) {
          assert(node.arguments[1]);
          spans.push({ start: node.arguments[1].getStart(source), end: node.arguments[1].end, kind: "assertion-expected-value", actual, text: node.arguments[1].getText(source) });
        }
      }
      if (!quoted && !fuzz && ts.isIfStatement(node) && node.expression.getText(source) === "prunedParent") spans.push({ start: node.getStart(source), end: node.end, kind: "expected-namespace-only", text: node.getText(source) });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(spans.length, quoted ? 3 : fuzz ? 1 : 2);
  let masked = text;
  for (const span of spans.sort((left, right) => right.start - left.start)) masked = masked.slice(0, span.start) + "REVIEW_EXPECTATION" + masked.slice(span.end);
  return { spans, tokens: tokens(masked) };
}
function evaluate(expression, bindings) {
  return JSON.parse(vm.runInNewContext(`JSON.stringify(${expression})`, { Buffer, expectedBytes: files => Object.fromEntries(Object.entries(files).map(([path, text]) => [path, Buffer.from(text)])), ...bindings }, { timeout: 1000 }));
}
mkdirSync(join(owned, ".work"), { recursive: true });
const scratch = mkdtempSync(join(owned, ".work/audit-"));
const records = [];
let diff = "";
for (const change of changes) {
  const before = git(["show", `4d4f5ca:${change.file}`]);
  assert.equal(readFileSync(change.file, "utf8"), before);
  assert.equal(before.split(change.before).length, 2);
  const after = before.replace(change.before, change.after);
  const original = mask(before, change.file);
  const revised = mask(after, change.file);
  assert.deepEqual(revised.tokens, original.tokens, `non-expectation token changed: ${change.file}`);
  const assertions = revised.spans.filter(span => span.kind === "assertion-expected-value");
  if (change.file.includes("quoted-safety")) {
    const files = { first: "old\n", target: "old\n", "dir/target": "old\n" };
    for (const name of ["quoted final symlink", "quoted ancestor symlink"]) {
      const ancestor = name === "quoted ancestor symlink";
      assert.equal(evaluate(assertions.find(span => span.actual === "result.status").text, { name }), ancestor ? 0 : 2);
      assert.deepEqual(evaluate(assertions.find(span => span.actual === "result.stdout").text, { name }), JSON.parse(JSON.stringify(Buffer.from(ancestor ? "patching file first\npatching file target\n" : ""))));
      assert.deepEqual(evaluate(assertions.find(span => span.actual.startsWith("await fileBytes")).text, { name, files }), evaluate("expectedBytes(files)", { files: ancestor ? { ...files, first: "new\n", target: "new\n" } : files }));
    }
  } else if (change.file.includes("fuzz/")) {
    const names = [...before.matchAll(/^  "([^"]+)":/gmu)].map(match => match[1]);
    assert.equal(names.length, 17);
    for (const name of names) assert.equal(evaluate(assertions[0].text, { name }), name === "backward-second-hunk" ? 1 : 2);
  } else {
    const namespace = revised.spans.find(span => span.kind === "expected-namespace-only").text;
    assert.deepEqual(tokens(namespace), tokens('if (prunedParent) { delete before["/authorized"]; const root = before["/"]; assert(root !== null && typeof root === "object" && "nlink" in root && typeof root.nlink === "number"); root.nlink -= 1; }'));
    for (const prunedParent of [false, true]) {
      const before = { "/": { nlink: 4 }, "/authorized": { nlink: 2 } };
      vm.runInNewContext(namespace, { before, prunedParent, assert }, { timeout: 1000 });
      assert.deepEqual(before, prunedParent ? { "/": { nlink: 3 } } : { "/": { nlink: 4 }, "/authorized": { nlink: 2 } });
    }
    assert.deepEqual(tokens(assertions[0].text), tokens('[{ method: vector.expected === null ? "rm" : "writeFile", path: target(vector) }]'));
  }
  const beforePath = join(scratch, "original.txt");
  const afterPath = join(scratch, "revised.txt");
  writeFileSync(beforePath, before);
  writeFileSync(afterPath, after);
  const compared = spawnSync("git", ["diff", "--no-index", "--", beforePath, afterPath], { encoding: "utf8" });
  assert.equal(compared.status, 1);
  diff += `\nOriginal/revised logical path: ${change.file}\n${compared.stdout}`;
  records.push({ file: change.file, names: change.names, originalSha256: digest(before), revisedSha256: digest(after), residualTokenSha256: digest(JSON.stringify(original.tokens)), residualTokenCount: original.tokens.length, beforeExpectations: original.spans, afterExpectations: revised.spans, unchangedOutsideAllowedExpectedNodes: true });
}
rmSync(scratch, { recursive: true });
writeFileSync(join(owned, "delta-reviewed.diff"), diff);
writeFileSync(join(owned, "delta-audit.json"), JSON.stringify({ author: "independent reviewer72352, not expectation editor93986", checkedAt: new Date().toISOString(), editorCommit, editorHashes, marker, markerSha256: digest(marker), originalBasis: "4d4f5ca/c623665", changedFiles: 3, changedNamedTests: expectedNames, records, expectedValuesIndependentlyEvaluated: true, fixturesOptionsHelpersSourceAndCensusTokensUnchanged: true, fullBeforeAfterDiffSha256: digest(diff), nativeProofSha256: digest(readFileSync(join(owned, "native-preparation.json"))), limitation: "Tokens outside the six AST-selected expected-value/expected-namespace sites must be byte-token equal; all new expected expressions independently checked. Original observer excludes rmdir; separate frozen product probe must assert actual rm(file),rmdir(parent)." }, null, 2) + "\n");
console.log(JSON.stringify({ changedFiles: 3, namedTests: expectedNames.length, expectedOnlyASTSites: 6, residualTokensIdentical: true }));
