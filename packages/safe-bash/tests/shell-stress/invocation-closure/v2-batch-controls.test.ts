import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { cases } from "./v2-cases.js";
import { boundedProcess } from "./support.js";
import { differentialBatch } from "./v2-batch-child.js";

const sampleIds = ["query-v-multiple-status", "query-effective-path-cwd", "read-N-backslash-raw"];

test("closure v2 batch refuses invalid selections before execution", async context => {
  const execute = context.mock.method(Shell.prototype, "exec", async () => { throw new Error("must not execute"); });
  for (const ids of [[], cases.slice(0, 9).map(row => row.id), [sampleIds[0]!, sampleIds[0]!], ["host-sh-profile-never-global"], [sampleIds[0]!, "unknown"]]) {
    await assert.rejects(differentialBatch(ids));
  }
  assert.equal(execute.mock.callCount(), 0);
});

test("closure v2 batch has fresh filesystem, registry and shell state and disposes before advancing", async context => {
  const execute = Shell.prototype.exec;
  const dispose = Shell.prototype.dispose;
  const mkdir = MemoryFileSystem.prototype.mkdir;
  const filesystems = new Set<MemoryFileSystem>();
  const shells = new Set<Shell>();
  const registries = new Set<Shell["commands"]>();
  const disposed = new Set<Shell>();
  context.mock.method(MemoryFileSystem.prototype, "mkdir", async function(this: MemoryFileSystem, ...args: Parameters<MemoryFileSystem["mkdir"]>) {
    if (args[0] === "/work") {
      assert.equal(filesystems.has(this), false);
      filesystems.add(this);
    }
    return mkdir.apply(this, args);
  });
  context.mock.method(Shell.prototype, "exec", async function(this: Shell, ...args: Parameters<Shell["exec"]>) {
    assert.equal(shells.size, disposed.size);
    assert.equal(shells.has(this), false);
    assert.equal(registries.has(this.commands), false);
    shells.add(this);
    registries.add(this.commands);
    assert.equal(this.commands.has("batch-leak"), false);
    assert.equal((await execute.call(this, 'test ! -e /work/batch-leak; printf "%s" "$?"')).stdout, "0");
    this.commands.register({ name: "batch-leak", async execute() { return { exitCode: 0 }; } });
    await execute.call(this, "printf marker >/work/batch-leak");
    return execute.apply(this, args);
  });
  context.mock.method(Shell.prototype, "dispose", async function(this: Shell) {
    assert.equal(disposed.has(this), false);
    await dispose.call(this);
    disposed.add(this);
  });
  assert.deepEqual((await differentialBatch(sampleIds)).map(row => row.id), sampleIds);
  assert.equal(filesystems.size, sampleIds.length);
  assert.equal(registries.size, sampleIds.length);
  assert.deepEqual(disposed, shells);
});

test("closure v2 batch repeat and reverse execute again with identical observations", async context => {
  const expected = [];
  for (const id of sampleIds) expected.push(...await differentialBatch([id]));
  const execute = context.mock.method(Shell.prototype, "exec");
  assert.deepEqual(await differentialBatch(sampleIds), expected);
  assert.deepEqual(await differentialBatch(sampleIds), expected);
  assert.deepEqual(await differentialBatch([...sampleIds].reverse()), [...expected].reverse());
  assert.equal(execute.mock.callCount(), sampleIds.length * 3);
});

for (const primary of [new Error("primary execution failure"), false, undefined]) {
  test(`closure v2 batch preserves primary failure ${String(primary)} over disposal failure`, async context => {
    const dispose = Shell.prototype.dispose;
    const execute = context.mock.method(Shell.prototype, "exec", async () => { throw primary; });
    const cleanup = context.mock.method(Shell.prototype, "dispose", async function(this: Shell) {
      await dispose.call(this);
      throw new Error("secondary disposal failure");
    });
    let rejected = false;
    try { await differentialBatch(sampleIds); }
    catch (error) { rejected = true; assert.equal(error, primary); }
    assert.equal(rejected, true);
    assert.equal(execute.mock.callCount(), 1);
    assert.equal(cleanup.mock.callCount(), 1);
  });
}

test("closure v2 batch stops on disposal-only failure", async context => {
  const primary = new Error("disposal failed");
  const dispose = Shell.prototype.dispose;
  const execute = context.mock.method(Shell.prototype, "exec");
  const cleanup = context.mock.method(Shell.prototype, "dispose", async function(this: Shell) {
    await dispose.call(this);
    throw primary;
  });
  await assert.rejects(differentialBatch(sampleIds), error => error === primary);
  assert.equal(execute.mock.callCount(), 1);
  assert.equal(cleanup.mock.callCount(), 1);
});

test("closure v2 batch disposes after fixture preparation failure", async context => {
  const primary = new Error("fixture write failed");
  context.mock.method(MemoryFileSystem.prototype, "writeFile", async () => { throw primary; });
  const execute = context.mock.method(Shell.prototype, "exec");
  const cleanup = context.mock.method(Shell.prototype, "dispose");
  await assert.rejects(differentialBatch(["query-effective-path-cwd"]), error => error === primary);
  assert.equal(execute.mock.callCount(), 0);
  assert.equal(cleanup.mock.callCount(), 1);
});

test("closure v2 batch late rejection still fails its isolated child", async () => {
  const script = `
    const { Shell } = await import(${JSON.stringify(new URL("../../../src/shell/index.ts", import.meta.url).href)});
    const { differentialBatch } = await import(${JSON.stringify(new URL("./v2-batch-child.ts", import.meta.url).href)});
    const execute = Shell.prototype.exec;
    Shell.prototype.exec = async function(...args) {
      const result = await execute.apply(this, args);
      setImmediate(() => { void Promise.reject(new Error("closure-v2-batch-late-rejection")); });
      return result;
    };
    console.log(JSON.stringify(await differentialBatch(["query-v-multiple-status"])));
  `;
  const child = await boundedProcess(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: resolve("."), env: { PATH: "unused", HOME: "/nonexistent", LC_ALL: "C", LANG: "C", TZ: "UTC" },
  });
  assert.equal(child.timedOut, false);
  assert.equal(child.overflow, false);
  assert.equal(child.code, 1);
  assert.match(child.stderr, /closure-v2-batch-late-rejection/u);
});
