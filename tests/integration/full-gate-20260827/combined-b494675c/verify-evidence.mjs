import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const root = new URL("./", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("EVIDENCE_MANIFEST.json", root)));
const decoded = new Map();
for (const record of manifest.captures) {
  const stored = readFileSync(new URL(record.path, root));
  assert.equal(hash(stored), record.storedSha256, record.path);
  const bytes = record.encoding === "gzip-base64" ? gunzipSync(Buffer.from(stored.toString().trim(), "base64")) : stored;
  assert.equal(bytes.length, record.originalBytes, record.path);
  assert.equal(hash(bytes), record.originalSha256, record.path);
  decoded.set(record.key, bytes);
}
const accounting = JSON.parse(decoded.get("canonical/test.accounting.json"));
const routing = JSON.parse(readFileSync(new URL("FAILURE_ROUTING.json", root)));
const skips = JSON.parse(readFileSync(new URL("SKIPS.json", root)));
assert.deepEqual(accounting.counts, { pass: 16520, fail: 307, skipped: 13, todo: 0, cancelled: 0 });
assert.equal(accounting.reconciled, true);
assert.equal(routing.failures.length, 307);
assert.equal(new Set(routing.failures.map(row => row.id)).size, 307);
assert.deepEqual(routing.failures.map(row => row.id), accounting.nonpassing.filter(row => row.status === "fail").map(row => row.id));
assert.deepEqual(skips.rows, accounting.skips);
assert.equal(skips.rows.length, 13);
for (const file of manifest.authored) assert.equal(hash(readFileSync(new URL(file.path, root))), file.sha256, file.path);
console.log(JSON.stringify({ status: "evidence-authenticated-not-product-acceptance", captures: manifest.captures.length, failures: routing.failures.length, skips: skips.rows.length }));
