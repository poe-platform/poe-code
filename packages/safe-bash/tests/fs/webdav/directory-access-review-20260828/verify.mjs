import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { gunzipSync } from "node:zlib";

const bytes = Buffer.from(fs.readFileSync(new URL("observations-01.json.gz.base64", import.meta.url), "utf8"), "base64");
assert.equal(createHash("sha256").update(bytes).digest("hex"), "d6090214a7969816c339f4981c72b41b787686b36df9e115ec292b2a3435f283");
const data = JSON.parse(gunzipSync(bytes));
assert.equal(data.freezeCommit, "603ba3371736373316e419c2327bc68c4d96dba9");
assert.equal(data.failure, undefined);
assert.deepEqual(data.failures, []);
assert.equal(data.observations.length, 30);
assert.equal(data.observations.reduce((count, row) => count + row.outcomes.length, 0), 41);
assert.equal(data.observations.reduce((count, row) => count + row.requests.length, 0), 35);
assert.equal(data.observations.reduce((count, row) => count + row.shellsDisposed, 0), 2);
assert.equal(data.children, 1);
assert.equal(data.temporaryRemoved, true);
assert.equal(fs.existsSync(data.root), false);
assert.deepEqual(data.packageAfter, data.packageBefore);
assert.equal(Object.keys(data.packageBefore).length, 846);
assert.deepEqual(data.liveSourceAfter, data.freeze.source);
for (const row of data.observations) {
  assert.equal(row.matched, true, row.id);
  assert.ok(row.bodyLocksAfter.every(locked => !locked), row.id);
  for (const request of row.requests) {
    assert.equal(request.method, "PROPFIND", row.id);
    assert.equal(request.credentials, "omit", row.id);
    assert.equal(request.redirect, "manual", row.id);
    assert.equal(request.authorization, "Bearer synthetic-directory-review", row.id);
    assert.equal(request.cacheControl, "no-cache", row.id);
    assert.equal(request.signalPresent, true, row.id);
    assert.ok(request.url.startsWith("https://provider.invalid/dav/"), row.id);
  }
  if (row.cd) assert.deepEqual(row.cd, { stdout: "/folder\n", stderr: "", exitCode: 0 });
}
const row = id => data.observations.find(value => value.id === id);
assert.deepEqual(row("P02").outcomes.map(value => value.value ?? value.code), ["directory", "EACCES"]);
assert.deepEqual(row("P03").outcomes.map(value => value.value ?? value.code), ["directory", "EACCES"]);
assert.equal(row("P16").requests.length, 0);
assert.deepEqual(row("P16").outcomes.map(value => value.code), ["ECANCELED", "ENOTSUP"]);
for (const id of ["P17", "P18"]) assert.equal(row(id).outcomes[0].exactCause, true, id);
for (const id of ["P17", "P19"]) {
  assert.equal(row(id).lateDeliveries, 1, id);
  assert.equal(row(id).bodyCancels, 1, id);
}
assert.equal(row("P18").bodyPulls, 1);
assert.equal(row("P18").bodyCancels, 1);
assert.equal(row("P30").bodyPulls, 2);
assert.equal(row("P30").outcomes[0].exactCause, true);
console.log("Stored baseline verified: 30/30 profiles, 41 outcomes, 35 injected protocol requests; no new X_OK implementation or real-service acceptance. Sources/846 packed entries unchanged; children, fixture timers, Shells and task root closed.");
