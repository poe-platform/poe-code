import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { own, inventory, pack, unpack, write, save, hash, originalFreeze, liveProtected } from "./common.mjs";

const root = path.join(own, "scratch");
assert.equal(fs.realpathSync(root), root);
assert.equal(path.dirname(root), own);
const binding = JSON.parse(fs.readFileSync(path.join(own, "BINDING.json")));
assert.deepEqual(liveProtected(), binding.liveBefore);
assert.deepEqual(originalFreeze(), binding.originalFreeze);
const audit = unpack(path.join(own, "AUDIT.json.gz"));
assert.equal(audit.children.watchdogTerminations, 0);
assert.equal(audit.children.natural, audit.children.total);
for (const result of Object.values(audit.layouts)) {
  assert.equal(result.pass, 102); assert.equal(result.fail, 0); assert.equal(result.blocked, 0);
}
const before = inventory(root);
const toolLogs = {};
for (const name of Object.keys(before).filter(name => name.startsWith("cache/_logs/"))) toolLogs[name] = {
  ...before[name], base64: fs.readFileSync(path.join(root, name)).toString("base64"),
};
write(path.join(own, "TOOL-LOGS.json.gz"), pack(toolLogs));
const proofPath = path.join(own, "SCRATCH-INVENTORY.json.gz");
write(proofPath, pack({ enumeratedAt: new Date().toISOString(), root, entries: before, includesAdditions: true,
  qualification: "all regular files including tools, copies, caches and mutants; not unique allocation/RSS" }));
const descriptor = fs.openSync(proofPath, "r");
try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
assert.deepEqual(unpack(proofPath).entries, inventory(root));
const entryCount = Object.keys(before).length;
const bytes = Object.values(before).reduce((sum, record) => sum + record.bytes, 0);
fs.rmSync(root, { recursive: true });
assert.equal(fs.existsSync(root), false);
assert.deepEqual(liveProtected(), binding.liveBefore);
assert.deepEqual(originalFreeze(), binding.originalFreeze);
save("CLEANUP.json", { removedAt: new Date().toISOString(), removedRoot: root,
  inventoryFile: "SCRATCH-INVENTORY.json.gz", inventorySha256: hash(fs.readFileSync(proofPath)),
  entries: entryCount, logicalBytes: bytes, inventoryAuthenticatedBeforeRemoval: true,
  membershipCheckIncludedNewEntries: true, scratchAbsent: true, originalSevenPreserved: true,
  liveScopePreserved: true, subprocesses: audit.children, noServiceOrSocketCreatedByHarness: true,
  qualification: "nineteen captured validation children naturally exited; Git plumbing and preparation parent commands separately qualified; no arbitrary host preemption guarantee" });
console.log(JSON.stringify({ removed: root, entries: entryCount, logicalBytes: bytes, durableInventory: true }));
