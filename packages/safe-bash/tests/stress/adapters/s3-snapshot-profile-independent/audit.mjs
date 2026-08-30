import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const owned = "tests/stress/adapters/s3-snapshot-profile-independent";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trim();
assert.equal(process.argv.length, 3, "usage: node audit.mjs <new owned JSON output>");
const output = resolve(process.argv[2]);
assert.ok(output.startsWith(join(root, owned) + "/"));
assert.equal(existsSync(output), false);
const audit = { capturedAt: new Date().toISOString(), command: [process.execPath, ...process.argv.slice(1)], head: git("rev-parse", "HEAD"), attempts: [], assets: [] };

for (const name of ["attempt-001", "attempt-002", "attempt-003"]) {
  const directory = join(root, owned, "evidence", name);
  const report = JSON.parse(readFileSync(join(directory, "report.json"), "utf8"));
  assert.equal(report.cleaned, true);
  assert.equal(report.finalInputIntegrity, true);
  assert.equal(existsSync(report.temporary), false);
  assert.equal(report.indexBefore, report.indexAfter);
  for (const [source, captured] of [["run.mjs", "runner.source.data"], ["independent.test.ts", "independent.source.data"]]) {
    assert.equal(hash(readFileSync(join(directory, captured))), report.inputs.find(input => input.path === `${owned}/${source}`).sha256);
  }
  for (const run of report.runs) {
    for (const stream of ["stdout", "stderr"]) assert.equal(hash(readFileSync(join(directory, `${run.name}.${stream}.log.data`))), run[`${stream}Sha256`]);
  }
  audit.attempts.push({ name, status: report.status, reportSha256: hash(readFileSync(join(directory, "report.json"))), cleaned: report.cleaned, finalInputIntegrity: report.finalInputIntegrity, counts: report.runs.reduce((sum, run) => ({ pass: sum.pass + (run.counts?.pass ?? 0), fail: sum.fail + (run.counts?.fail ?? 0) }), { pass: 0, fail: 0 }) });
  if (name !== "attempt-003") continue;
  assert.equal(report.status, "accepted-profile-bounded");
  assert.equal(report.replayedAuthorChecks, 49);
  assert.equal(report.authorEvidenceAuthentication.observedPassingChecks, 49);
  for (const input of report.inputs) assert.equal(hash(readFileSync(join(root, input.path))), input.sha256);
  const sourcePaths = git("ls-files", "src").split("\n");
  assert.deepEqual(sourcePaths, report.inputs.filter(input => input.path.startsWith("src/")).map(input => input.path));
  assert.equal(git("ls-files", "--others", "--exclude-standard", "--", "src"), "");
  assert.equal(git("diff", report.freeze, "--name-only", "--", "src", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"), "");
  for (const entry of report.typeClosure) assert.equal(hash(readFileSync(entry.origin === "frozen-or-independent" ? join(root, entry.path) : entry.path)), entry.sha256);
  const localTypes = report.typeClosure.filter(entry => entry.origin === "frozen-or-independent");
  const sourceTypes = sourcePaths.filter(path => path.endsWith(".ts"));
  assert.ok(sourceTypes.every(path => localTypes.some(entry => entry.path === path)));
  for (const mutant of report.mutants) {
    assert.equal(mutant.detected, true);
    assert.equal(mutant.restored, true);
    assert.equal(hash(readFileSync(join(directory, `mutant-${mutant.name}.patch.data`))), mutant.patchSha256);
  }
  audit.acceptance = { freeze: report.freeze, seal: report.seal, authorEvidence: report.authorEvidence, inputFiles: report.inputs.length, sourceFiles: sourcePaths.length, sourceTypeScriptFiles: sourceTypes.length, checkedLocalTypeScriptFiles: localTypes.length, installedTypeFiles: report.typeClosure.length - localTypes.length, unchangedAuthorStartInputs: report.unchangedAuthorStartInputs, passingAuthorChecks: report.replayedAuthorChecks, passingIndependentChecks: report.runs.find(run => run.name === "independent-guards").counts.pass, mutantsCaught: report.mutants.length, expectedMutantFailures: report.runs.filter(run => run.name.startsWith("mutant-")).length, restoredPassingChecks: report.runs.filter(run => run.name.startsWith("restored-")).reduce((sum, run) => sum + run.counts.pass, 0), originalTotals: report.originalFailure.totals };
  audit.sourceDifferencesFromHistoricalB494 = git("diff", "--name-only", report.originalFailure.commit, report.freeze, "--", "src").split("\n");
  audit.historicalRelevantSourceComparison = git("diff", "--name-only", report.originalFailure.commit, report.freeze, "--", "src/fs", "src/contracts", "tests/fs/s3/rmdir.test.ts", "tests/fs/s3/rmdir-real-service/snapshot-profile/rmdir-profile.test.ts", "tests/fs/s3/constructor-comparison.test.ts", "tests/fs/webdav/rmdir.test.ts", "tests/fs/webdav/mock.ts", "tests/fs/conformance/fixtures.ts");
  assert.equal(audit.historicalRelevantSourceComparison, "");
}

function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else {
      assert.equal(entry.isSymbolicLink(), false);
      const bytes = readFileSync(path);
      audit.assets.push({ path: path.slice(root.length), bytes: bytes.length, sha256: hash(bytes) });
    }
  }
}
collect(join(root, owned));
audit.status = "authenticated";
audit.index = git("diff", "--cached", "--raw");
writeFileSync(output, JSON.stringify(audit, null, 2) + "\n");
console.log(JSON.stringify({ status: audit.status, ...audit.acceptance, authenticatedAssets: audit.assets.length }));
