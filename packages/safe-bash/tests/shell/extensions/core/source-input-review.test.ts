import assert from "node:assert/strict";
import test from "node:test";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
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

function setup(execute: (command: ShellExtensionContext) => Promise<number>, fs: FileSystem = createMemoryFileSystem()) {
  const shell = new Shell({ fs, extensions: [{ name: "source-construction-review", create: () => ({ builtins: [{ name: "probe", execute }] }) }] });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

for (const wrapper of ["probe", "eval probe", "fn() { probe; }; fn", "bash -c probe", "/script"]) {
  test(`source construction review: nested ${wrapper} releases aliases without closing the parent cursor`, async context => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/script", Buffer.from("#!/bin/bash\nprobe\n"));
    await fs.chmod("/script", 0o755);
    const seen: string[] = [];
    const shell = setup(async command => {
      const first = command.input.borrow(3);
      const second = command.input.borrow(4);
      const record = await first.record();
      seen.push(Buffer.from(shellValueBytes(record.shellValue)).toString("hex"));
      await record.release();
      await first.release();
      assert.equal(second.readiness(), seen.length === 1 ? "ready" : "eof");
      await second.release();
      return 0;
    }, fs);
    context.after(() => shell.dispose());
    const result = await shell.exec(`{ ${wrapper}; probe; } 3<&0 4<&3`, { stdin: Uint8Array.of(255, 0, 10, 128, 10) });
    assert.deepEqual(result, { exitCode: 0, stdout: "", stderr: "", stdoutBytes: new Uint8Array(), stderrBytes: new Uint8Array() });
    assert.deepEqual(seen, ["ff000a", "800a"]);
  });
}

test("source construction review: separately opened descriptors have independent positions and exactly one close each", async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("first\nsecond\n"));
  const closes: number[] = [];
  let opens = 0;
  const fs = intercept(memory, { async open(path, options) {
    const identity = ++opens;
    const descriptor = await memory.open(path, options);
    return intercept(descriptor, { async close() { closes.push(identity); await descriptor.close(); } });
  } });
  const shell = setup(async command => {
    for (const descriptor of [3, 4]) {
      const lease = command.input.borrow(descriptor);
      const record = await lease.record();
      assert.deepEqual(shellValueBytes(record.shellValue), new Uint8Array(Buffer.from("first\n")));
      await record.release(); await lease.release();
    }
    assert.deepEqual(closes, []);
    return 0;
  }, fs);
  context.after(() => shell.dispose());
  assert.deepEqual(await shell.exec("probe 3</input 4</input"), { exitCode: 0, stdout: "", stderr: "", stdoutBytes: new Uint8Array(), stderrBytes: new Uint8Array() });
  assert.equal(opens, 2);
  assert.deepEqual(closes.sort(), [1, 2]);
});

test("source construction review: function redirection borrows the enclosing file and restores finite stdin", async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("file-one\nfile-two\n"));
  let closes = 0;
  const fs = intercept(memory, { async open(path, options) {
    const descriptor = await memory.open(path, options);
    return intercept(descriptor, { async close() { closes++; await descriptor.close(); } });
  } });
  const seen: string[] = [];
  const shell = setup(async command => {
    assert.equal(closes, seen.length === 2 ? 1 : 0);
    const lease = command.input.borrow(0);
    const record = await lease.record();
    seen.push(Buffer.from(shellValueBytes(record.shellValue)).toString());
    await record.release(); await lease.release();
    return 0;
  }, fs);
  context.after(() => shell.dispose());
  const result = await shell.exec("fn() { probe; }; { fn <&3; probe <&3; } 3</input; probe", { stdin: "parent\n" });
  assert.deepEqual(result, { exitCode: 0, stdout: "", stderr: "", stdoutBytes: new Uint8Array(), stderrBytes: new Uint8Array() });
  assert.deepEqual(seen, ["file-one\n", "file-two\n", "parent\n"]);
  assert.equal(closes, 1);
});

test("source construction review: subsequent redirection failure closes admitted input without reading it", async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("unused\n"));
  let reads = 0; let closes = 0; let executed = false;
  const fs = intercept(memory, { async open(path, options) {
    const descriptor = await memory.open(path, options);
    return intercept(descriptor, {
      async read(...args) { reads++; return descriptor.read(...args); },
      async close() { closes++; await descriptor.close(); },
    });
  } });
  const shell = setup(async () => { executed = true; return 0; }, fs);
  context.after(() => shell.dispose());
  const result = await shell.exec("probe 3</input 4</missing");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "shell: line 1: /missing: No such file or directory\n");
  assert.deepEqual({ reads, closes, executed }, { reads: 0, closes: 1, executed: false });
});

