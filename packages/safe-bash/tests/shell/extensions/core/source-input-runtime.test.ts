import assert from "node:assert/strict";
import test from "node:test";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { FsError } from "../../../../src/contracts/errors.js";
import { basicCommands } from "../../../../src/commands/basic.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";

function setup(execute: (command: ShellExtensionContext) => Promise<number>, fs: FileSystem = createMemoryFileSystem(), maxInputBytes?: number) {
  const shell = new Shell({ fs, ...(maxInputBytes === undefined ? {} : { limits: { maxInputBytes } }), extensions: [{ name: "source-input-probe", create: () => ({ builtins: [{ name: "probe", execute }] }) }] });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

function intercept<Target extends object>(subject: Target, overrides: Partial<Target>): Target {
  return new Proxy(subject, { get(target, key) {
    if (Object.hasOwn(overrides, key)) return Reflect.get(overrides, key);
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

for (const [label, stdin, hex] of [
  ["default", undefined, ""], ["empty string", "", ""], ["empty bytes", new Uint8Array(), ""],
  ["string", "payload\n", "7061796c6f61640a"], ["raw bytes", Uint8Array.of(255, 0, 10), "ff000a"],
] as const) test(`Shell finite owning input has nonconsuming readiness: ${label}`, async context => {
  const shell = setup(async command => {
    const lease = command.input.borrow(0);
    assert.equal(lease.stdinIsDefault, stdin === undefined);
    const expected = hex ? "ready" : "eof";
    assert.equal(lease.readiness(), expected);
    assert.equal(lease.readiness(), expected);
    const record = await lease.record();
    assert.equal(Buffer.from(shellValueBytes(record.shellValue)).toString("hex"), hex);
    await record.release();
    assert.equal(lease.readiness(), "eof");
    await lease.release();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("probe", stdin === undefined ? {} : { stdin });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("Shell finite input owns its admitted bytes before extension startup mutates the caller buffer", async context => {
  const bytes = Uint8Array.of(255, 10);
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "ownership", create: () => ({
    start() { bytes.fill(65); }, builtins: [{ name: "probe", async execute(command) {
      const lease = command.input.borrow(0);
      const record = await lease.record();
      assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 10));
      await record.release(); await lease.release();
      return 0;
    } }],
  }) }] });
  context.after(() => shell.dispose());
  const result = await shell.exec("probe", { stdin: bytes });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("finite input admission enforces maxInputBytes even when the command does not read", async context => {
  let executed = false;
  const shell = setup(async () => { executed = true; return 0; }, createMemoryFileSystem(), 2);
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("probe", { stdin: Uint8Array.of(1, 2, 3) }), error => error instanceof FsError && error.code === "EFBIG");
  assert.equal(executed, false);
});

for (const script of [
  "probe", "eval probe", ". /script", "source /script", "bash -c probe", "sh -c probe", "bash /script", "/executable",
  "probe <<EOF\npayload\nEOF\n", "probe <<<payload", "(probe)", 'printf "%s" "$(probe)"',
]) test(`finite cursor capabilities survive owning and borrowed paths: ${JSON.stringify(script)}`, async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/script", Buffer.from("probe\n"));
  await fs.writeFile("/executable", Buffer.from("#!/bin/bash\nprobe\n"));
  await fs.chmod("/executable", 0o755);
  let calls = 0;
  const shell = setup(async command => {
    calls++;
    const lease = command.input.borrow(0);
    assert.equal(lease.readiness(), "ready");
    const line = await lease.read(true, { timeoutMs: 1000 });
    assert.equal(line.reason, "delimiter");
    assert.equal(line.value, "payload");
    await line.release();
    assert.equal(lease.readiness(), "eof");
    await lease.release();
    return 0;
  }, fs);
  context.after(() => shell.dispose());
  const result = await shell.exec(script, { stdin: "payload\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(calls, 1);
});

test("stdin-fed interpreter and extension consume one shared finite cursor", async context => {
  const shell = setup(async command => {
    const lease = command.input.borrow(0);
    assert.equal(lease.readiness(), "ready");
    const record = await lease.record();
    assert.equal(Buffer.from(shellValueBytes(record.shellValue)).toString(), "payload\n");
    await record.release();
    assert.equal(lease.readiness(), "eof");
    await lease.release();
    return 0;
  });
  context.after(() => shell.dispose());
  const result = await shell.exec("bash", { stdin: "probe\npayload\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

for (const path of ["/input", "/dev/looks-special"]) test(`regular descriptor readiness comes from the descriptor, not pathname: ${path}`, async context => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dev", { recursive: true });
  await fs.writeFile(path, Buffer.from("one\ntwo\n"));
  const shell = setup(async command => {
    const first = command.input.borrow(3);
    const alias = command.input.borrow(4);
    assert.equal(first.readiness(), "ready");
    assert.equal(alias.readiness(), "ready");
    for (const [lease, expected] of [[first, "one"], [alias, "two"], [first, ""]] as const) {
      const record = await lease.read(true, { timeoutMs: Number.MIN_VALUE });
      assert.equal(record.value, expected);
      await record.release();
    }
    assert.equal(alias.readiness(), "eof");
    await first.release(); await alias.release();
    return 0;
  }, fs);
  context.after(() => shell.dispose());
  const result = await shell.exec(`probe 3<${path} 4<&3`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("an empty regular descriptor starts ready and then reports established EOF", async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/empty", new Uint8Array());
  const shell = setup(async command => {
    const lease = command.input.borrow(0);
    assert.equal(lease.readiness(), "ready");
    const record = await lease.read(true, { timeoutMs: Number.MIN_VALUE });
    assert.equal(record.reason, "eof");
    await record.release();
    assert.equal(lease.readiness(), "eof");
    await lease.release();
    return 0;
  }, fs);
  context.after(() => shell.dispose());
  const result = await shell.exec("probe </empty");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("unconsumed redirected descriptor is opened once, never read, and closed once", async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("unused\n"));
  let opens = 0; let reads = 0; let closes = 0;
  const fs = intercept(memory, { async open(path, options) {
    opens++;
    const descriptor = await memory.open(path, options);
    return intercept(descriptor, {
      async read(...args) { reads++; return descriptor.read(...args); },
      async close() { closes++; await descriptor.close(); },
    });
  } });
  const shell = setup(async command => { const lease = command.input.borrow(0); await lease.release(); return 0; }, fs);
  context.after(() => shell.dispose());
  const result = await shell.exec("probe </input");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual({ opens, reads, closes }, { opens: 1, reads: 0, closes: 1 });
});

for (const reason of [false, 0, "", null]) test(`a single redirected descriptor close failure retains its identity once: ${String(reason)}`, async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("unused\n"));
  let closes = 0;
  const fs = intercept(memory, { async open(path, options) {
    const descriptor = await memory.open(path, options);
    return intercept(descriptor, { async close() { closes++; await descriptor.close(); throw reason; } });
  } });
  const shell = setup(async () => 0, fs);
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("probe </input"), error => Object.is(error, reason));
  assert.equal(closes, 1);
});

test("distinct redirected descriptors retain separate identical falsey close failures", async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/first", new Uint8Array());
  await memory.writeFile("/second", new Uint8Array());
  const closed: string[] = [];
  const fs = intercept(memory, { async open(path, options) {
    const descriptor = await memory.open(path, options);
    return intercept(descriptor, { async close() { closed.push(path); await descriptor.close(); throw false; } });
  } });
  const shell = setup(async () => 0, fs);
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("probe </first </second"), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [false, false]);
    return true;
  });
  assert.deepEqual(closed, ["/first", "/second"]);
});

test("descriptor metadata allows character deadlines without inventing readiness or trusting size", async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/ordinary", Buffer.from("record\n"));
  const fs = intercept(memory, { async open(path, options) {
    const descriptor = await memory.open(path, options);
    return intercept(descriptor, { async stat(options) { return { ...await descriptor.stat(options), type: "character", size: 0 }; } });
  } });
  const shell = setup(async command => {
    const lease = command.input.borrow(0);
    assert.equal(lease.readiness(), "unknown");
    const record = await lease.read(true, { timeoutMs: 1000 });
    assert.equal(record.value, "record");
    await record.release(); await lease.release();
    return 0;
  }, fs);
  context.after(() => shell.dispose());
  const result = await shell.exec("probe </ordinary");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("legacy file streams remain unknown and refuse deadlines before consumption", async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("line\n"));
  let reads = 0;
  const fs = intercept<FileSystem>(memory, {
    capabilities: { ...memory.capabilities, open: false },
    async open() { throw new FsError("ENOTSUP"); },
    readStream() { return { async *[Symbol.asyncIterator]() { reads++; yield Buffer.from("line\n"); } }; },
  });
  const shell = setup(async command => {
    const lease = command.input.borrow(0);
    assert.equal(lease.readiness(), "unknown");
    await assert.rejects(lease.read(true, { timeoutMs: 1 }), /provenance/u);
    assert.equal(reads, 0);
    const record = await lease.record();
    await record.release(); await lease.release();
    return 0;
  }, fs);
  context.after(() => shell.dispose());
  const result = await shell.exec("probe </input");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(reads, 1);
});

test("pipeline readiness is nonconsuming and positive reads use its stream capability", async context => {
  let start!: () => void;
  const ready = new Promise<void>(resolve => { start = resolve; });
  const shell = setup(async command => {
    const lease = command.input.borrow(0);
    try { assert.equal(lease.readiness(), "blocked"); }
    finally { start(); }
    const record = await lease.read(true, { timeoutMs: 1000 });
    assert.equal(record.value, "payload");
    await record.release();
    const eof = await lease.record();
    assert.equal(eof.reason, "eof");
    await eof.release();
    assert.equal(lease.readiness(), "eof");
    await lease.release();
    return 0;
  });
  shell.register({ name: "producer", async execute(command) { await ready; await command.stdout.write(Buffer.from("payload\n")); return { exitCode: 0 }; } });
  context.after(() => shell.dispose());
  const result = await shell.exec("producer | probe");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

for (const target of ["probe", "/executable"]) for (const mode of ["inherit", "explicit", "opaque"] as const) test(`command invocation replacement preserves owned cursors but not opaque provenance: ${target}, ${mode}`, async context => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/executable", Buffer.from("#!/bin/bash\nprobe\n"));
  await fs.chmod("/executable", 0o755);
  const shell = setup(async command => {
    const lease = command.input.borrow(0);
    assert.equal(lease.readiness(), mode === "opaque" ? "unknown" : "ready");
    if (mode === "opaque") await assert.rejects(lease.read(true, { timeoutMs: 1 }), /provenance/u);
    const record = await lease.record();
    assert.equal(Buffer.from(shellValueBytes(record.shellValue)).toString(), "payload\n");
    await record.release(); await lease.release();
    return 0;
  }, fs);
  shell.register({ name: "relay", async execute(command) {
    assert.ok(command.invoke);
    return command.invoke(target, [], mode === "inherit" ? {} : { stdin: mode === "explicit" ? command.stdin : { async *[Symbol.asyncIterator]() { yield Buffer.from("payload\n"); } } });
  } });
  context.after(() => shell.dispose());
  const result = await shell.exec("relay", { stdin: "payload\n" });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

for (const reason of [false, 0, "", null]) test(`late redirected descriptor acquisition drains and closes after root cancellation: ${String(reason)}`, async context => {
  const memory = createMemoryFileSystem();
  await memory.writeFile("/input", Buffer.from("payload\n"));
  const controller = new AbortController();
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  let opens = 0; let closes = 0; let reads = 0;
  const fs = intercept(memory, { async open(path, options) {
    opens++;
    const descriptor = await memory.open(path, options);
    await gate;
    return intercept(descriptor, {
      async read(...args) { reads++; return descriptor.read(...args); },
      async close() { closes++; await descriptor.close(); },
    });
  } });
  const shell = setup(async command => {
    const lease = command.input.borrow(0);
    const record = await lease.record();
    await record.release(); await lease.release();
    return 0;
  }, fs);
  context.after(() => shell.dispose());
  const execution = shell.exec("probe </input", { signal: controller.signal }).then(result => ({ result }), failure => ({ failure }));
  await new Promise<void>(resolve => setImmediate(resolve));
  controller.abort(reason);
  finish();
  const outcome = await execution;
  assert.equal(opens, 1);
  assert.ok("failure" in outcome);
  assert.equal(Object.is(outcome.failure, reason), true);
  assert.equal(reads, 0);
  assert.equal(closes, 1);
});

for (const reason of [false, 0, "", null]) test(`opaque-source root cancellation preserves reason and waits for teardown: ${String(reason)}`, async context => {
  const controller = new AbortController();
  let finalized = false;
  const shell = setup(async command => {
    const lease = command.input.borrow(0);
    assert.equal(lease.readiness(), "unknown");
    await lease.record();
    return 0;
  });
  context.after(() => shell.dispose());
  const stdin = { async *[Symbol.asyncIterator]() { try { controller.abort(reason); yield Uint8Array.of(255); } finally { finalized = true; } } };
  await assert.rejects(shell.exec("probe", { stdin, signal: controller.signal }), error => Object.is(error, reason));
  assert.equal(finalized, true);
});
