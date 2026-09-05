import assert from "node:assert/strict";
import test from "node:test";
import { createMountFileSystem } from "poe-code/safe-fs";
import { basicCommands } from "../../../../src/commands/basic.js";
import { streamCommands } from "../../../../src/commands/streams.js";
import { FsError } from "../../../../src/contracts/errors.js";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { createDeviceFileSystem } from "../../../../src/fs/devices/index.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { Shell } from "../../../../src/shell/shell.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function intercept<Target extends object>(subject: Target, overrides: Partial<Target>): Target {
  return new Proxy(subject, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

function setup(fs: FileSystem) {
  const shell = new Shell({ fs, limits: { maxWallClockMs: 1500, maxInputBytes: 1024 * 1024 } });
  for (const command of [...basicCommands(), ...streamCommands()]) shell.register(command);
  return shell;
}

async function trackedInput(options: { read?: () => Promise<void>; close?: (path: string) => Promise<void> } = {}) {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", new Uint8Array());
  await memory.writeFile("/unused", new Uint8Array());
  const opened: string[] = [];
  const closed: string[] = [];
  const reads: string[] = [];
  const fs = intercept(memory, { async open(path, request) {
    opened.push(path);
    const descriptor = await memory.open(path, request);
    return intercept(descriptor, {
      async stat(request) { return { ...await descriptor.stat(request), type: "character" }; },
      async read(buffer) {
        reads.push(path);
        await options.read?.();
        buffer.fill(0);
        return buffer.length;
      },
      async close() {
        closed.push(path);
        await descriptor.close();
        await options.close?.(path);
      },
    });
  } });
  return { fs, opened, closed, reads };
}

const pipelines = [
  "cat </dev/zero | head -c 32",
  "{ cat <&3; } 3</dev/zero 4<&3 | head -c 32",
  "cat 3</dev/zero 4</dev/zero </dev/zero | head -c 32",
  "cat </dev/zero | cat | head -c 32",
];

for (const pipeline of pipelines) for (const pipefail of [false, true]) for (const scriptFile of [false, true]) {
  test(`pipeline cleanup review: ${scriptFile ? "VFS script" : "direct"}, pipefail=${pipefail}, ${pipeline}`, { timeout: 2500 }, async context => {
    const memory = createMemoryFileSystem();
    const fs = createMountFileSystem({ root: memory, mounts: { "/dev": createDeviceFileSystem() } });
    const source = `${pipefail ? "set -o pipefail; " : ""}${pipeline}`;
    await memory.writeFile("/pipeline.sh", Buffer.from(source));
    const shell = setup(fs);
    context.after(() => shell.dispose());
    const result = await shell.exec(scriptFile ? "bash /pipeline.sh" : source);
    assert.equal(result.exitCode, pipefail ? 141 : 0);
    assert.deepEqual(result.stdoutBytes, new Uint8Array(32));
    assert.deepEqual(result.stderrBytes, new Uint8Array());
    assert.equal(result.stdout, "\0".repeat(32));
    assert.equal(result.stderr, "");
  });
}

for (const pipefail of [false, true]) test(`pipeline cleanup review: PIPESTATUS survives handled cancellation, pipefail=${pipefail}`, { timeout: 2500 }, async context => {
  const fs = createMountFileSystem({ root: createMemoryFileSystem(), mounts: { "/dev": createDeviceFileSystem() } });
  const shell = setup(fs);
  context.after(() => shell.dispose());
  const result = await shell.exec(`${pipefail ? "set -o pipefail; " : ""}cat </dev/zero | head -c 32; printf 'status:%s vector:%s,%s\\n' "$?" "\${PIPESTATUS[0]}" "\${PIPESTATUS[1]}"`);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.stdoutBytes, new Uint8Array(Buffer.concat([Buffer.alloc(32), Buffer.from(`status:${pipefail ? 141 : 0} vector:141,0\n`)])));
  assert.equal(result.stderr, "");
});

for (const failure of [new FsError("EPIPE", { syscall: "close" }), new FsError("EIO", { syscall: "close" }), false]) {
  test(`pipeline cleanup review: genuine uncancelled adapter close failure is not normalized (${String(failure)})`, { timeout: 2500 }, async context => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/input", new Uint8Array());
    let closes = 0;
    const fs = intercept(memory, { async open(path, options) {
      const descriptor = await memory.open(path, options);
      return intercept(descriptor, { async close() { closes++; await descriptor.close(); throw failure; } });
    } });
    const shell = setup(fs);
    context.after(() => shell.dispose());
    await assert.rejects(shell.exec(": 3</input | head -c 0"), error => Object.is(error, failure));
    assert.equal(closes, 1);
  });
}

