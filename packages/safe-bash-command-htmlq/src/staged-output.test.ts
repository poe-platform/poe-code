import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import type { CommandContext } from "safe-bash-contracts/command";
import type { FileSystem } from "safe-bash-contracts/filesystem";
import { htmlq } from "./command.js";
import { publishStagedHtmlq } from "./staged-output.js";

async function fixture() {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work");
  await fs.writeFile("/work/result", new TextEncoder().encode("old"));
  const controller = new AbortController();
  const errors: Uint8Array[] = [];
  let writes = 0, active = 0, peak = 0, removed = 0, closed = 0;
  let onWrite: (() => void | Promise<void>) | undefined;
  const guarded = new Proxy(fs, {
    get(target, key) {
      if (key === "publishFileConditional" || key === "writeFileConditional" || key === "readFile" || key === "writeFile")
        return () => { throw new Error(`Unexpected whole-output operation: ${String(key)}`); };
      if (key === "createStagedFile") return async (...args: Parameters<typeof fs.createStagedFile>) => {
        const stage = await fs.createStagedFile(...args);
        assert.ok(stage.writer);
        assert.ok(stage.cleanup);
        return { ...stage, writer: {
          async write(bytes: Uint8Array, options: Parameters<NonNullable<typeof stage.writer>["write"]>[1]) {
            assert.ok(bytes.buffer.byteLength <= 16384);
            active += bytes.byteLength; peak = Math.max(peak, active); writes++;
            const owned = bytes.slice();
            try {
              await new Promise<void>(resolve => setImmediate(resolve));
              await onWrite?.();
              assert.deepEqual(bytes, owned);
              await stage.writer!.write(bytes, options);
            } finally { active -= bytes.byteLength; }
          },
          finish: stage.writer.finish.bind(stage.writer)
        }, cleanup: {
          async remove() { removed++; await stage.cleanup!.remove(); },
          async close() { closed++; await stage.cleanup!.close(); }
        } };
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  }) as FileSystem;
  const context = {
    command: "htmlq", args: [], cwd: "/work", env: {}, fs: guarded,
    signal: controller.signal,
    stdin: (async function* () {
      const chunk = new TextEncoder().encode(`<p>${"x".repeat(4096)}</p>`);
      for (let index = 0; index < 32; index++) yield chunk;
    })(),
    stdout: { async write() { throw new Error("Unexpected stdout"); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes.slice()); } }
  } as unknown as CommandContext;
  return { fs, context, controller, errors,
    inspect: () => ({ writes, active, peak, removed, closed }),
    onWrite(callback: () => void | Promise<void>) { onWrite = callback; }
  };
}

test("retained staging publishes htmlq output with bounded awaited writes and preserved identity", async () => {
  const f = await fixture();
  const before = await f.fs.stat("/work/result");
  const result = await htmlq(f.context, { selector: "p", text: true, output: "result" });
  assert.equal(result.exitCode, 0);
  assert.equal(new TextDecoder().decode(await f.fs.readFile("/work/result")), `${"x".repeat(4096)}\n`.repeat(32));
  assert.equal((await f.fs.stat("/work/result")).ino, before.ino);
  assert.ok(f.inspect().writes > 32);
  assert.ok(f.inspect().peak <= 16384);
  assert.equal(f.inspect().active, 0);
  assert.equal(f.inspect().removed, 1);
  assert.equal(f.inspect().closed, 1);
  assert.deepEqual((await f.fs.readdir("/work")).map(entry => entry.name), ["result"]);
});

for (const failure of ["abort", "write", "conflict", "limit"] as const) {
  test(`retained staging cleans up and preserves the destination on ${failure}`, async () => {
    const f = await fixture();
    const reason = new Error("injected staging failure");
    let changed = false;
    f.onWrite(async () => {
      if (changed) return;
      changed = true;
      if (failure === "abort") f.controller.abort(reason);
      if (failure === "write") throw reason;
      if (failure === "conflict") await f.fs.writeFile("/work/result", new TextEncoder().encode("concurrent"));
    });
    const run = htmlq(f.context, { selector: "p", text: true, output: "result", ...(failure === "limit" ? { limits: { outputBytes: 5000 } } : {}) });
    if (failure === "abort" || failure === "write") await assert.rejects(run, error => error === reason);
    else assert.equal((await run).exitCode, 1);
    assert.equal(new TextDecoder().decode(await f.fs.readFile("/work/result")), failure === "conflict" ? "concurrent" : "old");
    assert.equal(f.inspect().removed, 1);
    assert.equal(f.inspect().closed, 1);
    assert.deepEqual((await f.fs.readdir("/work")).map(entry => entry.name), ["result"]);
  });
}

test("staging consumes reused output chunks one at a time, independent of output size", async () => {
  const f = await fixture();
  let produced = 0, retired = false;
  async function* source() {
    const chunk = new Uint8Array(16384);
    try {
      for (let index = 0; index < 128; index++) {
        assert.equal(f.inspect().writes, produced);
        assert.equal(f.inspect().active, 0);
        chunk.fill(index);
        produced++;
        yield chunk;
      }
    } finally { retired = true; }
  }
  await publishStagedHtmlq(f.context.fs, "/work/result", source(), f.controller.signal);
  assert.ok(retired);
  assert.equal(produced, 128);
  assert.equal(f.inspect().peak, 16384);
  const output = await f.fs.readFile("/work/result");
  assert.equal(output.length, 128 * 16384);
  for (let index = 0; index < output.length; index++) assert.equal(output[index], Math.floor(index / 16384));
});

test("staging preserves source failure and both cleanup failures in order", async () => {
  const f = await fixture();
  const primary = new Error("source"), remove = new Error("remove"), close = new Error("close");
  const fs = new Proxy(f.context.fs, { get(target, key) {
    if (key === "createStagedFile") return async (...args: Parameters<NonNullable<FileSystem["createStagedFile"]>>) => {
      const stage = await target.createStagedFile!(...args);
      return { ...stage, cleanup: {
        async remove() { await stage.cleanup!.remove(); throw remove; },
        async close() { await stage.cleanup!.close(); throw close; }
      } };
    };
    const value: unknown = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  async function* source() { yield new Uint8Array([1]); throw primary; }
  await assert.rejects(publishStagedHtmlq(fs, "/work/result", source(), f.controller.signal), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, remove, close]);
    return true;
  });
  assert.equal(new TextDecoder().decode(await f.fs.readFile("/work/result")), "old");
  assert.deepEqual(f.inspect(), { writes: 1, active: 0, peak: 1, removed: 1, closed: 1 });
});

test("staging reads aliased input before replacing bytes without breaking hardlinks", async () => {
  const f = await fixture();
  await f.fs.writeFile("/work/result", new TextEncoder().encode("<p>aliased</p>"));
  await f.fs.link("/work/result", "/work/input");
  const result = await htmlq(f.context, { selector: "p", text: true, filename: "input", output: "result" });
  assert.equal(result.exitCode, 0);
  assert.equal(new TextDecoder().decode(await f.fs.readFile("/work/input")), "aliased\n");
  assert.equal((await f.fs.stat("/work/input")).ino, (await f.fs.stat("/work/result")).ino);
});

test("staging creates absent outputs and publishes an empty projection", async () => {
  const f = await fixture();
  const result = await htmlq(f.context, { selector: "missing", output: "new" });
  assert.equal(result.exitCode, 0);
  assert.equal((await f.fs.readFile("/work/new")).length, 0);
  assert.equal(f.inspect().writes, 0);
  assert.equal(f.inspect().closed, 1);
});

test("retained staging accepts relative dot components in output operands", async () => {
  const f = await fixture();
  const result = await htmlq(f.context, { selector: "missing", output: "./result" });
  assert.equal(result.exitCode, 0);
  assert.equal((await f.fs.readFile("/work/result")).length, 0);
});
