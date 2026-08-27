import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const owned = dirname(fileURLToPath(import.meta.url));
const repository = resolve(owned, "../../../..");
const prefix = relative(repository, owned);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const write = (name, value) => writeFileSync(join(owned, name), JSON.stringify(value, null, 2) + "\n");
const directories = ["evidence", "evidence-final", "evidence-complete"];
const reports = directories.map(directory => JSON.parse(readFileSync(join(owned, directory, "report.json"))));
const complete = reports[2];
assert.equal(complete.status, "verified-configuration-delta-with-preexisting-inclusion-limit");
for (const [index, filename] of [[0, "check-before-inventory-correction.mjs.txt"], [1, "check-before-import-closure-correction.mjs.txt"], [2, "check.mjs"]]) {
  assert.equal(hash(readFileSync(join(owned, filename))), reports[index].checkerSha256);
}
const actualPhases = reports.flatMap(report => report.phases.filter(phase => phase.executedThisAttempt !== false));
assert.equal(actualPhases.length, 42);
const groups = [...new Set(actualPhases.map(phase => phase.pid))].map(pid => {
  let alive = false;
  try { process.kill(-pid, 0); alive = true; } catch (error) { assert.equal(error.code, "ESRCH"); }
  return { processGroup: pid, alive };
});
assert.ok(groups.every(group => !group.alive));
const temporaryRoots = [...new Set(reports.map(report => report.root))].map(path => ({ path, exists: existsSync(path) }));
assert.ok(temporaryRoots.every(root => !root.exists));
for (const reused of complete.phases.filter(phase => phase.executedThisAttempt === false)) {
  const original = reports[1].phases.find(phase => phase.label === reused.label);
  for (const channel of ["stdout", "stderr"]) {
    const current = readFileSync(join(owned, "evidence-complete", reused[channel]));
    assert.deepEqual(current, readFileSync(join(owned, "evidence-final", original[channel])));
    assert.equal(hash(current), reused[channel + "Sha256"]);
  }
}
write("inclusion.json", complete.snapshots.map(snapshot => ({ label: snapshot.label, revision: snapshot.revision, ...snapshot.checks.inclusion, additionalImportedTrackedFiles: snapshot.checks.additionalImportedTrackedFiles })));
write("diagnostics.json", complete.snapshots.map(snapshot => ({ label: snapshot.label, revision: snapshot.revision, cold: snapshot.checks.cold, rootNegative: snapshot.checks.rootNegative, consumerBeforeBuild: snapshot.checks.consumerBeforeBuild, consumerNegative: snapshot.checks.consumerNegative, packedNegative: snapshot.checks.packedNegative, declarationPoison: snapshot.checks.declarationPoison, sourceFallback: snapshot.checks.sourceFallback })));
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
writeFileSync(join(owned, "commands.txt"), reports.flatMap((report, index) => [
  `# ${directories[index]}: ${report.status}; ${report.startedAt} to ${report.finishedAt}`,
  ...report.phases.map(phase => `# ${phase.label}: exit ${phase.status}, expected ${phase.expected}, ${phase.executedThisAttempt === false ? "REUSED (not executed again)" : "EXECUTED"}\n(cd ${quote(phase.cwd)} && ${[phase.command, ...phase.args].map(quote).join(" ")})\n# stdout ${directories[index]}/${phase.stdout}; stderr ${directories[index]}/${phase.stderr}`),
]).join("\n\n") + "\n");
const git = (...args) => execFileSync("git", args, { cwd: repository, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
assert.equal(git("rev-parse", "--show-toplevel").toString().trim(), repository);
assert.equal(git("diff", "--cached", "--name-only", "--", prefix).toString(), "");
assert.equal(git("ls-files", "--", prefix).toString(), "");
const audit = {
  at: new Date().toISOString(), scope: prefix, head: git("rev-parse", "HEAD").toString().trim(),
  ownedStatus: git("status", "--short", "--untracked-files=all", "--", prefix).toString(),
  indexSha256: hash(git("ls-files", "--stage", "-z")),
  unstagedPaths: git("diff", "--name-only").toString().trim().split("\n").filter(Boolean),
  stagedPaths: git("diff", "--cached", "--name-only").toString().trim().split("\n").filter(Boolean),
  temporaryRoots, groups, executedSupervisedPhases: actualPhases.length, separateSyntaxChecks: 2, cumulativeAuthorizedToolCount: 44,
  metadataOnlyFinalizer: true, noProductOrCompilerExecution: true,
  noOwnedStagingOrCommit: true, note: "Concurrent root/worker changes are not reverted or attributed to this verifier. This audit only reads Git state and owned evidence.",
};
write("state-audit.json", audit);
const files = [];
function walk(directory) {
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    const info = lstatSync(path);
    assert.equal(info.isSymbolicLink(), false);
    if (info.isDirectory()) walk(path);
    else {
      assert.ok(info.isFile() && info.nlink === 1);
      if (path === join(owned, "final-manifest.json")) continue;
      files.push({ path: relative(repository, path), bytes: info.size, sha256: hash(readFileSync(path)) });
    }
  }
}
walk(owned);
const externalHandoffFiles = ["/tmp/safe-bash-cold-typecheck-independent-plan.txt", "/tmp/safe-bash-cold-typecheck-independent-detail.txt"].map(path => ({ path, bytes: lstatSync(path).size, sha256: hash(readFileSync(path)) }));
write("final-manifest.json", { at: new Date().toISOString(), scope: prefix, selfExcluded: prefix + "/final-manifest.json", files, externalHandoffFiles, staged: false, committed: false });
console.log(JSON.stringify({ files: files.length, ownedBytes: files.reduce((sum, file) => sum + file.bytes, 0), manifestSha256: hash(readFileSync(join(owned, "final-manifest.json"))), externalHandoffFiles, temporaryRootsRemoved: true, survivingOwnedGroups: 0, noOwnedStagingOrCommit: true, head: audit.head }, null, 2));
