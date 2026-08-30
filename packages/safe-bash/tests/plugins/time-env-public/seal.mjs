import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = new URL("./", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("MANIFEST.json", root), "utf8"));
for (const entry of manifest.files) {
  const actual = createHash("sha256").update(readFileSync(new URL(entry.path, root))).digest("hex");
  assert.equal(actual, entry.sha256, entry.path);
}
console.log(JSON.stringify({ files: manifest.files.length, status: "sealed-bytes-match", sourceCommit: manifest.sourceCommit }));
