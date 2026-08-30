import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const base = new URL("./evidence-v1/", import.meta.url);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(readFileSync(new URL("MANIFEST.json", base)));
const compressed = Buffer.from(readFileSync(new URL("RAW.json.gz.base64", base), "utf8"), "base64");
assert.equal(digest(compressed), manifest.compressedSha256);
const payload = gunzipSync(compressed); assert.equal(payload.length, manifest.payloadBytes); assert.equal(digest(payload), manifest.payloadSha256);
const entries = JSON.parse(payload).entries, decoded = new Map(); assert.equal(entries.length, manifest.entries.length);
for (const [index, entry] of entries.entries()) {
  const { base64, ...metadata } = entry, bytes = Buffer.from(base64, "base64");
  assert.deepEqual(metadata, manifest.entries[index]); assert.equal(digest(bytes), entry.sha256); assert.equal(bytes.length, entry.bytes);
  assert.equal(decoded.has(entry.name), false); decoded.set(entry.name, bytes);
}
const final = JSON.parse(decoded.get("final/REPORT.json")), failed = JSON.parse(decoded.get("setup-failed/REPORT.json"));
assert.equal(final.candidate, "e422ad06b3470477b7f9323c89289d2963a00407"); assert.equal(final.candidate, manifest.candidate);
assert.equal(final.baseline, manifest.baseline); assert.equal(final.status, "pass"); assert.deepEqual(final.failures, []);
assert.equal(failed.status, "fail"); assert.ok(failed.failures.length > 0);
assert.equal(final.commands.length, 6); assert.equal(final.checks.length, 19); assert.ok(final.checks.every(row => row.status === "pass"));
for (const command of final.commands) {
  const row = JSON.parse(decoded.get(`final/${command.name}.json`));
  assert.equal(row.status, row.expected); assert.equal(row.signal, null); assert.equal(row.error, undefined);
  assert.deepEqual(row.beforeInventory, row.afterInventory); assert.equal(row.inputs.length, 13);
  assert.equal(row.counts.skipped, 0); assert.equal(row.counts.todo, 0); assert.equal(row.counts.cancelled, 0);
  for (const child of row.children) { assert.equal(child.executable, row.executable); assert.equal(child.version, final.versions.find(tool => tool.executable === row.executable).version); }
  if (command.name.startsWith("candidate-")) assert.deepEqual(row.counts, { tests: 8, pass: 8, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  if (command.name === "baseline-node24") { assert.equal(row.counts.pass, 7); assert.equal(row.counts.fail, 1); assert.match(row.stdout, /input did not match the regular expression/u); }
  if (command.name.startsWith("remove-")) { assert.equal(row.counts.fail, 1); assert.match(row.stdout, /input did not match the regular expression/u); assert.doesNotMatch(row.stdout, /double-loading config/u); }
}
assert.match(JSON.parse(decoded.get("setup-failed/candidate-node24.json")).stdout, /double-loading config/u);
const types = JSON.parse(decoded.get("final/scoped-types.json"));
assert.equal(types.status, 0); assert.equal(types.signal, null); assert.equal(types.stdout, ""); assert.equal(types.stderr, "");
assert.equal(types.before, types.after); assert.equal(types.before, final.fixtureMapping.afterSha256);
assert.deepEqual(final.fixtureMapping, manifest.fixtureMapping);
assert.equal(digest(readFileSync(new URL("./replay.mjs", import.meta.url))), digest(decoded.get("final/supervisor.mjs")));
console.log(JSON.stringify({ candidate: final.candidate, baseline: final.baseline, captures: entries.length, authorChecks: 19, currentNode22: "8/8", currentNode24: "8/8", unchangedNode24: "7/8", removedReporterControls: "2 detected", scope: "saved scoped author evidence integrity, not independent acceptance" }));
