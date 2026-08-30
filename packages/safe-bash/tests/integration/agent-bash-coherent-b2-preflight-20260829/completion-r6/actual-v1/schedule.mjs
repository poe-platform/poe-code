import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const base = path.dirname(root);
assert.ok(fs.fstatSync(1).isFile() && fs.fstatSync(2).isFile());
const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function read(filename, expected) {
  const before = fs.lstatSync(filename);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 2097152);
  assert.equal(before.size, expected.bytes);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.ino, before.ino); assert.equal(opened.dev, before.dev);
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(descriptor, bytes, offset, Math.min(65536, bytes.length - offset), offset); assert.ok(count > 0); offset += count; }
    const after = fs.fstatSync(descriptor);
    assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(sha(bytes), expected.sha256);
    return bytes;
  } finally { fs.closeSync(descriptor); }
}
async function tool(row) {
  const before = fs.lstatSync(row.path);
  assert.ok(before.isFile() && !before.isSymbolicLink()); assert.equal(before.size, row.bytes);
  const hash = crypto.createHash("sha256"); let count = 0;
  for await (const bytes of fs.createReadStream(row.path, { highWaterMark: 65536 })) { count += bytes.length; assert.ok(count <= row.bytes); hash.update(bytes); }
  const after = fs.lstatSync(row.path);
  assert.equal(after.ino, before.ino); assert.equal(after.dev, before.dev); assert.equal(after.mtimeMs, before.mtimeMs); assert.equal(count, row.bytes); assert.equal(hash.digest("hex"), row.sha256);
}
function absent(filename) {
  try { fs.lstatSync(filename); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error(`exclusive runtime path already exists: ${filename}`);
}
const seal = JSON.parse(fs.readFileSync(path.join(root, "SCHEDULING-PRESEAL.json")));
read(fileURLToPath(import.meta.url), seal.scheduler);
const grantBytes = read("/private/tmp/B2-R6-ROOT-GO.json", { bytes: 1009, sha256: "c002da2a04caa6486b7c60fe4ece42a81fe9b28115ef35585ab19d3e998bd7b7" });
assert.equal(fs.statSync("/private/tmp/B2-R6-ROOT-GO.json").mode & 511, 384);
const grant = JSON.parse(grantBytes);
assert.equal(grant.notBefore, "2026-08-29T15:15:12.109Z");
const anchor = Date.parse(grant.notBefore), latest = Date.parse("2026-08-29T15:20:12.109Z");
const entered = Date.now(); assert.ok(entered <= latest);
console.log(JSON.stringify({ phase: "scheduled", entered: new Date(entered).toISOString(), notBefore: grant.notBefore, oneTimer: true, runtimeLaunched: false }));
if (entered < anchor) await new Promise(resolve => setTimeout(resolve, anchor - entered));
assert.ok(Date.now() >= anchor && Date.now() <= latest);
const packet = JSON.parse(read(path.join(base, "staged/PACKET.json"), { bytes: 6222, sha256: "a2a5a6a23f4c30bd490b3a1db29f0cdc6e4e57a4f179ba0368489af7652fb554" }));
for (const row of packet.files) read(path.join(base, "staged", row.path), row);
const binding = JSON.parse(read(path.join(base, "final-binding-v1/BINDING.json"), seal.binding));
for (const row of binding.consumedPins) read(row.filename, row);
for (const row of binding.tools) await tool(row);
read("/private/tmp/B2-R6-ROOT-GO.json", { bytes: 1009, sha256: "c002da2a04caa6486b7c60fe4ece42a81fe9b28115ef35585ab19d3e998bd7b7" });
absent(grant.workRoot); absent(grant.workRoot + ".outer.raw");
const ready = Date.now(); assert.ok(ready >= anchor && ready <= latest);
const result = { status: "READY_FOR_EXACT_ONE_DISPATCH", entered: new Date(entered).toISOString(), ready: new Date(ready).toISOString(), schedulerMilliseconds: ready - entered,
  remainingActiveMilliseconds: Date.parse(grant.activeDeadline) - ready, remainingInclusiveMilliseconds: Date.parse(grant.deadline) - ready,
  packetMembersAuthenticated: packet.files.length, consumedPins: binding.consumedPins.length, tools: binding.tools.length,
  unusedRuntimeRoot: true, unusedRuntimeCapture: true, runtimeLaunched: false, children: 0, sourceCodeChanges: false };
const bytes = Buffer.from(JSON.stringify(result, null, 2) + "\n");
const output = fs.openSync(path.join(root, "DISPATCH-READY.json"), "wx", 0o600);
try { let offset = 0; while (offset < bytes.length) { const count = fs.writeSync(output, bytes, offset, bytes.length - offset); assert.ok(count > 0); offset += count; } fs.fsyncSync(output); }
finally { fs.closeSync(output); }
console.log(JSON.stringify(result));
