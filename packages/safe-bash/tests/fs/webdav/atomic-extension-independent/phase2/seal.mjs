import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const own = dirname(import.meta.filename);
const checkpoint = JSON.parse(await readFile(join(own, "CHECKPOINT.json"), "utf8"));
assert.equal(checkpoint.independent26.failed, 0);
assert.equal(checkpoint.mutationControls.killed, 4);
assert.equal(checkpoint.cleanup.removed, true);
async function walk(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!entry.name.startsWith(".work-") && !["live.json", "control.json"].includes(entry.name), "live owned state remains");
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await walk(join(directory, entry.name), relative + "/"));
    else if (relative !== "ARTIFACTS.sha256") files.push(relative);
  }
  return files;
}
const records = [];
for (const path of (await walk(own)).sort()) {
  records.push(`${createHash("sha256").update(await readFile(join(own, path))).digest("hex")}  ${path}`);
}
await writeFile(join(own, "ARTIFACTS.sha256"), records.join("\n") + "\n");
console.log(`Sealed ${records.length} phase-two artifacts; no live owned state`);
