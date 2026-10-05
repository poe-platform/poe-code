import assert from "node:assert/strict";
import test from "node:test";
import { Budget } from "safe-bash-diff-engine/shared";
import { contents, filesystem, run } from "./helpers.test.js";

for (const format of ["normal", "context"]) test(`${format} patch conversion replays caller storage without a converted line array`, async t => {
  const count = 3200;
  const fs = await filesystem({ target: "old\n".repeat(count) });
  t.mock.method(Budget.prototype, "read", () => { assert.fail("whole-file read"); });
  t.mock.method(Budget.prototype, "split", () => { assert.fail("converted patch split"); });
  if (format === "context") {
    const push = Array.prototype.push;
    t.after(() => { Array.prototype.push = push; });
    Array.prototype.push = function(this: unknown[], ...items: unknown[]) {
      for (const item of items) if (item && typeof item === "object" && "kind" in item && item.kind === "!" && "text" in item)
        assert.fail("retained changed context body array");
      return push.apply(this, items);
    };
  }
  const result = await run("patch", ["--quiet", "target"], { fs, input: {
    async *[Symbol.asyncIterator]() {
      const encode = (text: string) => new TextEncoder().encode(text);
      yield encode(format === "normal" ? `1,${count}c1,${count}\n`
        : `*** target\n--- target\n***************\n*** 1,${count} ****\n`);
      const reused = encode(format === "normal" ? "< old\n" : "! old\n");
      for (let index = 0; index < count; index++) yield reused;
      yield encode(format === "normal" ? "---\n" : `--- 1,${count} ----\n`);
      reused.set(encode(format === "normal" ? "> new\n" : "! new\n"));
      for (let index = 0; index < count; index++) yield reused;
      reused.fill(0);
    },
  } });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await contents(fs, "target"), "new\n".repeat(count));
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["target"]);
});

for (const failure of ["write", "cancel"]) test(`converted patch storage cleans up after ${failure}`, async t => {
  const fs = await filesystem({ target: "old\n" });
  const controller = new AbortController(), reason = new Error("conversion stopped");
  let inputComplete = false, opened = 0, closed = 0, failed = false;
  const open = fs.open.bind(fs);
  t.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
    const handle = await open(...args); opened++;
    const conversion = inputComplete;
    return new Proxy(handle, { get(target, key) {
      if (key === "write") return async (...args: Parameters<typeof handle.write>) => {
        assert.ok(args[0].length <= 16384);
        if (conversion && !failed) {
          failed = true;
          if (failure === "write") throw reason;
          controller.abort(reason);
        }
        return target.write(...args);
      };
      if (key === "close") return async (...args: Parameters<typeof handle.close>) => { closed++; return target.close(...args); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  try {
    const result = await run("patch", ["target"], { fs, signal: controller.signal, input: {
      async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode("0a1,12000\n");
        const line = new TextEncoder().encode("> x\n");
        for (let index = 0; index < 12000; index++) yield line;
        inputComplete = true;
      },
    } });
    assert.notEqual(result.exitCode, 0);
  } catch (error) {
    assert.equal(failure, "cancel"); assert.equal(error, reason);
  }
  assert.ok(failed); assert.equal(closed, opened);
  assert.equal(await contents(fs, "target"), "old\n");
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["target"]);
});
