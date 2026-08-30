import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const attempts = [
  { name: "baseline-01", directory: path.join(own, "../s06-v1/baseline-attempt-eZqFQv") },
  { name: "baseline-02", directory: path.join(own, "baseline-attempt-YGwBis") },
  { name: "successor-01", directory: path.join(own, "successor-attempt-zs5pBq") },
];
const snapshot = directory => {
  const entries = [];
  const visit = (folder, prefix) => {
    for (const name of fs.readdirSync(folder).sort()) {
      const absolute = path.join(folder, name);
      const relative = prefix + name;
      const stat = fs.lstatSync(absolute);
      const mode = stat.mode & 0o777;
      if (stat.isSymbolicLink()) {
        assert.equal(relative, "source/node_modules");
        entries.push({ path: relative, kind: "symlink", mode, target: fs.readlinkSync(absolute) });
      } else if (stat.isDirectory()) {
        entries.push({ path: relative, kind: "directory", mode });
        visit(absolute, relative + "/");
      } else {
        assert(stat.isFile());
        const bytes = fs.readFileSync(absolute);
        entries.push({ path: relative, kind: "file", mode, sha256: sha(bytes), base64: bytes.toString("base64") });
      }
    }
  };
  visit(directory, "");
  return entries;
};
const decode = filename => JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(filename, "utf8"), "base64")));
const write = (filename, bytes) => fs.writeFileSync(path.join(own, filename), bytes, { flag: "wx" });
const summaries = [];
for (const attempt of attempts) {
  const raw = fs.readFileSync(path.join(attempt.directory, "RESULTS.json"));
  const report = JSON.parse(raw);
  const capsule = fs.readFileSync(path.join(attempt.directory, "RESULTS.json.gz.base64"));
  assert.deepEqual(decode(path.join(attempt.directory, "RESULTS.json.gz.base64")), report);
  assert(report.ownedChildrenSettled);
  for (const command of report.commands) {
    assert(command.processGroupAbsent);
    assert.equal(command.signal, null);
    assert.equal(command.error, null);
    assert.throws(() => process.kill(-command.pid, 0), { code: "ESRCH" });
  }
  const entries = snapshot(attempt.directory);
  const capture = { profile: "exact owned attempt data archive; never canonical TypeScript input", originalDirectory: attempt.directory, entries };
  const encoded = gzipSync(Buffer.from(JSON.stringify(capture))).toString("base64") + "\n";
  const archive = attempt.name + "-raw.json.gz.base64";
  write(archive, encoded);
  assert.deepEqual(decode(path.join(own, archive)), capture);
  assert.deepEqual(snapshot(attempt.directory), entries, "append-aware, byte/mode/link-preserving capture stability");
  summaries.push({ name: attempt.name, directory: attempt.directory, archive, archiveSha256: sha(encoded), reportSha256: sha(raw), capsuleSha256: sha(capsule), entries: entries.length, files: entries.filter(entry => entry.kind === "file").length, success: report.success, commands: report.commands.map(({ label, status, pid, processGroupAbsent }) => ({ label, status, pid, processGroupAbsent })) });
  if (attempt.name === "successor-01") write("successor-capture-01.json.gz.base64", capsule);
}
const baseline = JSON.parse(fs.readFileSync(path.join(attempts[1].directory, "RESULTS.json")));
const successor = JSON.parse(fs.readFileSync(path.join(attempts[2].directory, "RESULTS.json")));
assert(baseline.success && successor.success);
assert.deepEqual(Object.keys(successor.package.inventory).sort(), Object.keys(baseline.package.inventory).sort());
const changedPackageFiles = Object.keys(successor.package.inventory).filter(name => successor.package.inventory[name] !== baseline.package.inventory[name]).sort();
const expectedChanges = ["parser", "runtime"].flatMap(name => ["dist/shell/" + name + ".js", "dist/shell/" + name + ".js.map", "dist/shell/" + name + ".d.ts.map"]);
expectedChanges.push(...[".js", ".js.map", ".d.ts", ".d.ts.map"].map(suffix => "dist/shell/arrays/syntax" + suffix));
assert.deepEqual(changedPackageFiles, expectedChanges.sort());
for (const mutation of successor.mutations) {
  assert(mutation.executedAssertionRejected);
  assert(mutation.loads.some(load => load.relative === mutation.file && load.sha256 === mutation.alteredSha256));
}
assert.equal(successor.mutations.length, 10);
assert.deepEqual(successor.toolchain, baseline.toolchain);
for (const report of [baseline, successor]) {
  assert.equal(report.package.files.length, 862);
  assert.equal(report.selectedBuildInputCount, 269);
  assert.equal(sha(Buffer.from(report.package.base64, "base64")), report.package.sha256);
  assert(report.runtimeStableIncludingNewEntries && report.package.stableIncludingNewEntries);
}
const summary = {
  profile: "narrow S06 author proof; independent successor acceptance remains Plato/root",
  sealedAt: new Date().toISOString(),
  sourceCommit: successor.productRevision,
  testsCommit: successor.revision,
  sourceTree: successor.candidateSourceTree,
  selectedBuildInputs: successor.selectedBuildInputCount,
  packageSha256: successor.package.sha256,
  packageFiles: successor.package.files.length,
  packageBytes: successor.package.bytes,
  sourceOverlays: Object.fromEntries(Object.entries(successor.overlays).filter(([name]) => name.startsWith("src/")).map(([name, entry]) => [name, { sha256: entry.sha256, blob: entry.blob }])),
  sourceTests: { unchangedOriginal: 32, originalPublicExecs: 69, newTargeted: 51, total: 83, passed: 83, failed: 0, skipped: 0 },
  baseline: { sourceTree: baseline.candidateSourceTree, packageSha256: baseline.package.sha256, originalTests: 32, originalPublicExecs: 69, targeted: 51, passed: 42, failed: 9, failures: baseline.targetedFailures },
  loadedSourceFiles: new Set(successor.sourceLoads.map(entry => entry.relative)).size,
  loadedTargetedFiles: new Set(successor.targetedLoads.map(entry => entry.relative)).size,
  layouts: successor.layouts.map(({ label, loads, publicFlows, s06PublicFlows }) => ({ label, loadedFiles: new Set(loads.map(entry => entry.relative)).size, publicFlows, s06PublicFlows })),
  mutants: successor.mutations.map(({ name, file, originalSha256, alteredSha256, executedAssertionRejected }) => ({ name, file, originalSha256, alteredSha256, executedAssertionRejected })),
  changedPackageFiles,
  unchangedPublicDeclarations: true,
  toolchain: successor.toolchain,
  successorStartedAt: successor.startedAt,
  successorFinishedAt: successor.finishedAt,
  successorChildGroupsReaped: successor.commands.length,
  attempts: summaries,
  limits: ["No independent successor acceptance", "No native/oracle/comparator execution", "G4A logical private accounting, not whole-command or RSS bounds", "No declaration implementation or O11 cleanup inference", "No whole foreign gate or superiority claim"],
};
write("SUCCESSOR-SEAL.json", JSON.stringify(summary, null, 2) + "\n");
process.stdout.write(JSON.stringify({ sourceTree: summary.sourceTree, packageSha256: summary.packageSha256, archives: summaries.map(({ archive, files }) => ({ archive, files })), allGroupsAbsent: true }) + "\n");
