import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const version = dirname(owned);
const repository = resolve(version, "../../../../..");
const raw = join(owned, "raw");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function regular(filename) {
  assert.equal(realpathSync(filename), filename);
  assert.ok(lstatSync(filename).isFile());
  return readFileSync(filename);
}
const json = filename => JSON.parse(regular(filename));
const manifest = json(join(owned, "CAPTURE-MANIFEST.json"));
for (const entry of manifest.files) {
  const bytes = regular(join(raw, entry.path));
  assert.equal(bytes.length, entry.bytes);
  assert.equal(hash(bytes), entry.sha256, entry.path);
  assert.deepEqual(bytes, regular(join(manifest.rawRoot, entry.path)));
}
function inventory(root) {
  const entries = [];
  function visit(directory) {
    assert.equal(realpathSync(directory), directory);
    for (const name of readdirSync(directory).sort()) {
      const filename = join(directory, name);
      const stat = lstatSync(filename);
      assert.ok(!stat.isSymbolicLink());
      if (stat.isDirectory()) visit(filename);
      else {
        const bytes = regular(filename);
        entries.push({ path: relative(root, filename), bytes: bytes.length, sha256: hash(bytes),
          mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs });
      }
    }
  }
  visit(root);
  return entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}
const rawPaths = inventory(raw).map(entry => entry.path);
assert.deepEqual(rawPaths, manifest.files.map(entry => entry.path));
const before = json(join(raw, "inputs-before.json"));
const after = json(join(raw, "inputs-after.json"));
assert.deepEqual(after, before);
for (const [root, entries] of Object.entries(after)) assert.deepEqual(inventory(root), entries);
const { at: privateBeforeTime, ...privateBefore } = json(join(raw, "private-before.json"));
const { at: privateAfterTime, ...privateAfter } = json(join(raw, "private-after.json"));
assert.deepEqual(privateAfter, privateBefore);
assert.equal(privateBefore.head, "bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e");
assert.equal(privateBefore.engine.length, 264);
const pins = json(join(version, "PINS.json"));
assert.equal(hash(regular(join(manifest.task, "loader.mjs"))), pins.tooling.loader.sha256);
const journal = json(join(raw, "journal.json"));
assert.equal(journal.runnerCommit, manifest.freezeCommit);
assert.equal(journal.status, "EXECUTION_SETTLED");
assert.deepEqual(journal.failures, []);
assert.equal(journal.privateUnchanged, true);
assert.equal(journal.inputTreesUnchanged, true);
assert.equal(journal.sharedTreesUnchanged, true);
assert.deepEqual(journal.parentAfter.knownLiveChildren, []);
assert.equal(journal.children.length, 8);
const allowlist = json(join(raw, "import-allowlist.json"));
const cases = json(join(version, "CASES.json")).cases.filter(entry => !entry.conditional);
const observations = [];
for (const selected of cases) {
  const actual = json(join(raw, selected.id, "actual.json"));
  const child = json(join(raw, selected.id, "child.json"));
  const assessment = json(join(raw, selected.id, "assessment.json"));
  assert.equal(child.code, 0);
  assert.equal(child.signal, null);
  assert.equal(child.timedOut, false);
  assert.equal(child.outputExceeded, false);
  assert.ok(child.closed && child.parentAfter.alive);
  assert.deepEqual(child.parentAfter.knownLiveChildren, []);
  assert.equal(assessment.outcome, "PASS");
  assert.ok(assessment.checks.every(entry => entry.pass));
  assert.equal(actual.runtimeCalls, 1);
  assert.equal(actual.premise.actualMetadata, true);
  assert.equal(actual.premise.rawGrantToGuest, false);
  assert.deepEqual(actual.hostCounters, selected.expected.hostCounters);
  assert.deepEqual(actual.hostFindings, []);
  assert.deepEqual(actual.cleanupFailures, []);
  assert.equal(actual.shell.exitCode, selected.expected.exitCode);
  assert.equal(actual.shell.stdout, selected.expected.stdout);
  assert.equal(actual.shell.stderr, selected.expected.stderr);
  assert.equal(actual.shell.rejected, false);
  for (const name of ["operation", "pipe", "collector", "innerShell", "shell"]) {
    assert.equal(actual.events.filter(event => event === `${name}-cleanup-settled`).length, 1);
  }
  const imports = regular(join(raw, selected.id, "imports.ndjson")).toString().trim().split("\n").map(line => JSON.parse(line));
  for (const entry of imports) {
    assert.ok(entry.path === "consumer/child.mjs" || entry.path.startsWith("consumer/node_modules/virtual-bash/dist/") || entry.path.startsWith("engine/src/") || entry.path.startsWith("node_modules/typescript/"));
    assert.equal(entry.sha256, allowlist[entry.path]);
  }
  for (const required of [...pins.privateEngine.sourceEntries.map(filename => `engine/${filename}`), "consumer/node_modules/virtual-bash/dist/index.js"]) {
    assert.ok(imports.some(entry => entry.path === required));
  }
  if (selected.id === "08-function-spread-profile") {
    assert.deepEqual(actual.engineOutcome, selected.expected.engine.rejection.outcome);
    for (const [event, count] of Object.entries(selected.expected.engine.rejection.eventCounts)) assert.equal(actual.events.filter(name => name === event).length, count);
    assert.equal(Object.hasOwn(actual, "engine"), false);
    assert.equal(Object.hasOwn(actual, "budgetUsed"), false);
    const rejection = actual.events.indexOf("actual-engine-run-rejected");
    assert.ok(rejection >= 0 && rejection < actual.events.indexOf("operation-close-settled") && rejection < actual.events.indexOf("shell-exec-settled"));
  }
  observations.push({ id: selected.id, outcome: assessment.outcome, engineOutcome: actual.engineOutcome,
    naturalChildClose: true, importRecords: imports.length, failedRows: [] });
}
const originalPrefix = "tests/integration/safejs-owned-output-prototype-review/surface/execution-v1/attempt-01/raw/";
const originalCommit = "b0ff1977c9c912054edd136510d62819d28cf890";
const gitJson = filename => JSON.parse(execFileSync("/usr/bin/git", ["-C", repository, "show", `${originalCommit}:${originalPrefix}${filename}`], {
  env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0" }, timeout: 20000, maxBuffer: 4 * 1024 * 1024,
}));
assert.equal(gitJson("journal.json").counts.pass, 7);
const originalFailure = gitJson("08-function-spread-profile/assessment.json");
assert.equal(originalFailure.outcome, "FAIL");
assert.deepEqual(originalFailure.checks.filter(entry => !entry.pass).map(entry => entry.name), ["engine ok", "exact error"]);
const originalActual = gitJson("08-function-spread-profile/actual.json");
const currentActual = json(join(raw, "08-function-spread-profile/actual.json"));
for (const name of ["source", "argv", "shell", "hostCounters", "vfsBefore", "vfsAfter", "cleanupFailures", "hostFindings"]) assert.deepEqual(originalActual[name], currentActual[name]);
process.stdout.write(JSON.stringify({ status: "AUTHOR_EVIDENCE_VERIFIED_NOT_INDEPENDENT_REPLAY", freezeCommit: manifest.freezeCommit,
  rawFiles: manifest.files.length, rawBytes: manifest.rawBytes, retainedInputRootsVerified: Object.keys(after),
  privateBeforeTime, privateAfterTime, privateUnchanged: true, privateEligibleFiles: 264,
  actualCounts: journal.counts, supportedSurfacePass: 6, dialectOnlyMatch: 1, awaitedRejectionPublicDiagnosticPass: 1,
  originalRawPass: 7, originalRawFail: 1, originalCase08PublicEffectsUnchanged: true,
  sourceHookQualification: true, originalErrorObjectNotBackfilled: true, observations,
  guestReruns: 0, privateCheckoutQueriesInThisCheck: 0,
}, null, 2) + "\n");
