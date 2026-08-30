import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const manifestFile = resolve(directory, "MANIFEST.json");
function inventory(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const filename = resolve(folder, entry.name);
    if (filename === manifestFile) return [];
    if (entry.isDirectory()) return inventory(filename);
    assert.ok(entry.isFile(), `Unexpected non-file entry: ${filename}`);
    const content = readFileSync(filename);
    return [{ file: relative(directory, filename), bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") }];
  }).sort((left, right) => left.file.localeCompare(right.file));
}
const observed = inventory(directory);
if (process.argv[2] === "--seal") {
  writeFileSync(manifestFile, `${JSON.stringify({ sealedAt: new Date().toISOString(), sourceCommit: "ec59c917ba137126a064960995b5fc6945ea8f6d", scope: "Exact author-directory recursive inventory, excluding MANIFEST.json itself", files: observed }, null, 2)}\n`, { flag: "wx" });
} else {
  assert.equal(process.argv[2], undefined);
  const expected = JSON.parse(readFileSync(manifestFile, "utf8"));
  assert.deepEqual(observed, expected.files);
}
console.log(JSON.stringify({ evidenceFiles: observed.length, exactInventory: true, sha256Verified: true }));
