import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const owned = dirname(fileURLToPath(import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const originals = JSON.parse(readFileSync(join(owned, "original-identities.json")));
const audit = JSON.parse(readFileSync(join(owned, "delta-audit.json")));
const main = JSON.parse(readFileSync(join(owned, "RESULT.json")));
const supplement = JSON.parse(readFileSync(join(owned, "SUPPLEMENT.json")));
const proof = JSON.parse(readFileSync(join(owned, "native-product.json")));
const archive = JSON.parse(readFileSync(join(owned, "evidence-archive.json")));
for (const [path, hash] of Object.entries(originals.original237)) assert.equal(digest(readFileSync(path)), hash, path);
for (const [path, hash] of Object.entries(audit.editorHashes)) assert.equal(digest(readFileSync(path)), hash, path);
const discovered = ["tests/commands/diff-patch", "tests/commands/diff-patch-stress"].flatMap(root => readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith(".test.ts")).map(entry => join(entry.parentPath, entry.name))).sort();
assert.deepEqual(discovered, originals.original70);
let rawBytes = 0;
for (const [name, entry] of Object.entries(archive.files)) {
  const bytes = gunzipSync(Buffer.from(entry.gzipBase64, "base64"));
  assert.equal(bytes.length, entry.bytes, name);
  assert.equal(digest(bytes), entry.sha256, name);
  rawBytes += bytes.length;
}
assert.equal(main.originalRawExitCode, 1);
assert.equal(main.revisedRawExitCode, 0);
assert.equal(main.original.pass, 3750);
assert.equal(main.original.fail, 8);
assert.equal(main.revised.pass, 3758);
assert.equal(main.revised.fail, 0);
assert.equal(supplement.status, 0);
assert.equal(main.sourceBefore, main.sourceAfter);
assert.equal(main.sourceAfter, supplement.before.source);
assert.deepEqual(supplement.before, supplement.after);
assert.equal(main.dependenciesBefore, main.dependenciesAfter);
assert.equal(main.dependenciesAfter, supplement.before.dependencies);
assert.equal(proof.product.length, 11);
assert.equal(proof.observations.length, 18);
const pruned = proof.product.filter(record => record.fixture.kind === "empty");
assert.equal(pruned.length, 6);
for (const record of pruned) {
  assert.equal(record.before["/fixture"].nlink, 4);
  assert.equal(record.after["/fixture"].nlink, 3);
  assert.deepEqual(record.mutations.map(({ method, path }) => ({ method, path })), [{ method: "rm", path: "/fixture/authorized/target" }, { method: "rmdir", path: "/fixture/authorized" }]);
}
assert.equal(main.independentNativeProduct, 1, "initial failed observation is preserved, not overwritten");
assert.equal(main.scopedNoEmit, 0);
assert.equal(main.wholeNoEmit, 2);
assert.equal(main.snapshotBuild, 2);
assert.equal(main.publicFixture, 0);
const record = { checkedAt: new Date().toISOString(), original237: 237, original70: discovered.length, editor11Unchanged: true, archivedMembers: Object.keys(archive.files).length, archiveRawBytes: rawBytes, archiveSha256: digest(readFileSync(join(owned, "evidence-archive.json"))), finalNativeProductSha256: digest(readFileSync(join(owned, "native-product.json"))), deltaAuditSha256: digest(readFileSync(join(owned, "delta-audit.json"))), fullCounts: { original: main.original, revised: main.revised }, source: main.sourceAfter, dependencies: main.dependenciesAfter, finalSupplementStatus: supplement.status, initialFailedProbePreserved: true, broaderValidationGreen: false };
writeFileSync(join(owned, "ARTIFACT-CHECK.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record, null, 2));