for (const cancellation of [false, 0]) test(`source construction review: cancellation drains admitted descriptor read (${cancellation})`, { timeout: 2000 }, async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("line\n"));
  const entered = deferred();
  const release = deferred();
  const controller = new AbortController();
  const events: string[] = [];
  const fs = intercept(memory, { async open(path, options) {
    const descriptor = await memory.open(path, options);
    return intercept(descriptor, {
      async read(buffer) {
        events.push("read"); entered.resolve();
        await release.promise;
        events.push("read-settled");
        buffer.set(Buffer.from("line\n"));
        return 5;
      },
      async close() { events.push("close"); await descriptor.close(); },
    });
  } });
  const shell = setup(async command => { await command.input.borrow(0).record(); return 0; }, fs);
  context.after(async () => { release.resolve(); controller.abort(cancellation); await shell.dispose(); });
  let settled = false;
  const outcome = shell.exec("probe </input", { signal: controller.signal }).then(
    result => ({ result }), failure => ({ failure }),
  ).finally(() => { settled = true; });
  try {
    await entered.promise;
    controller.abort(cancellation);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    assert.deepEqual(events, ["read"]);
  } finally { release.resolve(); }
  const result = await outcome;
  assert.ok("failure" in result);
  assert.equal(result.failure, cancellation);
  assert.deepEqual(events, ["read", "read-settled", "close"]);
});

test("source construction review: replacement invoke cursor teardown does not consume inherited finite input", async context => {
  let returned = 0;
  const seen: string[] = [];
  const shell = setup(async command => {
    const lease = command.input.borrow(0);
    const record = await lease.record();
    seen.push(Buffer.from(shellValueBytes(record.shellValue)).toString());
    await record.release(); await lease.release();
    return 0;
  });
  shell.register({ name: "relay", async execute(command) {
    assert.ok(command.invoke);
    await command.invoke("probe", [], { stdin: { async *[Symbol.asyncIterator]() {
      try { yield Buffer.from("replacement\nunused\n"); } finally { returned++; }
    } } });
    assert.equal(returned, 1);
    return command.invoke("probe", []);
  } });
  context.after(() => shell.dispose());
  assert.deepEqual(await shell.exec("relay", { stdin: "parent\n" }), { exitCode: 0, stdout: "", stderr: "", stdoutBytes: new Uint8Array(), stderrBytes: new Uint8Array() });
  assert.deepEqual(seen, ["replacement\n", "parent\n"]);
  assert.equal(returned, 1);
});

test("source construction review: early pipeline consumer completion joins the producer cleanup", { timeout: 2000 }, async context => {
  let finalized = 0;
  const seen: string[] = [];
  const shell = setup(async command => {
    const lease = command.input.borrow(0);
    const record = await lease.record();
    seen.push(Buffer.from(shellValueBytes(record.shellValue)).toString());
    await record.release(); await lease.release();
    return 0;
  });
  shell.register({ name: "producer", async execute(command) {
    command.registerCleanup?.(() => { finalized++; });
    await command.stdout.write(Buffer.from("first\n"));
    for (let index = 0; index < 128; index++) await command.stdout.write(new Uint8Array(1024));
    return { exitCode: 0 };
  } });
  context.after(() => shell.dispose());
  const result = await shell.exec("producer | probe");
  assert.deepEqual(result, { exitCode: 0, stdout: "", stderr: "", stdoutBytes: new Uint8Array(), stderrBytes: new Uint8Array() });
  assert.deepEqual(seen, ["first\n"]);
  assert.equal(finalized, 1);
});

for (const script of ["{ probe; probe; } <<'EOF'\nfirst\nsecond\nEOF\n", "printf 'first\\nsecond\\n' | { probe; probe; }"]) {
  test(`source construction review: sibling consumers retain the enclosing source ${JSON.stringify(script)}`, async context => {
    const seen: string[] = [];
    const shell = setup(async command => {
      const lease = command.input.borrow(0);
      const record = await lease.record();
      seen.push(Buffer.from(shellValueBytes(record.shellValue)).toString());
      await record.release(); await lease.release();
      return 0;
    });
    context.after(() => shell.dispose());
    assert.deepEqual(await shell.exec(script), { exitCode: 0, stdout: "", stderr: "", stdoutBytes: new Uint8Array(), stderrBytes: new Uint8Array() });
    assert.deepEqual(seen, ["first\n", "second\n"]);
  });
}
