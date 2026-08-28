import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const own = path.dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const blob = bytes => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const sealPath = path.join(own, "FOUNDATION-SEAL.json");
const readCapsule = filename => {
  const bytes = fs.readFileSync(filename);
  const decoded = gunzipSync(Buffer.from(bytes.toString(), "base64"));
  return { bytes, decoded, report: JSON.parse(decoded) };
};
const checkReport = report => {
  assert.equal(report.baseTree, "37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e");
  assert.equal(report.baseInputs.length, 265);
  assert.equal(report.nativeExecutions, 0);
  assert.equal(report.ownedChildrenSettled, true);
  assert(report.commands.every(command => command.settledAt && command.signal === null && command.error === null));
  for (const [name, input] of Object.entries(report.overlays)) {
    assert(/^src\/shell\/(runtime\.ts|parser\.ts|shell\.ts|arrays\/[^/]+\.ts)$|^tests\/shell\/indexed-arrays-author-20260828\/(foundation|syntax)\.test\.ts$|^tests\/shell\/indexed-arrays-author-20260828\/public-consumer\.ts$/u.test(name), name);
    const bytes = Buffer.from(input.base64, "base64");
    assert.equal(sha(bytes), input.sha256, name);
    assert.equal(blob(bytes), input.blob, name);
  }
  if (report.driver) assert.equal(sha(Buffer.from(report.driver.base64, "base64")), report.driver.sha256);
  if (report.package) assert.equal(sha(Buffer.from(report.package.base64, "base64")), report.package.sha256);
  const source = report.commands.find(command => command.label === "source-foundation-and-syntax");
  const publicExecs = source?.stdout.match(/AUTHOR_FLOW_COUNTS \{"publicExecs":(\d+)\}/u)?.[1];
  return {
    tests: Number(source?.stdout.match(/^# tests (\d+)$/mu)?.[1] ?? 0),
    passes: Number(source?.stdout.match(/^# pass (\d+)$/mu)?.[1] ?? 0),
    failures: Number(source?.stdout.match(/^# fail (\d+)$/mu)?.[1] ?? 0),
    publicExecs: publicExecs === undefined ? null : Number(publicExecs),
  };
};

if (process.argv[2] === "capture") {
  assert(!fs.existsSync(sealPath), "seal already exists; captures are immutable");
  const attempts = fs.readdirSync(own).filter(name => /^foundation-attempt-[A-Za-z0-9]{6}$/u.test(name))
    .map(name => ({ name, ...readCapsule(path.join(own, name, "RESULTS.json.gz.base64")) }))
    .sort((left, right) => left.report.startedAt.localeCompare(right.report.startedAt));
  assert.equal(attempts.length, 11);
  const captures = [];
  for (const [index, attempt] of attempts.entries()) {
    const counts = checkReport(attempt.report);
    const original = fs.readFileSync(path.join(own, attempt.name, "RESULTS.json"));
    assert.deepEqual(JSON.parse(original), attempt.report);
    const filename = `foundation-capture-${String(index + 1).padStart(2, "0")}.json.gz.base64`;
    fs.writeFileSync(path.join(own, filename), attempt.bytes, { flag: "wx" });
    captures.push({ filename, originalDirectory: attempt.name, capsuleSha256: sha(attempt.bytes), decodedSha256: sha(attempt.decoded), originalReportSha256: sha(original), revision: attempt.report.revision, success: attempt.report.success, counts, processes: attempt.report.commands.length, driverAuthenticated: attempt.report.driver !== undefined });
  }
  const latest = attempts.at(-1).report;
  assert.equal(latest.revision, "50117fc54fdfd650e8f57e84b82ba21297ab8a0f");
  assert.equal(latest.success, true);
  const seal = {
    profile: "indexed-array foundation author evidence; not independent acceptance",
    sourceCandidate: latest.revision,
    productSourceCommit: "c7dae6e884d1a144266dfc1bb80785bf007a667f",
    baseTree: latest.baseTree,
    candidateSourceTree: latest.candidateSourceTree,
    selectedBuildInputCount: latest.selectedBuildInputCount,
    packageSha256: latest.package.sha256,
    packageFiles: Object.keys(latest.package.inventory).length,
    toolchain: latest.toolchain,
    driverSha256: latest.driver.sha256,
    captures,
    actualInterval: { startedAt: attempts[0].report.startedAt, finishedAt: latest.finishedAt },
    proofLimit: "Author groups are not the independent 33 semantic vectors or 22 mechanical obligations. Prior syntax-only acceptance remains separate. No duration, whole-product or RSS claim.",
  };
  fs.writeFileSync(sealPath, JSON.stringify(seal, null, 2) + "\n", { flag: "wx" });
} else assert.equal(process.argv[2], "verify");

const seal = JSON.parse(fs.readFileSync(sealPath));
let processes = 0;
for (const capture of seal.captures) {
  const { bytes, decoded, report } = readCapsule(path.join(own, capture.filename));
  assert.equal(sha(bytes), capture.capsuleSha256);
  assert.equal(sha(decoded), capture.decodedSha256);
  assert.equal(sha(Buffer.from(JSON.stringify(report, null, 2) + "\n")), capture.originalReportSha256);
  assert.equal(report.revision, capture.revision);
  assert.equal(report.success, capture.success);
  assert.deepEqual(checkReport(report), capture.counts);
  processes += report.commands.length;
}
const final = readCapsule(path.join(own, seal.captures.at(-1).filename)).report;
assert.equal(final.revision, seal.sourceCandidate);
assert.equal(final.candidateSourceTree, seal.candidateSourceTree);
assert.equal(final.package.sha256, seal.packageSha256);
assert.equal(final.selectedBuildInputCount, 269);
assert.equal(final.package.stableIncludingNewEntries, true);
assert.equal(final.runtimeStableIncludingNewEntries, true);
assert.deepEqual(checkReport(final), { tests: 32, passes: 32, failures: 0, publicExecs: 69 });
assert.equal(final.mutations.length, 10);
for (const mutation of final.mutations) {
  assert(mutation.loads.some(load => load.relative === mutation.file && load.sha256 === mutation.alteredSha256));
  const command = final.commands.find(entry => entry.label === "loaded-mutant-" + mutation.name);
  assert.equal(command.status, 1);
  assert(command.stdout.split("\n").some(line => line.startsWith("not ok ") && line.includes(mutation.assertion)));
}
assert.deepEqual(final.layouts.map(layout => [layout.label, layout.publicFlows]), [["installed", 6], ["moved", 6]]);
assert.equal(final.commands.find(command => command.label === "unchanged-public-api-negative-control").status, 2);
process.stdout.write(JSON.stringify({ capsules: seal.captures.length, settledProcesses: processes, finalGroups: 32, sourcePublicExecs: 69, loadedMutants: 10, installedFlows: 6, movedFlows: 6, productExecution: false }) + "\n");
