import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const execution = dirname(owned);
const surface = dirname(execution);
const raw = join(owned, "raw");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = filename => JSON.parse(readFileSync(filename));
const manifest = json(join(owned, "CAPTURE-MANIFEST.json"));
const observedPaths = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    assert.equal(realpathSync(filename), filename);
    if (entry.isDirectory()) walk(filename);
    else { assert.ok(lstatSync(filename).isFile()); observedPaths.push(relative(raw, filename)); }
  }
}
walk(raw);
assert.deepEqual(observedPaths.sort(), manifest.files.map(entry => entry.path).sort());
for (const entry of manifest.files) {
  const bytes = readFileSync(join(raw, entry.path));
  assert.equal(bytes.length, entry.bytes);
  assert.equal(hash(bytes), entry.sha256, entry.path);
}
for (const [root, filename] of [[surface, "FREEZE-v2.json"], [execution, "RUNNER-FREEZE.json"]]) {
  for (const entry of json(join(root, filename)).files) assert.equal(hash(readFileSync(join(root, entry.path))), entry.sha256, entry.path);
}
const before = json(join(raw, "private-before.json"));
const after = json(join(raw, "private-after.json"));
const stripTime = value => { const { at, ...rest } = value; return rest; };
assert.deepEqual(stripTime(before), stripTime(after));
assert.equal(before.engine.length, 264);
assert.deepEqual(json(join(raw, "inputs-before.json")), json(join(raw, "inputs-after.json")));
const shared = json(join(raw, "shared-guard.json"));
assert.deepEqual(shared.before, shared.after);
const pins = json(join(surface, "PINS.json"));
const cohort = json(join(surface, "CASES.json"));
const journal = json(join(raw, "journal.json"));
assert.deepEqual(journal.counts, { executed: 8, pass: 7, fail: 1, invalid: 0, blocked: 0, conditionalExecuted: 0 });
assert.deepEqual(journal.failures, []);
assert.deepEqual(journal.parentAfter.knownLiveChildren, []);
const importsExpected = json(join(raw, "import-allowlist.json"));
const rows = [];
const outcomes = [];
for (const selected of cohort.cases.filter(entry => !entry.conditional)) {
  const actual = json(join(raw, selected.id, "actual.json"));
  const child = json(join(raw, selected.id, "child.json"));
  const assessment = json(join(raw, selected.id, "assessment.json"));
  assert.equal(actual.runtimeCalls, 1);
  assert.equal(hash(Buffer.from(actual.source.exactText)), selected.source.sha256);
  assert.deepEqual(actual.argv, ["-e", actual.source.exactText, "--", "surface-arg"]);
  assert.equal(child.code, 0);
  assert.equal(child.signal, null);
  assert.equal(child.timedOut, false);
  assert.equal(child.outputExceeded, false);
  assert.equal(child.parentAfter.alive, true);
  assert.deepEqual(actual.hostCounters, { acquired: 1, released: 1, cleanup: 1, childCleanup: 1 });
  assert.deepEqual(actual.hostFindings, []);
  assert.deepEqual(actual.cleanupFailures, []);
  assert.equal(actual.premise.actualMetadata, true);
  assert.equal(actual.premise.metadataSignalSameAsPublicPipe, true);
  assert.deepEqual(actual.premise.operationKeys, pins.api.operationKeys);
  const imports = readFileSync(join(raw, selected.id, "imports.ndjson"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(imports.length, 223);
  for (const entry of imports) assert.equal(entry.sha256, importsExpected[entry.path], entry.path);
  assert.deepEqual(imports.filter(entry => entry.kind === "actual-engine-source-copy").map(entry => entry.path.slice(7)).sort(), pins.privateEngine.staticImportClosure.map(entry => entry.path).sort());
  for (const name of Object.keys(selected.expected.shapeRows ?? {})) rows.push({ id: selected.id, row: name, ...actual.engine.returnValue[name] });
  if (selected.id === "08-function-spread-profile") {
    assert.equal(assessment.outcome, "FAIL");
    assert.deepEqual(assessment.checks.filter(entry => !entry.pass).map(entry => entry.name), ["engine ok", "exact error"]);
    assert.equal(actual.engine, undefined);
    assert.equal(actual.shell.stderr, selected.expected.stderr);
    assert.equal(actual.shell.exitCode, 1);
  } else assert.equal(assessment.outcome, "PASS");
  outcomes.push({ id: selected.id, rawOutcome: assessment.outcome, guestStatus: actual.shell.exitCode, stdout: actual.shell.stdout,
    stderr: actual.shell.stderr, stepsIfCaptured: actual.budgetUsed?.steps ?? null, activeResources: actual.activeResourcesAtResult, activeHandles: actual.activeHandlesAtResult });
}
assert.equal(rows.length, 25);
const types = rows.flatMap(row => row.types);
assert.equal(types.length, 325);
assert.equal(types.filter(([field, type]) => field !== "write" && type === "undefined").length, 300);
assert.equal(types.filter(([field, type]) => field === "write" && type === "function").length, 3);
assert.equal(types.filter(([field, type]) => field === "write" && type === "undefined").length, 22);
process.stdout.write(JSON.stringify({ status: "CAPTURE_INTEGRITY_CONFIRMED_WITH_ORIGINAL_FAIL_RETAINED", rawFiles: manifest.files.length,
  rawBytes: manifest.totalBytes, originalFreezesUnchanged: true, privateUnchanged: true, copiedInputsUnchanged: true,
  selectedSharedTreesUnchanged: true, rows: rows.length, typeofFields: types.length, nonWriteUndefined: 300,
  stdioWriteFunction: 3, otherWriteUndefined: 22, rawCounts: journal.counts,
  qualifiedCounts: { executed: 8, validSupportedSurface: 6, supportedSurfacePass: 6, supportedSurfaceFail: 0,
    matchingDialectProfileOnly: 1, unsupportedOperationInvalidAsDenial: 1, blocked: 0, conditionalExecuted: 0 },
  outcomes, runtimeExecutedByThisCheck: false, knownLiveChildren: [] }, null, 2) + "\n");
