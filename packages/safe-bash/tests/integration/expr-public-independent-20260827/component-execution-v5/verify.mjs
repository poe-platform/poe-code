import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, lstatSync } from "node:fs";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { directory, owner, json, read, digest, objectHash } from "./common.mjs";
import { git } from "./auth.mjs";
import { fileHash } from "./evidence.mjs";

const commit = process.argv[2]; assert.match(commit ?? "", /^[a-f0-9]{40}$/u);
const seal = json(join(directory, "EVIDENCE-SEAL.json")), manifest = json(join(directory, "MANIFEST.json"));
const paths = [...seal.artifacts.map(row => row.path), "EVIDENCE-SEAL.json"];
for (const path of paths) {
  const bytes = read(join(directory, path));
  assert.ok(git("ls-tree", commit, "--", `${owner}/component-execution-v5/${path}`).toString().includes(objectHash(bytes)), path);
}
for (const row of seal.artifacts) {
  assert.deepEqual(await fileHash(join(directory, row.path)), { bytes: row.bytes, sha256: row.sha256 });
  assert.equal(lstatSync(join(directory, row.path)).mode & 0o777, row.mode);
}
assert.deepEqual(await fileHash(join(directory, manifest.archive.path)), { bytes: manifest.archive.bytes, sha256: manifest.archive.sha256 });
const archive = createReadStream(join(directory, manifest.archive.path), { highWaterMark: 65536 }).pipe(createGunzip({ chunkSize: 65536 }));
let incomplete = "", current, bytes = 0, total = 0, entries = 0, hash;
for await (const chunk of archive) {
  const text = incomplete + chunk.toString("utf8"), lines = text.split("\n"); incomplete = lines.pop();
  assert.ok(incomplete.length <= 100000);
  for (const line of lines) {
    assert.ok(line.length <= 100000); const row = JSON.parse(line);
    if (row.kind === "file") { assert.equal(current, undefined); current = row; bytes = 0; hash = createHash("sha256"); }
    else if (row.kind === "chunk") {
      assert.ok(current); const value = Buffer.from(row.base64, "base64"); assert.ok(value.length <= 65536); bytes += value.length; total += value.length; assert.ok(total <= 2147483648); hash.update(value);
    } else {
      assert.equal(row.kind, "end"); assert.ok(current); assert.equal(row.path, current.path); assert.equal(bytes, current.bytes); assert.equal(row.bytes, bytes); assert.equal(row.sha256, hash.digest("hex"));
      const { kind, ...entry } = row; assert.deepEqual(entry, manifest.entries[entries]); entries++; current = undefined;
    }
  }
}
assert.equal(incomplete, ""); assert.equal(current, undefined); assert.equal(entries, manifest.entries.length); assert.equal(total, manifest.totalRawBytes);
const report = json(join(directory, "REPORT.json")); assert.deepEqual(report.counts, manifest.counts); assert.deepEqual(report.counts, seal.counts);
console.log(JSON.stringify({ status: "authenticated-read-only", evidenceCommit: commit, recipeCommit: seal.recipeCommit, manifestSha256: digest(read(join(directory, "MANIFEST.json"))), sealSha256: digest(read(join(directory, "EVIDENCE-SEAL.json"))), rawEntries: entries, rawBytes: total, committedArtifacts: paths.length, counts: report.counts, outerExit: seal.outer.exitCode }));
