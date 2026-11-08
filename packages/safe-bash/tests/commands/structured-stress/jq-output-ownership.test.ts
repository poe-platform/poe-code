import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import type { ByteSource } from "../../../src/contracts/index.js";
import { execute } from "./harness.js";

test("jq output chunks remain owned after later chunks and invocations", async () => {
  const retained: Uint8Array[] = [];
  const input: ByteSource = { async *[Symbol.asyncIterator]() {
    yield Buffer.from('{"value":"first"}\n');
    yield Buffer.from('{"value":"second"}\n');
  } };
  const result = await execute(["-c", "."], input, {}, { stdout: { async write(bytes) { retained.push(bytes); } } });
  assert.equal(result.status, 0);
  assert.equal((await execute(["-c", "."], '{"value":"overwrite"}')).status, 0);
  assert.deepEqual(retained.map(bytes => Buffer.from(bytes).toString()), ['{"value":"first"}\n', '{"value":"second"}\n']);
});

for (const reason of [undefined, null, false, 0, "", new Error("capacity sink failure")]) {
  test(`jq capacity flush awaits failing sink and preserves reason ${String(reason)}`, async () => {
    let writes = 0;
    let diagnostics = 0;
    const first = "a".repeat(40000);
    const second = "b".repeat(40000);
    const outcome = await execute(["-r", "."], `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`, {
      limits: { maxSteps: 2000000, maxOutputBytes: 100000 },
    }, {
      stdout: { async write(bytes) {
        writes++;
        const original = Buffer.from(bytes);
        await setImmediate();
        assert.ok(Buffer.from(bytes).equals(original), "pending sink bytes changed");
        throw reason;
      } },
      stderr: { async write() { diagnostics++; } },
    }).then(() => ({ ok: true as const }), error => ({ ok: false as const, error }));
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.error, reason);
    assert.equal(writes, 1);
    assert.equal(diagnostics, 0);
  });
}
