import assert from "node:assert/strict";
import { test } from "node:test";
import { FsError } from "../../../../src/contracts/index.js";
import { JqError, JqLimitError } from "../../../../src/commands/structured/limits.js";
import { executeBytes } from "../independent-increment/harness.js";

for (const failure of [new FsError("EIO"), new JqError("host stderr"), new JqLimitError("maxSteps")]) {
  for (const failAt of [1, 2]) test(`fatal diagnostic ${failure.constructor.name} write ${failAt} preserves identity and stops`, async () => {
    let reads = 0;
    let closed = false;
    const writes: string[] = [];
    const stdin = (async function* () {
      try { reads++; yield Buffer.from('"[" "{\\"a\\":}"\n'); reads++; yield Buffer.from('"false"\n'); }
      finally { closed = true; }
    })();
    await assert.rejects(executeBytes(["-c", "fromjson"], stdin, {}, { stderr: { async write(bytes) {
      writes.push(Buffer.from(bytes).toString());
      if (writes.length === failAt) throw failure;
    } } }), error => error === failure);
    assert.equal(writes.length, failAt);
    assert.equal(reads, 1);
    assert.equal(closed, true);
  });
}
