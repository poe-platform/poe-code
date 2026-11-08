import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createOutputOperation, type CommandContext } from "safe-bash-contracts";
import { Budget, Lifecycle, Reader, readEncoding, settings } from "./index.js";

for (const [bytes, bom, tail, error] of [
  [[239, 187, 191, 65], "utf8", [65], false],
  [[255, 254, 65, 0], "le", [65, 0], false],
  [[254, 255, 0, 65], "be", [0, 65], false],
  [[132, 49, 149, 51, 65], "gb", [65], false],
  [[239, 187], "bytes", [], true],
  [[65, 13, 10], "bytes", [65, 13, 10], false],
] as const) {
  test(`detects ${bom} across individual byte chunks: ${bytes}`, async () => {
    const context: CommandContext = {
      command: "dos2unix", args: [], fs: new MemoryFileSystem(), cwd: "/", env: {},
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { for (const value of bytes) yield Uint8Array.of(value); } },
      stdout: { async write() {} }, stderr: { async write() {} },
    };
    const output = createOutputOperation(context, context.stdout);
    const admission = { closed: false };
    const life = new Lifecycle(new Budget(context, settings({}), output.signal, context.signal, admission), output, context.stdout, context.signal, admission);
    try {
      const reader = new Reader(life);
      await reader.open();
      const detected = await readEncoding(reader);
      assert.equal(detected.bom, bom);
      assert.equal(detected.error, error);
      const remaining: number[] = [];
      for (let byte = await detected.byte(); byte !== -1; byte = await detected.byte()) remaining.push(byte);
      assert.deepEqual(remaining, tail);
    } finally { await output.close(); }
  });
}
