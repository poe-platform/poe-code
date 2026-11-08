import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const owned = "tests/fs/s3/http/final-verification/service";
const evidence = join(owned, process.argv[2] ?? "evidence");
assert.ok(resolve(evidence).startsWith(resolve(owned) + "/"));
const json = path => JSON.parse(readFileSync(path, "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const audit = json(join(evidence, "audit.json"));
const prepare = json(join(evidence, "prepare.json"));
const publicReport = json(join(evidence, "packed-public-service.json"));
const originalHashes = json(join(evidence, "SHA256SUMS.json"));
for (const [path, expected] of Object.entries(originalHashes)) assert.equal(hash(readFileSync(join(evidence, path))), expected, path);
const rawCounts = {};
for (const name of readdirSync(evidence).filter(name => name.startsWith("raw-") && name.endsWith(".json"))) {
  const entries = json(join(evidence, name));
  for (const [path, entry] of Object.entries(entries)) assert.equal(hash(Buffer.from(entry.base64, "base64")), entry.sha256, `${name}:${path}`);
  rawCounts[name] = Object.keys(entries).length;
}
function verifyPaths(directory, expected) {
  for (const [path, digest] of Object.entries(expected)) assert.equal(hash(readFileSync(join(directory, path))), digest, path);
}
verifyPaths(prepare.source, audit.frozenBefore);
verifyPaths(join(prepare.consumer, "node_modules/virtual-bash"), audit.packedBefore);
verifyPaths(prepare.source, audit.authorInputsBefore);
verifyPaths(prepare.source, audit.handoffInputsBefore);
verifyPaths(process.cwd(), audit.authorInputsBefore);
verifyPaths(process.cwd(), audit.handoffInputsBefore);
verifyPaths(process.cwd(), Object.fromEntries(Object.entries(prepare.sourceHashes).filter(([path]) => path.startsWith("src/fs/s3/http/"))));
const packed = JSON.parse(prepare.phases.find(phase => phase.label === "pack-actual-manifest").stdout);
assert.equal(hash(readFileSync(join(prepare.directory, packed[0].filename))), prepare.packageSha256);
assert.equal(hash(readFileSync(join(prepare.directory, "source.tar"))), prepare.archiveSha256);
const previousPrepare = json("tests/fs/s3/http-independent/evidence/final-prepare.json");
assert.equal(prepare.packageSha256, previousPrepare.packageSha256);
assert.deepEqual(prepare.sourceHashes, previousPrepare.sourceHashes);
assert.equal(audit.failure, undefined); assert.equal(audit.cleanupFailure, undefined);
assert.equal(audit.frozenAndPackedStable, true);
assert.deepEqual(audit.currentChangesDuringReplay, []);
assert.equal(audit.currentHttpMatchesOverlayBefore, true); assert.equal(audit.currentHttpMatchesOverlayAfter, true);
assert.equal(audit.cleanup.services.length, 4);
for (const service of audit.cleanup.services) {
  assert.equal(service.shutdown.code ?? service.shutdown.status, 0);
  assert.equal(service.shutdown.signal, null);
  for (const name of ["home", "data"]) assert.equal(existsSync(join(service.output, name)), false);
}
assert.equal(existsSync(audit.cleanup.binary.path), false);
const processRows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" }).split("\n");
const activeOwned = processRows.filter(row => row.includes(audit.scratch));
assert.deepEqual(activeOwned, []);
const signerVectors = publicReport.oracle.vectors;
assert.equal(Object.keys(signerVectors).length, 4);
const report = {
  verifiedAt: new Date().toISOString(), rawCounts, originalArtifactHashesVerified: Object.keys(originalHashes).length,
  frozenSourceBuildPackageAndFixturesStable: true, currentHttpMatchesFreeze: true,
  exactHandoffSourceAndPackageMatch: true, sourceFiles: Object.keys(prepare.sourceHashes).length,
  tarballSha256: prepare.packageSha256, originalArchiveSha256: prepare.archiveSha256,
  serviceCount: audit.cleanup.services.length, activeOwnedProcesses: activeOwned,
  allOwnedDataHomeAndBinaryAbsent: true, independentSignerVectors: signerVectors,
  driverSha256: hash(readFileSync(join(owned, "replay.mjs"))), verifierSha256: hash(readFileSync(join(owned, "verify.mjs"))),
  authorConsumersIdenticalToFrozenInputs: true,
  independentConsumerSourceSha256: hash(readFileSync(join(prepare.consumer, "public-workflow.mts"))),
  frozenIndependentConsumerSourceSha256: hash(readFileSync(join(prepare.source, "tests/fs/s3/http-independent/public-workflow.mts"))),
};
assert.equal(report.independentConsumerSourceSha256, report.frozenIndependentConsumerSourceSha256);
const output = join(evidence, "seal.json");
assert.equal(existsSync(output), false, "preserve the original seal");
const text = JSON.stringify(report, null, 2);
execFileSync("apply_patch", [], { input: `*** Begin Patch\n*** Add File: ${output}\n${text.split("\n").map(line => "+" + line).join("\n")}\n*** End Patch\n` });
console.log(text);
