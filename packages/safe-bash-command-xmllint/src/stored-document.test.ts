import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createXmllintCommand } from "./index.js";

for (const cancel of [false, true]) test(`XML formatting uses injected paged storage and retires it (cancel=${cancel})`, async () => {
  const fs = createMemoryFileSystem(), controller = new AbortController(), failure = new Error("sink stopped");
  let opened = 0, closed = 0, written = 0, output = 0, outstanding = 0;
  const injected = new Proxy(fs, { get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => assert.fail("document must use bounded descriptor I/O");
    if (key === "open") return async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args); opened++;
      return new Proxy(handle, { get(descriptor, member) {
        if (member === "write") return async (...values: Parameters<typeof handle.write>) => {
          assert.ok(values[0].byteLength <= 16384);
          outstanding += values[0].byteLength;
          assert.ok(outstanding <= 16384, "only one storage page may be awaiting write");
          try { await Promise.resolve(); written += values[0].byteLength; return await handle.write(...values); }
          finally { outstanding -= values[0].byteLength; }
        };
        if (member === "read") return async (...values: Parameters<typeof handle.read>) => {
          assert.ok(values[0].byteLength <= 16384);
          return handle.read(...values);
        };
        if (member === "close") return async (...values: Parameters<typeof handle.close>) => { closed++; return handle.close(...values); };
        const value = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const payload = "a".repeat(16384), encoder = new TextEncoder();
  const result = Promise.resolve(createXmllintCommand().execute({ command: "xmllint",
    ...createCommandArguments([]), cwd: "/", env: {}, fs: injected, signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() {
      yield encoder.encode("<r>");
      const reused = encoder.encode(`<x>${payload}</x>`);
      for (let index = 0; index < 80; index++) yield reused;
      yield encoder.encode("</r>");
    } },
    stdout: { async write(bytes) {
      await Promise.resolve(); output += bytes.length;
      assert.ok(bytes.length <= 16384);
      if (cancel) controller.abort(failure);
    } },
    stderr: { async write(bytes) { assert.fail(new TextDecoder().decode(bytes)); } },
  }));
  if (cancel) await assert.rejects(result, error => error === failure);
  else {
    assert.equal((await result).exitCode, 0);
    assert.equal(output, encoder.encode('<?xml version="1.0"?>\n<r></r>\n').length + 80 * (payload.length + 7));
  }
  assert.equal(opened, 1);
  assert.equal(closed, opened);
  assert.equal(outstanding, 0);
  assert.ok(written >= 1024 * 1024, "document data must reach the caller's backing store");
  assert.deepEqual(await fs.readdir("/"), []);
});
