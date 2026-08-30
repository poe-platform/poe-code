import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const root = resolve(owned, "../../..");
const json = path => JSON.parse(readFileSync(join(owned, path)));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const first = json("candidate-5ba1a0f3-review1/report.json");
const final = json("candidate-5ba1a0f3-review2/report.json");
const before = json("audit-before.json");
const after = json("audit-after.json");
assert.equal(final.candidate, "5ba1a0f36e77c69b9ebb617c4d2544bf62d473a7");
assert.equal(final.success, true);
assert.equal(first.success, false);
assert.equal(first.commands.at(-1).name, "independent-controls");
assert.equal(first.commands.at(-1).status, 1);
assert.deepEqual(before.historicalHashes, after.historicalHashes);
assert.deepEqual(before.fixtureHashes, after.fixtureHashes);
for (const [path, expected] of Object.entries(before.historicalHashes)) assert.equal(sha(readFileSync(join(root, path))), expected, path);
for (const [path, expected] of Object.entries(final.toolHashes)) assert.equal(sha(readFileSync(join(root, "node_modules", path))), expected, path);
const expectedCounts = {
  "revised-errexit": [30, 30, 0], "revised-expanded": [6, 6, 0],
  "original-errexit": [30, 28, 2], "original-expanded": [6, 1, 5],
};
for (const [index, report] of [first, final].entries()) {
  const directory = `candidate-5ba1a0f3-review${index + 1}`;
  assert.equal(report.candidate, final.candidate);
  assert.deepEqual(report.inputs, final.inputs);
  assert.equal(report.archiveSha256, final.archiveSha256);
  assert.equal(existsSync(report.source), false);
  for (const command of report.commands) {
    assert.equal(command.timeout, false);
    assert.equal(command.overflow, false);
    assert.equal(command.groupAbsent, true);
    assert.throws(() => process.kill(-command.pid, 0), error => error.code === "ESRCH");
    for (const channel of ["stdout", "stderr"]) assert.equal(sha(readFileSync(join(owned, directory, `${command.name}.${channel}`))), command[`${channel}Sha256`]);
    if (command.name in expectedCounts) {
      const [tests, pass, fail] = expectedCounts[command.name];
      assert.deepEqual(command.counts, { tests, pass, fail, cancelled: 0, skipped: 0, todo: 0 });
    }
  }
  const core = report.commands.find(command => command.name === "original-core");
  assert.match(readFileSync(join(owned, directory, "original-core.stderr"), "utf8"), /127 !== 126/u);
  assert.equal(core.status, 1);
  assert.deepEqual(JSON.parse(readFileSync(join(owned, directory, "revised-core.stdout"))), { scenario: "literal-single-optional-argument", passed: true });
  for (const name of ["run.mjs", "controls.mjs.data"]) assert.equal(sha(readFileSync(join(owned, directory, `${name}.data`))), report.harnessHashes[name]);
}
const originalErrexit = final.commands.find(command => command.name === "original-errexit");
assert.deepEqual(originalErrexit.failures, [String.raw`literal shebang refusal \#!/usr/bin/env bash -e`, String.raw`literal shebang refusal \#!/usr/bin/env -S bash -e`]);
const originalExpanded = final.commands.find(command => command.name === "original-expanded");
assert.deepEqual(originalExpanded.failures, ["/usr/bin/env bash -e", "/usr/bin/env -S bash -e", "/usr/bin/env python", "/usr/bin/env", "/usr/bin/env bash\r"].map(header => `explicit unsupported env interpreter ${JSON.stringify(header).replaceAll("\\", "\\\\")}`));
const controls = json("candidate-5ba1a0f3-review2/independent-controls.stdout");
assert.equal(controls.passed, 16);
assert.equal(controls.failed, 0);
assert.equal(controls.mutationControls.length, 6);
assert.equal(before.negativeInputMutations.length, 8);
assert.deepEqual(controls.unhandledRejections, []);
for (const row of controls.rows) {
  assert.deepEqual(row.before, row.after);
  assert.equal(row.disposalCount, 1);
  assert.equal(row.disposedExecRejected, true);
}
const depthDispatches = controls.rows.filter(row => ["expanded-4", "bare-env-depth-two", "bare-env-depth-four"].includes(row.id)).map(row => ({ id: row.id, dispatches: row.dispatches.length, typedLimit: row.rejection.actualShellLimitError && row.rejection.limit === "maxSubstitutionDepth" }));
assert.deepEqual(depthDispatches, [{ id: "expanded-4", dispatches: 129, typedLimit: true }, { id: "bare-env-depth-two", dispatches: 5, typedLimit: true }, { id: "bare-env-depth-four", dispatches: 9, typedLimit: true }]);
const archive = spawnSync("git", ["archive", "--format=tar", final.candidate, "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", ...before.exactChangedPaths], { cwd: root, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
assert.equal(archive.status, 0);
assert.equal(sha(archive.stdout), final.archiveSha256);
const result = { candidate: final.candidate, verifiedAt: new Date().toISOString(), success: true, original: { canonical: { pass: 29, fail: 7, total: 36 }, core: { pass: 0, fail: 1, total: 1 } }, revised: { canonical: { pass: 36, fail: 0, total: 36 }, core: { pass: 1, fail: 0, total: 1 } }, controls: { pass: 16, fail: 0 }, negativeControls: { inputWhitelist: 8, resultAssertions: 6 }, historicalFilesUnchanged: Object.keys(before.historicalHashes).length, selectedToolHashesStable: true, archiveRegeneratedIdentically: true, exactInputPaths: Object.keys(final.inputs).length, depthDispatches, absentOwnedProcessGroups: first.commands.length + final.commands.length, scratchAbsent: true, firstReviewerDiagnosticDefectPreserved: true };
if (process.argv[2]) writeFileSync(resolve(owned, process.argv[2]), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(result, null, 2));
