import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyProfile as verifyLifecycle } from "../lifecycle/profile.mjs";

const load = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
export function verifyProfile() {
  const lifecycle = verifyLifecycle();
  const base = load("../lifecycle/CASES.json");
  const controls = load("./CASES.json");
  assert.deepEqual(controls.defaultSafeJsLimits, base.defaultSafeJsLimits);
  assert.deepEqual(controls.containment, base.containment);
  assert.deepEqual(controls.commonInputs, base.commonInputs);
  assert.deepEqual(controls.errors, base.errors);
  assert.deepEqual(controls.curlInputs, base.curlInputs);
  assert.deepEqual(controls.executionOrder, ["Z01-open", "Z01-closed", "Z02-open", "Z02-closed", "Z03-open", "Z03-closed"]);
  assert.deepEqual(controls.rows.map(row => row.id), controls.executionOrder);
  assert.equal(controls.executionRows, 6); assert.equal(controls.logicalWorkflows, 1);
  assert.deepEqual(controls.rows.map(row => row.expect.curlStatus), [0, 141, 22, 22, 47, 47]);
  for (const row of controls.rows) {
    assert.equal(row.workflow, "L06"); assert.equal(row.route, "shell-module");
    assert.equal(row.guest, "guests/curl.ajs.data"); assert.deepEqual(row.guestArgs, []);
    assert.deepEqual(row.curlInputs.limits, base.curlInputs.limits);
    assert.deepEqual(row.curlInputs.uploadChunksHex, base.curlInputs.uploadChunksHex);
    assert.deepEqual(row.curlInputs.responseChunksHex, base.curlInputs.responseChunksHex);
    assert.equal(row.curlInputs.authorizedUrl, base.curlInputs.authorizedUrl);
    assert.equal(row.curlInputs.method, "PUT");
    assert.equal(row.expect.uploadSourceStarts, 1); assert.equal(row.expect.retryDelay1000msRequests, 0);
    if (row.closeCurlConsumer) {
      assert.equal(row.requiresPositive, "Z01-open");
      assert.equal(row.requiresMatchedOpen, row.id.replace("closed", "open"));
      assert.equal(row.expect.writeoutAccountedCalls, 0);
    } else assert.equal(row.expect.writeoutAccountedCalls, 1);
    if (row.curlInputs.responseStatus !== 200) {
      assert.equal(row.curlInputs.requiredFiles["/work/body.bin"], row.initialFiles["/work/body.bin"]);
      assert.equal(row.expect.responseBodyStarts, 0); assert.equal(row.expect.responseBodyChunks, 0);
    }
  }
  return { lifecycle, rows: 6, publicControls: "source-derived expectations, not execution results", noPromotion: true };
}
