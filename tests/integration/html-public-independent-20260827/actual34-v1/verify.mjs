import assert from "node:assert/strict";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { fileHash, git, here, inventory, parse, repository, sha256 } from "./common.mjs";
const [commit] = process.argv.slice(2);
assert.equal(process.argv.length, 3); assert.match(commit, /^[a-f0-9]{40}$/u);
const evidence = parse(join(here, "EVIDENCE-MANIFEST.json"));
const actual = inventory(here);
const manifestHash = actual["EVIDENCE-MANIFEST.json"]; delete actual["EVIDENCE-MANIFEST.json"];
assert.deepEqual(actual, evidence.files);
const committedPaths = git(["ls-tree", "-r", "--name-only", commit, "--", relative(repository, here)]).toString().trim().split("\n").map(path => relative(here, join(repository, path))).sort();
assert.deepEqual(committedPaths, [...Object.keys(evidence.files), "EVIDENCE-MANIFEST.json"].sort());
for (const [path, expected] of Object.entries({ ...evidence.files, "EVIDENCE-MANIFEST.json": manifestHash })) assert.equal(sha256(git(["show", `${commit}:${relative(repository, join(here, path))}`])), expected, path);
const pin = parse(join(here, "PREAUTH.json"));
for (const [path, row] of Object.entries(pin.protectedFiles)) assert.equal(fileHash(join(repository, path)), row.sha256, path);
for (const [name, tool] of Object.entries(pin.tools)) {
  const hash = ["typescript", "nodeTypes", "undiciTypes", "npmRoot"].includes(name) ? sha256(JSON.stringify(inventory(tool.path))) : fileHash(tool.path);
  assert.equal(hash, tool.sha256, name);
}
const raw = parse(join(here, "RAW-INVENTORY.json"));
const pending = new Map(raw.files.map(row => [row.path, row]));
let count = 0, bytes = 0, outcome;
for await (const line of createInterface({ input: createReadStream(join(here, "captures.jsonl.gz")).pipe(createGunzip()), crlfDelay: Infinity })) {
  const row = JSON.parse(line), expected = pending.get(row.path); assert.ok(expected, row.path);
  const decoded = Buffer.from(row.base64, "base64"); assert.equal(decoded.length, expected.bytes); assert.equal(sha256(decoded), expected.sha256);
  if (row.path === "execution-01/RESULT.json") outcome = JSON.parse(decoded);
  pending.delete(row.path); count++; bytes += decoded.length;
}
assert.equal(pending.size, 0); assert.equal(bytes, raw.bytes); assert.equal(count, 478);
assert.equal(outcome.status, "FROZEN_ASSERTIONS_PASSED_WITH_ORIGINAL_UNSCORED_LIMITS");
assert.deepEqual(outcome.counts, parse(join(here, "SUMMARY.json")).counts);
assert.equal(outcome.commands.length, 88); assert.equal(outcome.unexpected.length, 0);
assert.equal(existsSync(join(here, "node_modules")), false);
console.log(JSON.stringify({ status: "COMMITTED_EVIDENCE_VERIFIED", commit, evidenceManifestSha256: manifestHash, capturedFiles: count, capturedBytes: bytes, counts: outcome.counts, protectedFiles: Object.keys(pin.protectedFiles).length, productExecuted: false }));
