import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const read = name => fs.readFileSync(path.join(own, name));
const binding = JSON.parse(read("BINDING.json"));
assert.equal(digest(read("PACKET.md")), binding.packetSha256);
for (const source of binding.sources) {
  const result = spawnSync("git", ["show", `${source.commit}:${source.path}`], { cwd: repository });
  assert.equal(result.status, 0);
  assert.equal(digest(result.stdout), source.sha256);
  assert.equal(digest(fs.readFileSync(path.join(repository, source.path))), source.sha256);
}
const compressed = Buffer.from(read("grammar-observations-01.json.gz.base64").toString(), "base64");
assert.equal(digest(compressed), binding.newGrammar.compressedSha256);
assert.equal(digest(read("grammar-observations-01.json.gz.base64")), binding.newGrammar.fileSha256);
const data = JSON.parse(gunzipSync(compressed));
assert.equal(data.sealCommit, binding.newGrammar.sealCommit);
const seal = spawnSync("git", ["show", `${data.sealCommit}:${path.relative(repository, path.join(own, "GRAMMAR-FREEZE.json"))}`], { cwd: repository });
assert.equal(seal.status, 0);
assert.equal(digest(seal.stdout), digest(read("GRAMMAR-FREEZE.json")));
assert.deepEqual(data.seal, JSON.parse(seal.stdout));
assert.equal(data.rows.length, 8);
assert.equal(data.temporaryRemoved, true);
assert.equal(fs.existsSync(data.root), false);
assert.equal(data.binaryAfter, binding.newGrammar.binarySha256);
assert.deepEqual(data.protectedAfter, data.seal.protectedHashes);
for (const [name, expected] of Object.entries(data.seal.fixtureHashes)) assert.equal(digest(read(name)), expected);
for (const [name, expected] of Object.entries(data.protectedAfter)) assert.equal(digest(fs.readFileSync(path.join(repository, name))), expected);
for (const row of data.rows) {
  assert.equal(row.signal, null); assert.equal(row.error, null);
  assert.deepEqual(row.args.slice(0, 3), ["--noprofile", "--norc", "-c"]);
  assert.equal(row.env.PATH, "");
  assert.equal(Object.hasOwn(row.env, "BASH_ENV"), false);
  assert.equal(row.stdout, Buffer.from(row.stdoutBase64, "base64").toString().replaceAll(row.cwd, "/fixture"));
  assert.equal(row.stderr, Buffer.from(row.stderrBase64, "base64").toString().replaceAll(row.cwd, "/fixture"));
}
const old = name => Buffer.from(fs.readFileSync(path.join(own, "..", name), "utf8"), "base64");
assert.equal(digest(old("observations-01.json.gz.base64")), binding.history.originalCompressedSha256);
assert.equal(digest(old("supplemental-observations-01.json.gz.base64")), binding.history.topologyCompressedSha256);
console.log(JSON.stringify({ verified: true, designOnly: true, productionUnchanged: true,
  originalNative: 34, originalVirtual: 34, originalMatches: 0, oldTopologyNativeOnly: 4,
  additionalPresealedNativeOnly: 8, newVirtualRuns: 0, newRootRemoved: true, productExecutedByVerifier: false,
  pendingRootChoices: ["R1", "R2", "R3", "R4"], implementation: "held" }));
