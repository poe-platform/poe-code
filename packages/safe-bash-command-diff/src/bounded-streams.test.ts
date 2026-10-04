import assert from "node:assert/strict";
import test from "node:test";
import { type FileSystem } from "safe-bash-contracts";
import { Budget } from "safe-bash-diff-engine/shared";
import { filesystem, run } from "./helpers.test-support.js";

for (const failure of ["none", "read", "cancel"] as const) test(`special inputs use bounded caller storage: ${failure}`, async t => {
  const fs = await filesystem({ left: "", right: "" });
  const controller = new AbortController(), reason = new Error("stream stopped");
  let opened = 0, closed = 0, retired = 0, supplied = 0;
  const chunk = new Uint8Array(16384).fill(120);
  t.mock.method(Budget.prototype, "read", async () => assert.fail("whole-input collector"));
  const view = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return () => assert.fail("whole-file loader");
    if (key === "stat" || key === "lstat") return async (...args: Parameters<FileSystem["stat"]>) => {
      const stat = await target[key](...args);
      return args[0] === "/work/left" || args[0] === "/work/right" ? { ...stat, type: "fifo" as const, size: 0 } : stat;
    };
    if (key === "readStream") return async function* (path: string) {
      try {
        for (let index = 0; index < 32; index++) {
          supplied++;
          if (index === 20 && failure === "read") throw reason;
          if (index === 20 && failure === "cancel") controller.abort(reason);
          yield chunk;
        }
        yield new TextEncoder().encode(path.endsWith("left") ? "\nold\n" : "\nnew\n");
      } finally { retired++; }
    };
    if (key === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
      opened++;
      const handle = await target.open(...args);
      return new Proxy(handle, { get(descriptor, method) {
        if (method === "write") return async (...params: Parameters<typeof handle.write>) => {
          assert.ok(params[0].length <= 16384); return descriptor.write(...params);
        };
        if (method === "close") return async () => { closed++; await descriptor.close(); };
        const value = Reflect.get(descriptor, method, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  let stdout = "";
  const result = await run("diff", ["left", "right"], {
    fs: view, signal: controller.signal,
    stdout: { async write(bytes) { await Promise.resolve(); stdout += new TextDecoder().decode(bytes); } },
  }).catch(error => {
    if (failure !== "cancel") throw error;
    assert.equal(error, reason);
    return { exitCode: 2, stderr: "" };
  });
  assert.equal(result.exitCode, failure === "none" ? 1 : 2, result.stderr);
  assert.equal(stdout, failure === "none" ? "2c2\n< old\n---\n> new\n" : "");
  assert.equal(retired, failure === "none" ? 2 : 1);
  assert.equal(opened, failure === "none" ? 2 : 1);
  assert.equal(closed, opened);
  assert.ok(supplied <= 64);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["left", "right"]);
});

for (const unavailable of ["method", "capability"] as const) test(`special-file compatibility is retained without streaming ${unavailable}`, async () => {
  const fs = await filesystem({ left: "old\n", right: "new\n" });
  const view = new Proxy(fs, { get(target, key) {
    if (key === "readStream") return unavailable === "method" ? undefined : () => assert.fail("unsupported stream must not be opened");
    if (key === "capabilitiesFor" && unavailable === "capability") return async () => ({ ...target.capabilities, streamingRead: false });
    if (key === "stat" || key === "lstat") return async (...args: Parameters<FileSystem["stat"]>) => {
      const stat = await target[key](...args);
      return args[0] === "/work/left" ? { ...stat, type: "character" as const, size: 0 } : stat;
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await run("diff", ["left", "right"], { fs: view });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, "1c1\n< old\n---\n> new\n");
});
