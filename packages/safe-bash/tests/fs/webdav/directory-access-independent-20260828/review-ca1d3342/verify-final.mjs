import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const own = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(own, "FINAL-MANIFEST.json")));
const expected = new Set([""]);
for (const filename of [...Object.keys(manifest.files), "FINAL-MANIFEST.json"]) {
  let parent = path.dirname(filename);
  while (parent !== ".") { expected.add(parent); parent = path.dirname(parent); }
}
const actual = new Set([""]);
function visit(root, prefix) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), "review symlink addition refused");
    if (entry.isDirectory()) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      actual.add(name); visit(path.join(root, entry.name), name);
    }
  }
}
visit(own, "");
assert.deepEqual([...actual].sort(), [...expected].sort(), "review directory additions/removals including empty directories");
await import("./verify.mjs");
