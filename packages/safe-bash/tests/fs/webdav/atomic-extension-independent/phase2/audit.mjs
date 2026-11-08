import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const own = dirname(import.meta.filename);
const repo = resolve(own, "../../../../..");
const evidence = join(own, "evidence/real-provider");
const json = async name => JSON.parse(await readFile(join(evidence, name), "utf8"));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const baseline = await json("baseline.json");
const cleanup = await json("cleanup.json");
const commands = await json("commands.json");
const original = await json("author-replay/summary.json");
const authorCheckpoint = JSON.parse(await readFile(join(evidence, "inputs/CHECKPOINT.json.txt"), "utf8"));
const qualified = await json("independent-qualified/summary.json");
const rows = await json("independent-qualified/rows.json");
assert.equal(baseline.source, "d1174e2db9f4a4c92403842dee6fb3d4ff57ec96");
assert.equal(baseline.author, "a5f7d236b40446468ffa739ce8d26b172ed8e5d2");
assert.equal(hash(gunzipSync(await readFile(join(evidence, "inputs/source.tar.gz")))), baseline.sourceArchiveSha256);
for (const [name, expected] of Object.entries(baseline.fixtureHashes)) {
  assert.equal(hash(await readFile(join(evidence, "inputs", `${name}.txt`))), expected);
  const frozen = execFileSync("git", ["show", `${baseline.author}:tests/fs/webdav/atomic-extension/${name}`], { cwd: repo });
  assert.equal(hash(frozen), expected);
  assert.equal(hash(await readFile(join(repo, "tests/fs/webdav/atomic-extension", name))), expected);
}
for (const [name, expected] of Object.entries(authorCheckpoint.artifacts)) {
  assert.equal(hash(await readFile(join(repo, "tests/fs/webdav/atomic-extension", name))), expected);
}
const compilerHash = hash(await readFile(join(repo, "node_modules/typescript/lib/_tsc.js")));
assert.equal(compilerHash, authorCheckpoint.compilerSha256);
assert.equal(JSON.parse(await readFile(join(repo, "node_modules/typescript/package.json"), "utf8")).version, authorCheckpoint.typescriptVersion);
const prior = (await readFile(join(own, "../ARTIFACTS.sha256"), "utf8")).trim().split("\n");
for (const line of prior) {
  const [expected, path] = line.split("  ");
  assert.equal(hash(await readFile(join(own, "..", path))), expected);
}
assert.deepEqual(original.totals, { positive: { pass: 4, fail: 0 }, guard: { pass: 12, fail: 0 }, refusal: { pass: 2, fail: 0 } });
assert.equal(original.rows, 18); assert.equal(original.retainedLocks, 0);
assert.equal(qualified.rows, 30); assert.equal(qualified.retainedLocks, 0); assert.deepEqual(qualified.cleanupErrors, []);
assert.deepEqual(qualified.totals, { positive: { pass: 8, killed: 0, fail: 0 }, guard: { pass: 17, killed: 0, fail: 0 },
  refusal: { pass: 1, killed: 0, fail: 0 }, mutation: { pass: 0, killed: 4, fail: 0 } });
