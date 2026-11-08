import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { toByteSource, type FileSystem } from "safe-bash-contracts";
import { Budget, inspect } from "./shared.js";

for (const scenario of ["short", "stale", "error", "cancel", "return"] as const) {
  test(`retained block source retires handles: ${scenario}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/file", new Uint8Array([65, 66, 67]));
    const controller = new AbortController();
    const reason = new Error("injected failure");
    let closed = 0, reads = 0;
    const view = new Proxy(fs, { get(target, key) {
      if (key === "readFile" || key === "readStream") return () => assert.fail("whole file read");
      if (key === "openReadFile") return async (path: string) => {
        const handle = await target.openReadFile!(path);
        return {
          async stat() {
            const stat = await handle.stat();
            return scenario === "stale" && reads ? { ...stat, size: 4 } : stat;
          },
          async read(position: number, length: number) {
            reads++;
            if (scenario === "error") throw reason;
            if (scenario === "cancel") controller.abort(reason);
            return handle.read(position, Math.min(length, 1));
          },
          async close() { closed++; await handle.close(); },
        };
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as FileSystem;
    const budget = new Budget({
      command: "diff", args: [], cwd: "/", env: {}, fs: view, stdin: toByteSource(""),
      signal: controller.signal, stdout: { async write() {} }, stderr: { async write() {} },
    }, {});
    await inspect(budget, "/file");
    const source = budget.diffSource("/file");
    const consume = async () => {
      const bytes: number[] = [];
      for await (const block of source) bytes.push(...block);
      return bytes;
    };
    if (scenario === "return") {
      assert.deepEqual((await source.next()).value, new Uint8Array([65]));
      await source.return(undefined);
    } else if (scenario === "stale") await assert.rejects(consume(), /changed while reading/u);
    else if (scenario === "error" || scenario === "cancel") await assert.rejects(consume(), error => error === reason);
    else assert.deepEqual(await consume(), [65, 66, 67]);
    assert.equal(closed, 1);
  });
}

test("cancellation drains an admitted retained read before closing its handle", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array([65]));
  const controller = new AbortController();
  let release!: (bytes: Uint8Array) => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  let closed = false;
  const view = new Proxy(fs, { get(target, key) {
    if (key === "openReadFile") return async (path: string) => ({
      stat: () => target.stat(path),
      read: () => new Promise<Uint8Array>(resolve => { release = resolve; started(); }),
      async close() { closed = true; },
    });
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } }) as FileSystem;
  const budget = new Budget({
    command: "diff", args: [], cwd: "/", env: {}, fs: view, stdin: toByteSource(""),
    signal: controller.signal, stdout: { async write() {} }, stderr: { async write() {} },
  }, {});
  await inspect(budget, "/file");
  const source = budget.diffSource("/file");
  const pending = source.next();
  await entered;
  const reason = new Error("cancel read");
  controller.abort(reason);
  assert.equal(closed, false);
  release(new Uint8Array([65]));
  await assert.rejects(pending, error => error === reason);
  assert.equal(closed, true);
});
