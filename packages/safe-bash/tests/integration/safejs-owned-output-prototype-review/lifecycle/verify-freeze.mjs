import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(process.argv.length, 2, "Preparation verification only; execution is not authorized");
const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, "../../../..");
assert.equal(repository, "/Users/kjopek/Workspace/safe-bash");
const load = filename => JSON.parse(readFileSync(join(directory, filename), "utf8"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const freeze = load("FREEZE.json");
const cases = load("CASES.json");
const pins = load("SOURCE-PINS.json");
assert.equal(freeze.status, "PREPARED_NOT_EXECUTED");
assert.equal(freeze.executionRelease, false);
assert.equal(cases.status, "UNRUN_RELEASE_REQUIRED");
assert.equal(pins.rootExecutionRelease, false);
for (const count of Object.values(pins.executionCounts)) assert.equal(count, 0);
assert.equal(cases.rows.length, 11);
assert.equal(cases.executionRows, 11);
assert.equal(new Set(cases.rows.map(row => row.workflow)).size, 6);
assert.equal(cases.logicalWorkflows, 6);
assert.deepEqual(cases.executionOrder, cases.rows.map(row => row.id));
assert.equal(new Set(cases.executionOrder).size, 11);
const paths = [];
function visit(parent) {
  for (const name of readdirSync(parent).sort()) {
    const filename = join(parent, name);
    const stat = lstatSync(filename);
    assert.equal(stat.isSymbolicLink(), false, filename);
    if (stat.isDirectory()) visit(filename);
    else {
      assert.ok(stat.isFile(), filename);
      const local = relative(directory, filename);
      if (local !== "FREEZE.json") paths.push(local);
    }
  }
}
visit(directory);
assert.deepEqual(paths.sort(), freeze.files.map(entry => entry.path).sort());
for (const entry of freeze.files) {
  const bytes = readFileSync(join(directory, entry.path));
  assert.equal(bytes.length, entry.bytes, entry.path);
  assert.equal(sha(bytes), entry.sha256, entry.path);
}
assert.equal(freeze.inputs.length, cases.rows.length);
for (const [index, row] of cases.rows.entries()) {
  const bytes = readFileSync(join(directory, row.guest));
  const input = freeze.inputs[index];
  assert.equal(input.id, row.id);
  assert.equal(input.guestSha256, sha(bytes));
  assert.equal(input.guestBytesBase64, bytes.toString("base64"));
  assert.equal(input.publicShellCommand, "owned-guest");
  assert.equal(input.invokeName, "safejs");
  assert.deepEqual(input.invokeArgv, ["-e", bytes.toString("utf8"), "--", ...row.guestArgs]);
  assert.deepEqual(input.limits, { ...cases.defaultSafeJsLimits, ...(row.maxSteps === undefined ? {} : { maxSteps: row.maxSteps }) });
  assert.equal(input.status, "UNRUN_RELEASE_REQUIRED");
  assert.equal(input.syntaxAndReachability, "UNPROVED");
  if (row.requiresPositive) {
    const positive = cases.rows.find(candidate => candidate.id === row.requiresPositive);
    assert.ok(positive);
    assert.ok(cases.executionOrder.indexOf(positive.id) < index);
    assert.equal(row.guest, positive.guest);
  }
}
assert.equal(pins.preparationCommit, "f666ad8c76ea4362b093ee52e3e7e3b5c3702916");
assert.equal(pins.candidateEvidenceCommit, "e57b5aa16f749b6fac558877dff0712e64df05a8");
assert.equal(pins.staticReadEquality.sourceManifestSha256, "6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea");
assert.equal(pins.staticReadEquality.sourceFiles, 213);
assert.equal(pins.staticReadEquality.candidateFiles, 940);
assert.equal(pins.staticReadEquality.compiledFiles, 708);
assert.equal(pins.privateExpectedAtRelease.head, "bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e");
assert.equal(pins.privateExpectedAtRelease.engineRegularFiles, 264);
assert.equal(Object.keys(pins.privateExpectedAtRelease.metadata).length, 6);
assert.deepEqual(pins.actualApi.capability, ["consumerClosed", "write"]);
assert.deepEqual(pins.actualApi.operation, ["signal", "output", "registerCleanup", "acquire", "child", "close"]);
assert.equal(pins.actualApi.safeJsWrapperImplicitOptIn, false);
for (const entry of pins.receiptInputs) {
  const bytes = execFileSync("/usr/bin/git", ["show", `${entry.commit}:${entry.path}`], {
    cwd: repository, env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" }, maxBuffer: 32 * 1024 * 1024, timeout: 20000,
  });
  assert.equal(sha(bytes), entry.sha256, entry.path);
  assert.equal(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), entry.gitBlob, entry.path);
}
console.log(JSON.stringify({
  verifiedAt: new Date().toISOString(), status: "FROZEN_PREPARATION_VALID", logicalWorkflows: 6, executionRows: 11,
  guestExecutions: 0, engineImports: 0, productImports: 0, sourceFiles: 213, compiledFiles: 708,
  independentReceiptAuthentication: "PENDING", rootExecutionRelease: false,
  scope: "Input/receipt hashes and plan consistency only; not guest syntax, security, lifecycle or runtime acceptance",
}, null, 2));
