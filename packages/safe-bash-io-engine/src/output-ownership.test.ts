import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type CommandContext } from "safe-bash-contracts";
import { output, outputRange } from "./internal.js";

function capture() {
  const chunks: Uint8Array[] = [];
  const stdout = { async write(chunk: Uint8Array) { chunks.push(chunk); }, writeSync(chunk: Uint8Array) { chunks.push(chunk); return true; } };
  const context: CommandContext = {
    command: "test", args: [], cwd: "/", env: {}, fs: createMemoryFileSystem(),
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout,
    stderr: { async write() { assert.fail("unexpected diagnostic"); } },
  };
  return { context, chunks, stdout };
}

for (const buffer of [false, true]) test(`outputRange gives retaining synchronous sinks owned bytes (Buffer=${buffer})`, async () => {
  const { context, chunks } = capture();
  const bytes = new TextEncoder().encode("hello trailing");
  const scratch = buffer ? Buffer.from(bytes) : bytes;
  await outputRange(context, scratch, 5);
  scratch.set(new TextEncoder().encode("world"));
  await outputRange(context, scratch, 5);
  scratch.fill(0);
  assert.equal(Buffer.concat(chunks).toString(), "helloworld");
});

test("small string output survives subsequent and reentrant synchronous writes", async () => {
  const first = capture();
  const second = capture();
  first.stdout.writeSync = chunk => {
    first.chunks.push(chunk);
    void output(second.context, "999\n");
    return true;
  };
  await output(first.context, "123\n");
  await output(second.context, "456\n");
  assert.equal(Buffer.concat(first.chunks).toString(), "123\n");
  assert.equal(Buffer.concat(second.chunks).toString(), "999\n456\n");
});

test("small string output survives reentrant synchronous range writes", async () => {
  const { context } = capture();
  const outputs: string[] = [];
  let nested = false;
  Object.assign(context.stdout, {
    writeRangeSync(bytes: Uint8Array, length: number) {
      if (!nested) {
        nested = true;
        void output(context, "tenant-B");
      }
      outputs.push(new TextDecoder().decode(bytes.subarray(0, length)));
      return true;
    },
  });
  await output(context, "tenant-A");
  assert.deepEqual(outputs, ["tenant-B", "tenant-A"]);
});
