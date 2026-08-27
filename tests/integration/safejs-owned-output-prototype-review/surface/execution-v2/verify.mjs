import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const surface = dirname(owned);
const repository = resolve(surface, "../../../..");
const prefix = relative(repository, surface);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function regular(filename) {
  assert.equal(realpathSync(filename), filename);
  assert.ok(lstatSync(filename).isFile());
  return readFileSync(filename);
}
const git = (commit, filename) => execFileSync("/usr/bin/git", ["-C", repository, "show", `${commit}:${filename}`], {
  env: { PATH: "/usr/bin:/bin", GIT_OPTIONAL_LOCKS: "0" }, timeout: 20000, maxBuffer: 32 * 1024 * 1024,
});
const delta = JSON.parse(regular(join(owned, "DELTA.json")));
const release = JSON.parse(regular(join(owned, "RELEASE.json")));
for (const receipt of release.receipts) {
  const bytes = git(receipt.commit, receipt.path);
  assert.equal(hash(bytes), receipt.sha256);
  assert.deepEqual(regular(join(repository, receipt.path)), bytes);
}
const originalChild = git(delta.baseCommit, `${prefix}/execution-v1/child.mjs`);
const child = regular(join(owned, "child.mjs"));
assert.equal(hash(originalChild), delta.child.baseSha256);
assert.equal(hash(child), delta.child.signedExpectedRevisedSha256);
assert.equal(hash(child), delta.child.revisedSha256);
assert.deepEqual(regular(join(surface, "execution-v1/child.mjs")), originalChild);
const originalRunner = git(delta.baseCommit, `${prefix}/execution-v1/run.mjs`);
assert.equal(hash(originalRunner), delta.runner.baseSha256);
assert.deepEqual(regular(join(surface, "execution-v1/run.mjs")), originalRunner);
let transformed = originalRunner.toString();
for (const replacement of delta.runner.replacements) {
  assert.equal(transformed.split(replacement.before).length, 2);
  transformed = transformed.replace(replacement.before, replacement.after);
}
assert.equal(hash(transformed), delta.runner.revisedSha256);
assert.equal(regular(join(owned, "run.mjs")).toString(), transformed);
const originalCasesBytes = git(delta.inputCommit, `${prefix}/CASES.json`);
assert.deepEqual(regular(join(surface, "CASES.json")), originalCasesBytes);
assert.equal(hash(originalCasesBytes), delta.expectedData.baseSha256);
const originalCases = JSON.parse(originalCasesBytes);
const casesBytes = regular(join(owned, "CASES.json"));
assert.equal(hash(casesBytes), delta.expectedData.revisedSha256);
const revisedCases = JSON.parse(casesBytes);
assert.equal(revisedCases.cases[7].id, "08-function-spread-profile");
assert.deepEqual(revisedCases.cases[7].expected.engine, delta.expectedData.after);
revisedCases.cases[7].expected.engine = delta.expectedData.before;
assert.deepEqual(revisedCases, originalCases);
assert.deepEqual(regular(join(owned, "PINS.json")), git(delta.inputCommit, `${prefix}/PINS.json`));
for (const entry of originalCases.cases) {
  const bytes = regular(join(surface, entry.source.path));
  assert.equal(hash(bytes), entry.source.sha256);
  assert.deepEqual(bytes, git(delta.inputCommit, `${prefix}/${entry.source.path}`));
}
const freezeFile = join(owned, "RUNNER-FREEZE.json");
if (existsSync(freezeFile)) {
  const freeze = JSON.parse(regular(freezeFile));
  for (const entry of freeze.files) {
    const bytes = regular(join(owned, entry.path));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(hash(bytes), entry.sha256, entry.path);
  }
}
process.stdout.write(JSON.stringify({ status: "EXACT_SIGNED_CHILD_AND_MINIMAL_SCORER_DELTA_VERIFIED",
  childSha256: hash(child), runnerSha256: hash(transformed), expectedDataSha256: hash(casesBytes),
  runnerReplacements: delta.runner.replacements.map(entry => entry.reason),
  onlyExpectedDataPointer: delta.expectedData.onlySemanticPointer,
  originalGuestSourcesUnchanged: originalCases.cases.length, unconditionalCases: 8,
  originalRunnerUnchanged: true, originalCasesUnchanged: true, freezePresent: existsSync(freezeFile),
  guestExecutions: 0, runtimeImports: 0,
}, null, 2) + "\n");
