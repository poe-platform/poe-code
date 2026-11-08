import assert from "node:assert/strict";
import test from "node:test";
import { createOp, createOpCommand, type OpCommandOptions, type OpLimits } from "./index.js";

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

test("op validates maxBytes even when another input limit is configured", () => {
  for (const create of [createOp, createOpCommand]) {
    assert.doesNotThrow(() => create({ maxBytes: Infinity }));
    for (const maxBytes of [0, -1, NaN, 1.5, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => create({ maxBytes, limits: { maxInputBytes: 3 } }), { name: "RangeError", message: "Invalid op limit: maxBytes" });
    }
  }
});

for (const create of [createOp, createOpCommand]) {
  for (const args of [["item", "list"], ["item", "create", "-"], ["item", "edit", "existing"]]) {
    test(`${create.name} enforces maxBytes on ${args.join(" ")} at the byte boundary`, async () => {
      const input = new TextEncoder().encode('{"title":"é"}');
      for (const maxBytes of [input.byteLength - 1, input.byteLength, Infinity]) {
        let calls = 0;
        const errors: Uint8Array[] = [];
        const command = create({ maxBytes, backend: { async execute(request) {
          calls++;
          assert.deepEqual(request.input, { title: "é" });
          return [];
        } } });
        const result = await command.execute({
          args, env: {}, signal: new AbortController().signal,
          stdin: (async function* () { yield input.subarray(0, 3); yield input.subarray(3); })(),
          stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes); } },
        });
        const rejected = maxBytes < input.byteLength;
        assert.equal(result.exitCode, rejected ? 1 : 0, Buffer.concat(errors).toString());
        assert.equal(calls, rejected ? 0 : 1);
        assert.equal(Buffer.concat(errors).toString(), rejected ? `op: input exceeds maximum size of ${maxBytes} bytes\n` : "");
      }
    });
  }
}

test("op honors the stricter input limit when maxBytes and limits are both supplied", async () => {
  for (const options of [
    { maxBytes: 3, limits: { maxInputBytes: Infinity } },
    { maxBytes: Infinity, limits: { maxInputBytes: 3 } },
  ] satisfies OpCommandOptions[]) {
    const errors: Uint8Array[] = [];
    const result = await createOp({ ...options, backend: { async execute() { assert.fail("oversized input must not reach the backend"); } } }).execute({
      args: ["item", "list"], env: {}, signal: new AbortController().signal,
      stdin: (async function* () { yield new TextEncoder().encode("1234"); })(),
      stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes); } },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(Buffer.concat(errors).toString(), "op: input exceeds maximum size of 3 bytes\n");
  }
});
