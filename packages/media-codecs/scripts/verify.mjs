import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("sources.json", import.meta.url), "utf8"));
for (const entry of [...manifest.archives, ...manifest.inputs, manifest.artifact]) {
  const bytes = readFileSync(new URL(entry.path, root));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, `Codec artifact/input changed: ${entry.path}`);
  if (entry.bytes !== undefined) assert.equal(bytes.length, entry.bytes);
}
process.stdout.write("Verified portable codec sources and artifact\n");
