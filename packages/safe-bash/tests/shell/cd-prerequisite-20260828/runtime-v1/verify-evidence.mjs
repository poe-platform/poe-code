import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";

const own = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(own, "../../../..");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const read = name => JSON.parse(gunzipSync(Buffer.from(fs.readFileSync(path.join(own, `${name}.json.gz.base64`), "utf8"), "base64")));
const source = "4641075df5355a91c83bf5b2cc3a88dfaf1f5153";
const hash = "93c06908aec9d5d61d801657f99ab75122cadb6688f038e1941c587b4a8d4ed3";
const history = [
  ["baseline-01", 18, 69], ["baseline-02", 39, 48], ["baseline-03", 39, 48],
  ["candidate-01", 48, 39], ["candidate-02", 86, 1], ["candidate-03", 87, 0], ["candidate-04", 87, 0],
];
for (const [name, pass, fail] of history) {
  const data = read(name);
  const result = data.commands.find(record => record.name === "focused source and preserved native mapping");
  assert.equal(result.counts.tests, 87);
  assert.equal(result.counts.pass, pass);
  assert.equal(result.counts.fail, fail);
  assert.equal(data.temporaryRemoved, true);
  assert.equal(fs.existsSync(data.root), false);
  assert.equal(data.sourceStable, true);
  assert.ok(data.commands.every(record => record.signal === null && record.error === null));
  for (const fixture of Object.values(data.authorInputs)) assert.equal(digest(Buffer.from(fixture.base64, "base64")), fixture.sha256);
  if (data.package) {
    assert.equal(digest(Buffer.from(data.package.base64, "base64")), data.package.sha256);
    assert.equal(data.package.sha256, "06ea635b201a1296268adaa452a2419682f92ec93906cb9083e327dc69f85914");
    assert.equal(data.runtimeSha256, hash);
  }
}
const final = read("candidate-04");
assert.equal(final.candidate, source);
assert.equal(final.inputs.length, 292);
assert.equal(final.unchangedRuntimeMembers.length, 58);
assert.equal(final.builtinOutsideCdUnchanged, true);
assert.equal(final.newGnu53NativeRuns, 0);
assert.equal(Object.keys(final.packageInventory).length, 846);
const refs = final.inputs.map(input => `${input.name === "src/shell/runtime.ts" ? source : input.commit}:${input.name}`).join("\n") + "\n";
const result = spawnSync("git", ["cat-file", "--batch"], { cwd: repository, input: refs, maxBuffer: 64 * 1024 * 1024 });
assert.equal(result.status, 0);
let cursor = 0;
for (const input of final.inputs) {
  const end = result.stdout.indexOf(10, cursor);
  const header = result.stdout.subarray(cursor, end).toString().split(" ");
  assert.equal(header[1], "blob");
  const length = Number(header[2]);
  assert.equal(digest(result.stdout.subarray(end + 1, end + 1 + length)), input.sha256, input.name);
  cursor = end + 2 + length;
}
assert.equal(cursor, result.stdout.length);
for (const [name, fixture] of Object.entries(final.authorInputs)) assert.equal(digest(fs.readFileSync(path.join(own, name))), fixture.sha256, name);
for (const layout of final.layouts) {
  assert.equal(layout.status, 0);
  assert.equal(layout.typesStatus, 0);
  assert.equal(new Set(layout.loads.map(load => load.relative)).size, 207);
  for (const load of layout.loads) assert.equal(load.sha256, final.packageInventory[load.relative]?.sha256);
}
for (const command of final.commands) {
  assert.equal(command.status, command.expectedRejection ? 1 : 0, command.name);
  if (command.expectedRejection) assert.match(command.stderr, /Changed product load: dist\/shell\/runtime.js/);
}
for (const [name, count] of [["selected existing shell regressions", 239], ["accepted owned-output regressions", 42]]) {
  const record = final.commands.find(command => command.name === name);
  assert.deepEqual(record.counts, { tests: count, pass: count, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
}
assert.equal(digest(fs.readFileSync(path.join(own, "../observations-01.json.gz.base64"))), final.nativeEvidenceFileSha256);
console.log(JSON.stringify({ verified: true, candidate: source, runtimeSha256: hash, inputs: final.inputs.length,
  history: history.map(([capture, pass, fail]) => ({ capture, pass, fail })), layouts: final.layouts.map(layout => ({ name: layout.layout, modules: 207 })),
  cleanupRoots: history.length, productExecuted: false, differentReview: "pending" }));
