import assert from "node:assert/strict";
import test from "node:test";
import { outputFailure, type ByteSink } from "./io.js";
import { createOutputOperation } from "./output.js";
import * as fileOutput from "./filesystem-output-budget.js";

for (const frozen of [false, true]) {
  test(`shared file output enforces its bound budget with frozen cleanup=${frozen}`, async () => {
    const context = { signal: new AbortController().signal,
      registerCleanup: frozen ? Object.freeze(() => {}) : () => {} };
    const refused = new Error("file output limit");
    const writes: Uint8Array[] = [];
    fileOutput.bindFileOutputBudget(context, destination => ({ async write(bytes) {
      if (bytes.length > 2) throw refused;
      await destination.write(bytes);
    } }));
    await fileOutput.writeFileOutput(context, new Uint8Array([1, 2]), async bytes => { writes.push(bytes); });
    await assert.rejects(fileOutput.writeFileOutput(context, new Uint8Array([1, 2, 3]), async bytes => { writes.push(bytes); }), error => error === refused);
    assert.deepEqual(writes, [new Uint8Array([1, 2])]);
  });
}

test("shared file output drains an admitted host write before preserving cancellation", async () => {
  const controller = new AbortController();
  const context = { signal: controller.signal, registerCleanup() {} };
  const host = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const retired = new Error("sink cancelled");
  let settled = false;
  fileOutput.bindFileOutputBudget(context, destination => ({ async write(bytes) {
    void destination.write(bytes);
    controller.abort(false);
    throw retired;
  } }));
  const writing = fileOutput.writeFileOutput(context, new Uint8Array([1]), async () => {
    started.resolve();
    await host.promise;
  });
  const outcome = assert.rejects(writing, error => error === false).then(() => { settled = true; });
  await started.promise;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  host.resolve();
  await outcome;
  assert.equal(settled, true);
});

for (const reason of [false, 0, undefined, new Error("source failed")]) {
  test(`output failure forwarding preserves its destination and reason: ${String(reason)}`, async () => {
    const seen: unknown[] = [];
    const destination: ByteSink = {
      async write() {},
      async [outputFailure](failure) {
        assert.equal(this, destination);
        seen.push(failure);
        throw failure;
      },
    };
    const operation = createOutputOperation({ signal: new AbortController().signal }, destination);
    try {
      await assert.rejects(operation.output[outputFailure]!(reason), failure => Object.is(failure, reason));
      assert.deepEqual(seen, [reason]);
    } finally { await operation.close(); }
  });
}