assert.ok(rows.every(row => row.result === (row.kind === "mutation" ? "killed" : "pass")));
const failedCommands = commands.filter(command => command.status !== 0);
assert.deepEqual(failedCommands.map(command => command.name), ["independent-first"]);
const firstRows = await json("independent-first/rows.json");
assert.deepEqual(firstRows.filter(row => row.result === "fail").map(row => row.name), [
  "real handler checks precede native empty-only call, no recursive visitation",
  "wrong operation/path/namespace/Host/query refuse before native effect",
]);
assert.ok(firstRows[0].trace.some(entry => entry.event === "base-descendants" && entry.method === "PROPFIND"));
assert.ok(!firstRows[0].trace.some(entry => entry.event === "base-descendants" && entry.method === "DELETE"));
assert.match(firstRows.find(row => row.name.startsWith("wrong operation")).error.message, /ERR_TLS_CERT_ALTNAME_INVALID/u);
const unchangedExample = commands.find(command => command.name === "author-standalone-unchanged");
assert.equal(unchangedExample.status, 0);
assert.equal(JSON.parse(unchangedExample.stdout).stdout, "atomic cleanup complete\n");
const provider = (await readFile(join(evidence, "author-replay/provider.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
assert.ok(!provider.some(entry => entry.event === "FORBIDDEN-descendant-visitation"));
for (const path of ["/nonempty/", "/late-child/"]) {
  assert.deepEqual(provider.filter(entry => entry.path === path && ["native-rmdir", "native-error", "native-removed"].includes(entry.event))
    .map(entry => [entry.event, entry.code]), [["native-rmdir", undefined], ["native-error", "ENOTEMPTY"]]);
}
const sourceProfile = await json("service-inspection.json");
assert.deepEqual(sourceProfile.versions, { WsgiDAV: "4.3.5", cheroot: "11.1.2" });
const pythonClosure = await json("instrumented-service/python-closure.json");
for (const [name, observation] of Object.entries(sourceProfile.modules)) {
  assert.equal(hash(await readFile(join(evidence, "installed-source", `${name}.py.txt`))), observation.sha256);
  assert.equal(pythonClosure[name].sha256, observation.sha256);
}
const comparisons = await json("primary-wheel-comparison.json");
assert.ok(comparisons.every(entry => entry.equalBytes === false && entry.equalAfterCRLFNormalization === true));
const downloads = await json("downloads.json");
assert.equal(downloads.reduce((total, item) => total + item.bytes, 0), 1769458);
const artifactLock = JSON.parse(await readFile(join(evidence, "inputs/dependencies.json.txt"), "utf8"));
assert.deepEqual(downloads.map(({ bytes, ...item }) => item), artifactLock);
const packageBytes = await readFile(join(evidence, "virtual-bash-0.0.0.tgz"));
assert.equal(hash(packageBytes), "78461169565ceb3da674d881bf983b7a50832cd57fb7ff1bbaf68db43c46b937");
const packageMetadata = await json("package.json");
assert.notEqual(packageMetadata.consumerPackage.name, "virtual-bash");
const temporary = await mkdtemp(join(own, ".work-audit-"));
try {
  execFileSync("tar", ["xf", join(evidence, "virtual-bash-0.0.0.tgz"), "-C", temporary]);
  const authorClosure = await json("author-replay/closure.json");
  for (const name of ["author-replay", "independent-first", "independent-qualified"]) {
    const closure = await json(`${name}/closure.json`);
    assert.equal(closure.loaded, 157);
    assert.equal(closure.matchesBuiltAndExtractedBytes, true);
    assert.deepEqual(closure.modules, authorClosure.modules);
    for (const [path, expected] of Object.entries(closure.modules)) {
      assert.equal(hash(await readFile(join(temporary, "package", path))), expected);
    }
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
for (const row of rows.filter(row => row.kind !== "mutation")) {
  assert.ok(!row.trace.some(entry => entry.event === "base-descendants" && entry.method === "DELETE"));
  assert.ok(!row.trace.some(entry => entry.event.startsWith("MUTATION-")));
}
const target = rows.find(row => row.name.startsWith("contending target LOCK"));
assert.ok(target.trace.find(entry => entry.event === "os.rmdir-error").seq < target.trace.find(entry => entry.event === "manager-acquire-return").seq);
const expiry = rows.find(row => row.name.startsWith("actual expiry and new parent"));
assert.ok(expiry.trace.find(entry => entry.event === "os.rmdir-return").seq < expiry.trace.filter(entry => entry.event === "manager-acquire-return").at(-1).seq);
for (const action of ["refresh", "unlock"]) {
  const row = rows.find(row => row.name.startsWith(`real ${action} waits`));
  assert.ok(row.trace.find(entry => entry.event === "os.rmdir-return").seq < row.trace.find(entry => entry.event === `manager-${action === "refresh" ? "refresh" : "release"}-enter`).seq);
}
for (const name of ["native nonempty preserves exact binary bytes", "late native membership bypasses provider mutex but survives os.rmdir",
  "actual descendant lock fails before native call, binary child intact", "contending target LOCK reaches provider but cannot grant before native failure"]) {
  assert.ok(Object.values(rows.find(row => row.name === name).after).some(entry => entry.hex === "00ff80410d0a"));
}
assert.equal((await json("post-live.json")).actualInfiniteDepthLockDiscoveryEmpty, true);
assert.equal((await json("final-lock-discovery.json")).status, 207);
assert.equal(cleanup.failure, undefined); assert.equal(cleanup.removed, true);
assert.equal(cleanup.children.length, 2);
assert.ok(cleanup.children.every(child => child.code === 0 && child.signal === null));
assert.equal(await stat(cleanup.workspace).then(() => true, error => error.code === "ENOENT" ? false : Promise.reject(error)), false);
const report = {
  source: baseline.source, author: baseline.author, initialReview: baseline.initialReview,
  decision: "accept bounded configured stable single-provider profile on measured pinned service; not stock or universal support",
  originalAuthor18: original.totals, independent26: { positive: 8, guard: 17, refusal: 1, failed: 0 },
  mutationControls: { killed: 4, survived: 0, includedInNormalPassTotals: false },
  unchangedStandaloneExamplePassed: true, actualLoadedPackageModules: 157, actualLoadedPythonSiteModules: Object.keys(pythonClosure).length,
  actualManagerSerializationMeasured: ["target acquire after native ENOTEMPTY", "expiry and parent acquire after native success", "refresh", "UNLOCK", "DAV PUT membership"],
  actualFinalLockDiscoveryEmpty: true, configuredProfileNoDeleteRecursion: true, nativeChildHex: "00ff80410d0a",
  originalStock78of79Unchanged: true, sourceDefectsReproduced: [], verifierFailuresPreserved: 2,
  phase1ArtifactHashesUnchanged: prior.length, singleDevEnvironment: true, downloadedWheelBytes: 1769458,
  originalAuthorArtifactHashesUnchanged: Object.keys(authorCheckpoint.artifacts).length,
  compiler: { version: authorCheckpoint.typescriptVersion, sha256: compilerHash },
  originalAuthorFixturesByteIdentical: true, isolatedPackageSha256: hash(packageBytes), cleanup,
};
await writeFile(join(own, "CHECKPOINT.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
