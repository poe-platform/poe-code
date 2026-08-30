import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const own = dirname(fileURLToPath(import.meta.url));
const evidence = join(own, "evidence-v1");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(readFileSync(join(evidence, "MANIFEST.json")));
const preservation = JSON.parse(readFileSync(join(evidence, "PRESERVATION.json")));
const compressed = Buffer.from(readFileSync(join(evidence, "RAW.json.gz.base64"), "utf8").trim(), "base64");
assert.equal(hash(compressed), manifest.compressedSHA256);
const raw = gunzipSync(compressed, { maxOutputLength: manifest.rawBytes });
assert.equal(raw.length, manifest.rawBytes);
assert.equal(hash(raw), manifest.rawSHA256);
const capture = JSON.parse(raw);
assert.equal(capture.candidate, manifest.candidate);
assert.equal(preservation.candidate, manifest.candidate);
assert.deepEqual(Object.keys(capture.files), Object.keys(manifest.files));
for (const [path, expected] of Object.entries(manifest.files)) {
  const bytes = Buffer.from(capture.files[path].base64, "base64");
  assert.equal(bytes.length, expected.bytes, path);
  assert.equal(hash(bytes), expected.sha256, path);
}
for (const [path, digest] of Object.entries(preservation.sourceAfter)) {
  const bytes = execFileSync("git", ["show", manifest.candidate + ":" + path], { cwd: resolve(own, "../../../.."), env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  assert.equal(hash(bytes), digest, path);
}
assert.equal(preservation.runtime.pass, 83);
assert.equal(preservation.core.pass, 505);
assert.equal(preservation.state.pass, 203);
assert.equal(preservation.authorOwnedOutput.pass, 42);
assert.equal(preservation.authorReplayIndependentHoldouts.passed, 36);
assert.equal(preservation.movedPublic.actualProfiles.length, 9);
assert.equal(preservation.safejs.filter(row => row.status === "AUTHOR_COHORT_PASS").reduce((sum, row) => sum + row.counts.pass, 0), 25);
assert(preservation.safejs.every(row => row.liveChildren.length === 0));
console.log(JSON.stringify({ candidate: manifest.candidate, capturedFiles: Object.keys(manifest.files).length, evidenceIntegrity: "PASS", qualification: "Sealed author evidence integrity, not rerun or independent runtime acceptance" }));
