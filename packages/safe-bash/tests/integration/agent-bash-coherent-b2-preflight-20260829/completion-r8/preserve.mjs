import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { publishOwnedCopy } from "./publication.mjs";
import { sampleTree } from "./staged/new/cache-census.mjs";
const scope = path.dirname(fileURLToPath(import.meta.url));
const capture = "/private/tmp/safe-bash-b2-r8-preparation";
const work = "/private/tmp/safe-bash-b2-r8-controls";
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
assert.ok(fs.fstatSync(1).isFile() && fs.fstatSync(2).isFile());
assert.ok(Date.now() < Date.parse("2026-08-29T16:16:47.949Z"));
const seal = JSON.parse(fs.readFileSync(path.join(scope, "PRESEAL.json")));
for (const row of seal.files) { const filename = path.join(scope, row.path); const stat = fs.lstatSync(filename); assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.equal(stat.size, row.bytes); assert.equal(hash(fs.readFileSync(filename)), row.sha256); }
const result = JSON.parse(fs.readFileSync(path.join(work, "RESULT.json")));
assert.equal(result.status, "PASS"); assert.equal(result.controls.length, 8); assert.equal(result.children.length, 2);
for (const child of result.children) { assert.equal(child.exited, true); assert.equal(child.closed, true); assert.equal(child.exitCode, 0); assert.equal(child.closeCode, 0); assert.equal(child.signals.length, 0); }
const files = []; let retained = 0;
function preserve(root, prefix) {
  for (const name of fs.readdirSync(root).sort()) {
    if (prefix === "administration" && name.startsWith("preserve.")) continue;
    const filename = path.join(root, name); const relative = prefix + "/" + name; const stat = fs.lstatSync(filename);
    if (stat.isDirectory()) { preserve(filename, relative); continue; }
    assert.ok(stat.isFile() && !stat.isSymbolicLink()); assert.ok(stat.size <= 1048576);
    const body = fs.readFileSync(filename); const expected = { bytes: body.length, sha256: hash(body) }; retained += body.length; assert.ok(retained <= 16777216);
    const receipt = publishOwnedCopy(filename, path.join(scope, "evidence", relative), expected, path.join(scope, "evidence")); files.push(receipt);
  }
}
preserve(capture, "administration"); preserve(work, "controls");
const before = JSON.parse(fs.readFileSync(path.join(scope, "ORIGIN.json")));
const packet = JSON.parse(fs.readFileSync(path.join(scope, "staged/PACKET.json")));
for (const row of before.files.filter(row => row.path.startsWith("legacy/") || row.path.startsWith("metadata/"))) { const next = packet.files.find(next => next.path === row.path); assert.equal(next.sha256, row.sha256); assert.equal(next.bytes, row.bytes); }
const frozen = JSON.parse(fs.readFileSync(path.join(scope, "staged/metadata/FROZEN-BINDINGS.json")));
const packageLogicalBytes = frozen.packageMembers.reduce((sum, row) => sum + row.bytes, 0);
const census = sampleTree([scope, capture, work], { maximumBytes: 268435456, maximumEntries: 4096 });
const output = { status: "AUTHOR_CONTROLS_PASS_RUNTIME_POLICY_PENDING", recorded: new Date().toISOString(), controls: result.controls, children: result.children, observedSnapshotRaces: result.children.reduce((sum, row) => sum + row.snapshotRaces, 0), allKnownChildrenExitCloseZero: true, rawCopies: files, rawCopiedBytes: retained, logicalOwnedSnapshot: { bytes: census.bytes, entries: census.entries, gitInternalStorageExcluded: true }, unchangedLegacyAndMetadata: true, packageLogicalBytes, packageLogicalBytesNotNpmCacheUpperBound: true, reservationProposal: 134217728, sourceDerivedCacheUpperBound: "NOT_ESTABLISHED", rootDecisionRequired: "Best-effort trusted native-tool boundary OR stronger source-bound/quota design; current packet explicitly refuses absent acknowledgement", runtime: "UNRUN", npmInstall: 0, product: 0, workers: 0, compiler: 0 };
fs.writeFileSync(path.join(scope, "EVIDENCE.json"), JSON.stringify(output, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ status: output.status, races: output.observedSnapshotRaces, rawCopiedBytes: retained, logicalBytes: census.bytes, packageLogicalBytes, sha256: hash(fs.readFileSync(path.join(scope, "EVIDENCE.json"))) }));
