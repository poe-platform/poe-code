import assert from "node:assert/strict";
import test from "node:test";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { createColumnCommand } from "./index.js";

test("private column owns execution and accepts canonical runtime contracts", async () => {
  const chunks: Uint8Array[] = [];
  const context = {
    command: "column", args: ["-t"], cwd: "/", env: {}, fs: {},
    signal: new AbortController().signal, stdin: toByteSource("a 1\nlong 2\n"),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Uint8Array.from(bytes)); } },
    stderr: { async write() { assert.fail("unexpected diagnostic"); } },
  } as unknown as CommandContext;
  assert.equal((await createColumnCommand().execute(context)).exitCode, 0);
  assert.equal(Buffer.concat(chunks).toString(), "a     1\nlong  2\n");
  assert.throws(() => createColumnCommand({ limits: { maxRows: 0 } }), RangeError);
});

test("column and its shared readers execute without the Node Buffer global", async () => {
  const original = globalThis.Buffer;
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const context = { command: "column", args: ["-t"], cwd: "/", env: {}, fs: {},
    signal: new AbortController().signal, stdin: toByteSource("a 1\n"),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } },
  } as unknown as CommandContext;
  try {
    Reflect.deleteProperty(globalThis, "Buffer");
    assert.equal((await createColumnCommand().execute(context)).exitCode, 0);
    assert.equal(output.map(bytes => new TextDecoder().decode(bytes)).join(""), "a  1\n");
    assert.equal(errors.length, 0);
  } finally { globalThis.Buffer = original; }
});
