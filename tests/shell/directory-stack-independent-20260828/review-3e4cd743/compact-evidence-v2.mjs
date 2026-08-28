import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
const root = dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const previousBytes = readFileSync(resolve(root, "EVIDENCE-v1.json.gz.base64"));
const previous = JSON.parse(gunzipSync(Buffer.from(previousBytes.toString(), "base64")));
const nodes = [], known = new Map();
function intern(value) {
  const node = Array.isArray(value) ? { array: value.map(intern) } : value && typeof value === "object" ? { object: Object.entries(value).map(([key, child]) => [key, intern(child)]) } : value;
  const key = JSON.stringify(node), found = known.get(key);
  if (found !== undefined) return found;
  const index = nodes.length; nodes.push(node); known.set(key, index); return index;
}
function restore(index) {
  const node = nodes[index];
  return node && typeof node === "object" ? node.array ? node.array.map(restore) : Object.fromEntries(node.object.map(([key, value]) => [key, restore(value)])) : node;
}
const files = previous.files.map(({ text, ...entry }) => {
  let format = "text", value = text;
  try { const parsed = JSON.parse(text); if (JSON.stringify(parsed) === text) { format = "json"; value = parsed; } else if (JSON.stringify(parsed, null, 2) + "\n" === text) { format = "json2-newline"; value = parsed; } } catch {}
  if (format === "text" && text.endsWith("\n") && entry.path.endsWith(".jsonl")) { const parsed = text.trimEnd().split("\n").filter(Boolean).map(line => JSON.parse(line)); if (parsed.map(line => JSON.stringify(line)).join("\n") + (parsed.length ? "\n" : "") === text) { format = "jsonl"; value = parsed; } }
  const index = intern(value), restored = restore(index);
  const roundTrip = format === "json" ? JSON.stringify(restored) : format === "json2-newline" ? JSON.stringify(restored, null, 2) + "\n" : format === "jsonl" ? restored.map(line => JSON.stringify(line)).join("\n") + (restored.length ? "\n" : "") : restored;
  assert.equal(roundTrip, text); assert.equal(sha(roundTrip), entry.sha256);
  return { ...entry, format, index };
});
const archive = { version: 2, role: "lossless structural deduplication of complete v1 raw/config bytes, not reduced observations", files, nodes };
const bytes = gzipSync(JSON.stringify(archive), { level: 9 }).toString("base64").match(/.{1,120}/g).join("\n") + "\n";
const manifest = { version: 2, path: "EVIDENCE-v2.json.gz.base64", bytes: Buffer.byteLength(bytes), sha256: sha(bytes), files: files.length, nodes: nodes.length, supersedesUncommittedEncoding: { path: "EVIDENCE-v1.json.gz.base64", bytes: previousBytes.length, sha256: sha(previousBytes), removal: "only redundant uncommitted serialization removed after1124 exact byte roundtrips; original rawfiles retained until authenticated cleanup" } };
execFileSync("apply_patch", [], { maxBuffer: 64 * 1024 * 1024, input: "*** Begin Patch\n*** Add File: " + resolve(root, manifest.path) + "\n" + bytes.trimEnd().split("\n").map(line => "+" + line).join("\n") + "\n*** Add File: " + resolve(root, "EVIDENCE-MANIFEST-v2.json") + "\n" + JSON.stringify(manifest, null, 2).split("\n").map(line => "+" + line).join("\n") + "\n*** Delete File: " + resolve(root, "EVIDENCE-v1.json.gz.base64") + "\n*** End Patch\n" });
process.stdout.write(JSON.stringify(manifest) + "\n");
