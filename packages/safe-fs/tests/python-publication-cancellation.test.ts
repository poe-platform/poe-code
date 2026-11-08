import { expect, it } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";
import { PythonFileSystem } from "../src/python/index.js";
import { withObjectFileDescriptors, type ObjectFilePublicationStore } from "../src/fs/object-publication/index.js";

it("cancels Python close publication and drains it before the next interpreter filesystem call (#4136)", async () => {
  const storage = new MemoryFileSystem();
  const store: ObjectFilePublicationStore = { async acquire() { return undefined; } };
  const controller = new AbortController();
  const reason = new Error("large publication deadline");
  let entered!: () => void;
  const publishing = new Promise<void>(resolve => { entered = resolve; });
  let settled = false;
  store.publish = async (_path, _revision, source, options) => {
    if (options.size === 0) {
      for await (const ignoredChunk of source) { /* Drain the empty creation source. */ }
      return { revision: "created", stat: { type: "file", size: 0, mode: 0o600, mtimeMs: 0, atimeMs: 0, ctimeMs: 0 }, async read() { return new Uint8Array(); }, async close() {} };
    }
    for await (const ignoredChunk of source) break;
    entered();
    try {
      await new Promise<void>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
        if (options.signal?.aborted) reject(options.signal.reason);
      });
      throw new Error("publication unexpectedly completed");
    } finally { settled = true; }
  };
  const fs = withObjectFileDescriptors(storage, store, { maxOpenFiles: 1 });
  const first = new PythonFileSystem(fs, { cwd: "/", signal: controller.signal });
  const handle = await first.dispatch({ op: "open", args: ["/large", { access: "write", creation: "ifMissing" }] }) as number;
  const chunk = new Uint8Array(65536).fill(42);
  for (let index = 0; index < 2; index++) await first.dispatch({ op: "write", args: [handle, chunk, null] });
  const closing = first.dispatch({ op: "close", args: [handle] });
  void closing.catch(() => {});
  await publishing;
  controller.abort(reason);
  await expect(closing).rejects.toBe(reason);
  await first.close();
  expect(settled).toBe(true);
  const second = new PythonFileSystem(fs, { cwd: "/" });
  const next = await second.dispatch({ op: "open", args: ["/next", { access: "read", creation: "ifMissing" }] }) as number;
  await second.dispatch({ op: "close", args: [next] });
  await second.close();
  await expect(storage.stat("/large")).rejects.toMatchObject({ code: "ENOENT" });
});
