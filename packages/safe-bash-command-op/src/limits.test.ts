import assert from "node:assert/strict";
import test from "node:test";
import { createOpCommand, type OpLimits } from "./index.js";

test("op validates configured limits and accepts unlimited defaults", () => {
  const limits: Partial<OpLimits> = { maxInputBytes: 1 };
  assert.doesNotThrow(() => createOpCommand({ limits }));
  assert.doesNotThrow(() => createOpCommand({ limits: { maxInputBytes: Infinity } }));
  for (const value of [0, -1, NaN, 1.5, -Infinity]) {
    assert.throws(() => createOpCommand({ limits: { maxInputBytes: value } }), RangeError);
  }
});

test("op rejects oversized piped input before calling the backend", async () => {
  let called = false;
  const errors: Uint8Array[] = [];
  const command = createOpCommand({
    limits: { maxInputBytes: 3 },
    backend: { execute: async () => { called = true; return []; } },
  });
  const result = await command.execute({
    args: ["item", "list"], env: {}, signal: new AbortController().signal,
    stdin: (async function* () { yield new TextEncoder().encode("1234"); })(),
    stdout: { write: async () => {} }, stderr: { write: async chunk => { errors.push(chunk); } },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(called, false);
  assert.match(Buffer.concat(errors).toString(), /input exceeds maximum size of 3 bytes/);
});
