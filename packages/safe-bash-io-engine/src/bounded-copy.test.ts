import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext, FileStat } from "safe-bash-contracts";
import { copyCheckedSource } from "./commands/copy-source.js";

for (const fail of [false, true]) test(`exclusive retained copy uses bounded descriptor writes and closes on failure=${fail}`, async () => {
  const size = 4 * 1024 * 1024;
  const stat = { type: "file", mode: 0o600, size, dev: 1, ino: 1, identityScope: {} } as FileStat;
  const chunk = new Uint8Array(65536).fill(42);
  let read = 0, written = 0, closed = 0, created = false, pending = false;
  const context = {
    signal: new AbortController().signal,
    fs: {
      capabilities: { retainedRead: true, streamingWrite: false, exclusiveCreate: true, open: true, randomAccessWrite: true },
      async openReadFile() { return {
        async stat() { return stat; },
        async read(position: number, maximum: number) {
          assert.equal(pending, false);
          assert.equal(position, read);
          assert.ok(read - written <= chunk.length);
          if (read === size) return new Uint8Array();
          assert.equal(maximum, chunk.length);
          read += chunk.length;
          return chunk;
        },
        async close() { closed++; chunk.fill(0); },
      }; },
      async writeFile() { throw new Error("whole-file creation"); },
      async open(_path: string, options: { creation: string }) {
        assert.equal(options.creation, "exclusive"); created = true;
        return { async write(bytes: Uint8Array) {
          assert.equal(created, true); assert.ok(bytes.length <= chunk.length);
          pending = true; await Promise.resolve();
          if (fail) throw new Error("sink failure");
          assert.equal(bytes[0], 42);
          const count = Math.min(4096, bytes.length); written += count; pending = false;
          return count;
        }, async close() {} };
      },
    },
  } as unknown as CommandContext;
  const task = copyCheckedSource(context, "/source", "/target", stat, true);
  if (fail) await assert.rejects(task, /sink failure/);
  else { await task; assert.equal(written, size); }
  assert.equal(closed, 1);
});

for (const actualSize of [0, 2]) test(`descriptor copy rejects a changed source size of ${actualSize}`, async () => {
  const stat = { type: "file", size: 1, mode: 0o600, dev: 1, ino: 1, identityScope: {} } as FileStat;
  let closed = 0;
  const context = {
    signal: new AbortController().signal,
    fs: {
      capabilities: { retainedRead: true, streamingWrite: false, exclusiveCreate: true, open: true, randomAccessWrite: true },
      async openReadFile() { return {
        async stat() { return stat; },
        async read(position: number) { return new Uint8Array(position ? 0 : actualSize); },
        async close() { closed++; }
      }; },
      async open() { return { async write(bytes: Uint8Array) { return bytes.length; }, async close() { closed++; } }; }
    }
  } as unknown as CommandContext;
  await assert.rejects(copyCheckedSource(context, "/source", "/target", stat, true), { code: "EBUSY" });
  assert.equal(closed, 2);
});