for (const pipefail of [false, true]) test(`pipeline cleanup review: early consumer waits for aliased and unread owners, pipefail=${pipefail}`, { timeout: 2500 }, async context => {
  const entered = deferred();
  const release = deferred();
  const fixture = await trackedInput({ async close(path) {
    if (path === "/input") { entered.resolve(); await release.promise; }
  } });
  const shell = setup(fixture.fs);
  context.after(async () => { release.resolve(); await shell.dispose(); });
  let settled = false;
  const outcome = shell.exec(`${pipefail ? "set -o pipefail; " : ""}cat 3</input 4<&3 5</unused <&3 | head -c 32`).then(
    result => ({ result }), failure => ({ failure }),
  ).finally(() => { settled = true; });
  try {
    await entered.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
  } finally { release.resolve(); }
  const outcomeValue = await outcome;
  assert.ok("result" in outcomeValue, String("failure" in outcomeValue ? outcomeValue.failure : ""));
  assert.equal(outcomeValue.result.exitCode, pipefail ? 141 : 0);
  assert.deepEqual(outcomeValue.result.stdoutBytes, new Uint8Array(32));
  assert.deepEqual(outcomeValue.result.stderrBytes, new Uint8Array());
  assert.deepEqual(fixture.opened, ["/input", "/unused"]);
  assert.deepEqual(fixture.closed.sort(), ["/input", "/unused"]);
  assert.ok(fixture.reads.length > 0);
  assert.equal(fixture.reads.includes("/unused"), false);
});

for (const reason of [false, 0, "", null]) test(`pipeline cleanup review: falsey root cancellation drains late read and all owners (${String(reason)})`, { timeout: 2500 }, async context => {
  const entered = deferred();
  const release = deferred();
  const controller = new AbortController();
  const fixture = await trackedInput({ async read() { entered.resolve(); await release.promise; } });
  const shell = setup(fixture.fs);
  context.after(async () => { release.resolve(); controller.abort(reason); await shell.dispose(); });
  let settled = false;
  const outcome = shell.exec("cat 3</input 4<&3 5</unused <&3 | head -c 32", { signal: controller.signal }).then(
    result => ({ result }), failure => ({ failure }),
  ).finally(() => { settled = true; });
  try {
    await entered.promise;
    controller.abort(reason);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(fixture.closed.includes("/input"), false);
  } finally { release.resolve(); }
  const outcomeValue = await outcome;
  assert.ok("failure" in outcomeValue);
  assert.equal(outcomeValue.failure, reason);
  assert.deepEqual(fixture.opened, ["/input", "/unused"]);
  assert.deepEqual(fixture.closed.sort(), ["/input", "/unused"]);
  assert.deepEqual(fixture.reads, ["/input"]);
});

for (const code of ["EPIPE", "EIO"] as const) test(`pipeline cleanup review: consumer closure does not erase a distinct adapter close ${code}`, { timeout: 2500 }, async context => {
  const failure = new FsError(code, { syscall: "close", path: "/input" });
  const fixture = await trackedInput({ async close() { throw failure; } });
  const shell = setup(fixture.fs);
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("cat </input | head -c 32"), error => error === failure);
  assert.deepEqual(fixture.closed, ["/input"]);
});

for (const identical of [false, true]) test(`pipeline cleanup review: separate prepared owners retain both close failures, identical=${identical}`, { timeout: 2500 }, async context => {
  const failures = identical ? [false, false] : [new FsError("EIO", { syscall: "close" }), new FsError("EPIPE", { syscall: "close" })];
  const fixture = await trackedInput({ async close(path) { throw failures[path === "/input" ? 0 : 1]; } });
  const shell = setup(fixture.fs);
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("cat 3</input 4<&3 5</unused <&3 | head -c 32"), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, failures);
    return true;
  });
  assert.deepEqual(fixture.closed.sort(), ["/input", "/unused"]);
});

for (const failure of [false, new FsError("EIO", { syscall: "return" })]) test(`pipeline cleanup review: legacy iterator teardown failure survives consumer closure (${String(failure)})`, { timeout: 2500 }, async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", new Uint8Array());
  Object.defineProperty(memory, "open", { value: undefined });
  let returned = 0;
  const fs = intercept(memory, { readStream() { return { [Symbol.asyncIterator]() {
    let index = 0;
    let started = false;
    let closed = false;
    return {
      async next(): Promise<IteratorResult<Uint8Array>> {
        if (closed) return { done: true, value: undefined };
        started = true;
        if (index < 16) {
          index++;
          return { done: false, value: new Uint8Array(65536) };
        }
        closed = true;
        returned++;
        throw failure;
      },
      async return(): Promise<IteratorResult<Uint8Array>> {
        if (closed) return { done: true, value: undefined };
        closed = true;
        if (started) {
          returned++;
          throw failure;
        }
        return { done: true, value: undefined };
      },
    };
  } }; } });
  const shell = setup(fs);
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("cat </input | head -c 32"), error => Object.is(error, failure));
  assert.equal(returned, 1);
});
