import assert from "node:assert/strict";
import test from "node:test";
import { Budget } from "safe-bash-diff-engine/shared";
import { contents, filesystem, replacement, run } from "./helpers.test.js";

for (const transport of ["plain", "mail", "crlf"]) test(`patch stages ${transport} input without a whole-file loader or line array`, async t => {
  const count = 6000;
  const fs = await filesystem({ target: "old\n".repeat(count) });
  t.mock.method(Budget.prototype, "read", () => { assert.fail("whole-file patch read"); });
  t.mock.method(Budget.prototype, "split", () => { assert.fail("whole-file patch split"); });
  let spills = 0, completed = false;
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args);
    if (!completed) spills++;
    return handle;
  });
  const result = await run("patch", ["--quiet"], { fs, input: {
    async *[Symbol.asyncIterator]() {
      const encoder = new TextEncoder();
      const encode = (text: string) => encoder.encode(transport === "crlf" ? text.replaceAll("\n", "\r\n") : text);
      if (transport === "mail") yield encode("From: sender\nSubject: change\n\n");
      yield encode(`--- target\n+++ target\n@@ -1,${count} +1,${count} @@\n`);
      const reused = encode("-old\n");
      for (let index = 0; index < count; index++) yield reused;
      reused.set(encode("+new\n"));
      for (let index = 0; index < count; index++) yield reused;
      reused.fill(0);
      if (transport === "mail") yield encode("-- \nsignature\n");
      completed = true;
    },
  } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(fs, "target"), "new\n".repeat(count));
  assert.ok(spills > 0);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["target"]);
});

for (const failure of ["write", "cancel"]) test(`staged patch input closes producer and storage after ${failure}`, async t => {
  const fs = await filesystem({ target: "old\n" });
  const controller = new AbortController();
  const reason = new Error("patch input storage stopped");
  let opened = 0, closed = 0, writes = 0, producerClosed = false;
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args); opened++;
    return new Proxy(handle, { get(target, key) {
      if (key === "write") return async (...args: Parameters<typeof handle.write>) => {
        assert.ok(args[0].length <= 16384); writes++;
        if (failure === "write") throw reason;
        controller.abort(reason);
        return target.write(...args);
      };
      if (key === "close") return async (...args: Parameters<typeof handle.close>) => { closed++; return target.close(...args); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  try {
    const result = await run("patch", [], { fs, signal: controller.signal, input: {
      async *[Symbol.asyncIterator]() {
        const block = new Uint8Array(16384).fill(10);
        try { for (let index = 0; index < 30; index++) yield block; }
        finally { producerClosed = true; }
      },
    } });
    assert.notEqual(result.exitCode, 0);
  } catch (error) {
    assert.equal(failure, "cancel"); assert.equal(error, reason);
  }
  assert.ok(writes > 0); assert.equal(closed, opened); assert.ok(producerClosed);
  assert.equal(await contents(fs, "target"), "old\n");
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["target"]);
});

test("patch file ingestion uses retained reads and detects changes before publication", async () => {
  const fs = await filesystem({ target: "old\n", patch: replacement });
  const open = fs.openReadFile.bind(fs);
  let reads = 0;
  const observed = new Proxy(fs, { get(target, key) {
    if (key === "readFile") return () => { assert.fail("whole-file input read"); };
    if (key === "openReadFile") return async (...args: Parameters<typeof fs.openReadFile>) => {
    const handle = await open(...args);
    if (args[0] !== "/work/patch") return handle;
    return new Proxy(handle, { get(target, key) {
      if (key === "read") return async (...args: Parameters<typeof handle.read>) => {
        const bytes = await target.read(...args); reads++;
        await fs.writeFile("/work/patch", new TextEncoder().encode(replacement + "\n"));
        return bytes;
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await run("patch", ["-i", "patch"], { fs: observed });
  assert.equal(result.exitCode, 2); assert.match(result.stderr, /input changed/u); assert.equal(reads, 1);
  assert.equal(await contents(fs, "target"), "old\n");
});
