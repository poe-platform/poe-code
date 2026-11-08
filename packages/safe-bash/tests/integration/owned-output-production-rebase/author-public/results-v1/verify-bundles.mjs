import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { json, regular, sha256 } from "../harness/common.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const manifest = json(join(root, "RAW-INVENTORY.json"));
let checked = 0;
for (const entry of manifest.bundles) {
  const compressed = Buffer.from(regular(join(root, entry.path)).toString().replace(/\s/gu, ""), "base64");
  assert.equal(sha256(compressed), entry.gzipSha256);
  const bytes = gunzipSync(compressed);
  assert.equal(bytes.length, entry.bundleJsonBytes);
  assert.equal(sha256(bytes), entry.bundleJsonSha256);
  const bundle = JSON.parse(bytes);
  assert.equal(bundle.files.length, entry.files);
  for (const file of bundle.files) {
    const expected = manifest.artifacts.find(candidate => candidate.bundle === entry.name && candidate.path === file.path);
    assert.ok(expected);
    const actual = Buffer.from(file.base64, "base64");
    assert.equal(actual.length, expected.bytes);
    assert.equal(sha256(actual), expected.sha256);
    assert.equal(sha256(actual), file.sha256);
    checked += 1;
  }
}
assert.equal(checked, manifest.artifacts.length);
console.log(JSON.stringify({ status: "ALL_RAW_BYTES_VERIFIED", bundles: manifest.bundles.length, artifacts: checked, candidateExecutions: 0, privateQueries: 0 }));
