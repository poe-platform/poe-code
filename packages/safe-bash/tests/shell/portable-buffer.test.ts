import assert from "node:assert/strict";
import test from "node:test";
import { portableRuntime } from "../helpers/portable-runtime.js";

test("standalone shell installs Buffer before evaluating runtime modules", async () => {
  const native = Buffer;
  const { api: { Shell, MemoryFileSystem, CommandRegistry, createStandardCommands }, buffer: portable } = await portableRuntime(`
    export { Shell } from "./packages/safe-bash/src/shell/index.ts";
    export { MemoryFileSystem } from "./packages/safe-bash/src/fs/memory/index.ts";
    export { CommandRegistry } from "./packages/safe-bash/src/contracts/command.ts";
    export { createStandardCommands } from "./packages/safe-bash/src/commands/index.ts";
  `);
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createStandardCommands()) });
  try {
    const result = await shell.exec('printf -v x "%04d" 7', { limits: { maxExpansionBytes: 4096 } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }

  assert.ok(portable.from("abc") instanceof Uint8Array);
  for (const encoding of ["utf8", "latin1", "ascii", "hex", "base64", "utf16le"] as const) {
    const input = native.from([0, 65, 127, 128, 255, 195, 169, 0]);
    assert.equal(portable.from(input).toString(encoding), input.toString(encoding), encoding);
    assert.deepEqual([...portable.from(input.toString(encoding), encoding)], [...native.from(input.toString(encoding), encoding)], encoding);
    assert.equal(portable.byteLength(input.toString(encoding), encoding), native.byteLength(input.toString(encoding), encoding));
  }
  const value = portable.from("abcdef");
  assert.ok(portable.isBuffer(value));
  assert.equal(portable.isBuffer(new Uint8Array()), false);
  assert.equal(value.slice(1, 3).toString(), "bc");
  value.subarray(0, 1)[0] = 120;
  assert.equal(value.toString(), "xbcdef");
  assert.ok(value.equals(portable.from("xbcdef")));
  assert.equal(value.compare(portable.from("xbcdeg")), -1);
  assert.equal(portable.compare(value, portable.from("xbcdeg")), -1);
  assert.equal(portable.concat([value, portable.from("!")]).toString(), "xbcdef!");
  const destination = portable.alloc(8, 46);
  assert.equal(value.copy(destination, 1, 1, 4), 3);
  assert.equal(destination.toString(), ".bcd....");
  assert.equal(destination.write("é", 4, 2, "utf8"), 2);
  assert.equal(destination.subarray(4, 6).toString(), "é");
  assert.equal(portable.allocUnsafe(3).length, 3);
  const borrowed = portable.prototype as unknown as { utf8Slice(this: Uint8Array, start: number, end: number): string };
  assert.equal(borrowed.utf8Slice.call(new TextEncoder().encode("héllo"), 1, 3), "é");
  assert.equal(borrowed.utf8Slice.call(new TextEncoder().encode("\uFEFFhello"), 0, 8), "\uFEFFhello");
});

test("portable bootstrap preserves an existing native Buffer", async () => {
  const native = globalThis.Buffer;
  await import(new URL("../../src/portable-buffer.js?native", import.meta.url).href);
  assert.equal(globalThis.Buffer, native);
});
