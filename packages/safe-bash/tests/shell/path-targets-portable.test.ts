import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { PathLookup, pathTargets } from "../../src/shell/path-lookup.js";

test("PATH admission counts UTF-8 bytes without a Buffer global", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  Object.defineProperty(globalThis, "Buffer", { configurable: true, value: undefined });
  try {
    const signal = new AbortController().signal;
    const limits = { maxExpansionBytes: 5, maxExpansionFields: 4, maxPathComponents: 4 };
    const fail = (limit: string): never => { throw new Error(limit); };
    assert.deepEqual([...pathTargets("tool", "/é", limits, signal, fail)], ["/é/tool"]);
    assert.throws(() => [...pathTargets("tool", "/ééé", limits, signal, fail)], /maxExpansionBytes/);
    assert.deepEqual([...pathTargets("tool", "\ud800", limits, signal, fail)], ["\ud800/tool"]);
  } finally {
    Object.defineProperty(globalThis, "Buffer", descriptor);
  }
});

test("PATH cache accounting does not invoke Node byte counting", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/é", new Uint8Array());
  context.mock.method(Buffer, "byteLength", () => { throw new Error("Node byte counting unavailable"); });
  const lookup = new PathLookup();
  const signal = new AbortController().signal;
  assert.equal(await lookup.isFile(fs, "/é", signal), true);
  await fs.unlink("/é");
  assert.equal(await lookup.isFile(fs, "/é", signal), true);
  lookup.invalidateSync();
  assert.equal(await lookup.isFile(fs, "/é", signal), false);
});
