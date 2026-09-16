import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileSystem } from "poe-code/safe-fs";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";
import { shellValueBytes } from "../../../../src/contracts/value.js";

interface Observer {
  readonly readable: boolean;
  probeRead(): Promise<{ readonly readiness: "ready" | "blocked" | "unknown"; readonly timeout: "honor" | "ignore" | "unknown" }>;
  waitRead(options: { readonly timeoutMs: number; readonly signal?: AbortSignal }): Promise<"ready" | "timeout" | "unknown">;
  release(): Promise<void>;
}

function observe(input: ShellExtensionContext["input"], descriptor: number): Observer {
  const method: unknown = Reflect.get(input, "observe");
  assert.equal(typeof method, "function", "input.observe must distinguish open write-only FDs from readable borrowing");
  return (method as (descriptor: number) => Observer).call(input, descriptor);
}

function override<Value extends object>(target: Value, replacements: Partial<Value>): Value {
  return new Proxy(target, { get(object, key) {
    if (Object.hasOwn(replacements, key)) return Reflect.get(replacements, key);
    const member: unknown = Reflect.get(object, key, object);
    return typeof member === "function" ? member.bind(object) : member;
  } });
}

function setup(execute: (context: ShellExtensionContext) => Promise<number>, fs: FileSystem = createMemoryFileSystem()) {
  return { fs, shell: new Shell({ fs, extensions: [{ name: "observe-descriptor", create: () => ({ builtins: [{ name: "observefd", execute }] }) }] }) };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

for (const script of ["observefd >out", "observefd >>out", "observefd 3>out 1>&3", "observefd &>out", "{ observefd; } >out", "(observefd) >out", "bash -c observefd >out", "sh -c observefd >out"]) {
  test(`regular write-only observation is ready without making borrow readable: ${script}`, async context => {
    const subject = setup(async invocation => {
      const observer = observe(invocation.input, 1);
      assert.equal(observer.readable, false);
      assert.throws(() => invocation.input.borrow(1), { code: "EBADF" });
      assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "ignore" });
      assert.equal(await observer.waitRead({ timeoutMs: 1 }), "ready");
      await observer.release();
      await observer.release();
      await invocation.stdout.write(Uint8Array.of(97));
      return 0;
    });
    context.after(() => subject.shell.dispose());
    const result = await subject.shell.exec(script);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await subject.fs.readFile("/out"), Uint8Array.of(97));
  });
}

test("observer captures the retained descriptor across rename without pathname stat or reopen", async context => {
  const backing = createMemoryFileSystem();
  let opens = 0;
  let stats = 0;
  let closes = 0;
  const fs = override(backing, {
    async open(path, options) {
      opens++;
      const descriptor = await backing.open!(path, options);
      return override(descriptor, {
        async stat(options) { stats++; return descriptor.stat(options); },
        async close() { closes++; await descriptor.close(); },
      });
    },
    async stat(path, options) {
      // Creation capability admission may inspect parent paths before open.
      // Once retained, all observer metadata must come from that descriptor.
      assert.equal(opens, 0, "descriptor observation must not stat a pathname");
      return backing.stat(path, options);
    },
  });
  const subject = setup(async invocation => {
    const observer = observe(invocation.input, 1);
    await backing.rename("/out", "/moved");
    await backing.mkdir("/out");
    assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "ignore" });
    await observer.release();
    assert.equal(closes, 0);
    await invocation.stdout.write(Uint8Array.of(98));
    return 0;
  }, fs);
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("observefd >out");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(opens, 1);
  assert.equal(stats, 1);
  assert.equal(closes, 1);
  assert.deepEqual(await backing.readFile("/moved"), Uint8Array.of(98));
  assert.equal((await backing.stat("/out")).type, "directory");
});

test("readable regular observation leaves all raw bytes for a later borrow", async context => {
  const backing = createMemoryFileSystem();
  await backing.writeFile("/input", Uint8Array.of(255, 0, 97));
  let reads = 0;
  const subject = setup(async invocation => {
    const observer = observe(invocation.input, 3);
    assert.equal(observer.readable, true);
    assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "ignore" });
    assert.equal(reads, 0);
    await observer.release();
    const input = invocation.input.borrow(3);
    const record = await input.record();
    assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 97));
    await record.release();
    await input.release();
    assert.equal(reads, 2);
    return 0;
  }, override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async read(...args) { reads++; return descriptor.read(...args); } });
  } }));
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("observefd 3<input");
  assert.equal(result.exitCode, 0, result.stderr);
});

for (const descriptor of [1, 2]) test(`opaque host output ${descriptor} stays unknown`, async context => {
  const subject = setup(async invocation => {
    const observer = observe(invocation.input, descriptor);
    assert.equal(observer.readable, false);
    assert.deepEqual(await observer.probeRead(), { readiness: "unknown", timeout: "unknown" });
    assert.equal(await observer.waitRead({ timeoutMs: 1 }), "unknown");
    await observer.release();
    return 0;
  });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("observefd");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("missing descriptors and malformed numbers refuse observation at admission", async context => {
  const subject = setup(async invocation => {
    for (const descriptor of [3, 9]) assert.throws(() => observe(invocation.input, descriptor), { code: "EBADF" });
    for (const descriptor of [-1, 0.5, NaN, Infinity]) assert.throws(() => observe(invocation.input, descriptor), RangeError);
    return 0;
  });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("observefd 3>&-");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("released observation refuses new work without closing its FD", async context => {
  const subject = setup(async invocation => {
    const observer = observe(invocation.input, 1);
    await observer.release();
    await assert.rejects(observer.probeRead(), { code: "EBADF" });
    await assert.rejects(observer.waitRead({ timeoutMs: 1 }), { code: "EBADF" });
    await invocation.stdout.write(Uint8Array.of(1));
    return 0;
  });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("observefd >out");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await subject.fs.readFile("/out"), Uint8Array.of(1));
});

for (const reason of [false, 0, "", null]) test(`observer forwards falsey local wait cancellation ${String(reason)} without closing FD`, async context => {
  const subject = setup(async invocation => {
    const observer = observe(invocation.input, 1);
    const controller = new AbortController();
    controller.abort(reason);
    await assert.rejects(observer.waitRead({ timeoutMs: 1, signal: controller.signal }), error => Object.is(error, reason));
    assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "ignore" });
    await observer.release();
    await invocation.stdout.write(Uint8Array.of(1));
    return 0;
  });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("observefd >out");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("release cancels and joins admitted metadata observation but retains output admission", async context => {
  const backing = createMemoryFileSystem();
  const entered = deferred(), releaseStat = deferred();
  let observer!: Observer;
  let released = false;
  let closes = 0;
  const subject = setup(async invocation => {
    observer = observe(invocation.input, 1);
    const rejected = assert.rejects(observer.probeRead(), { code: "EBADF" });
    await entered.promise;
    const releasing = observer.release().then(() => { released = true; });
    await Promise.resolve();
    assert.equal(released, false);
    assert.equal(closes, 0);
    releaseStat.resolve();
    await Promise.all([rejected, releasing]);
    await invocation.stdout.write(Uint8Array.of(1));
    return 0;
  }, override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, {
      async stat(options) { entered.resolve(); await releaseStat.promise; options?.signal?.throwIfAborted(); return descriptor.stat(options); },
      async close() { closes++; await descriptor.close(); },
    });
  } }));
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("observefd >out");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(closes, 1);
});

for (const timeoutMs of [0, -1, NaN, Infinity, -Infinity]) test(`wait rejects invalid timeout ${String(timeoutMs)} before provider observation`, async context => {
  const backing = createMemoryFileSystem();
  let stats = 0;
  const subject = setup(async invocation => {
    const observer = observe(invocation.input, 1);
    await assert.rejects(observer.waitRead({ timeoutMs }), RangeError);
    assert.equal(stats, 0);
    await observer.release();
    return 0;
  }, override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, { async stat(options) { stats++; return descriptor.stat(options); } });
  } }));
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("observefd >out");
  assert.equal(result.exitCode, 0, result.stderr);
});

test("wait captures caller option getters once", async context => {
  const controller = new AbortController();
  let timeoutReads = 0;
  let signalReads = 0;
  const subject = setup(async invocation => {
    const observer = observe(invocation.input, 1);
    assert.equal(await observer.waitRead({
      get timeoutMs() { timeoutReads++; return 0.01; },
      get signal() { signalReads++; return controller.signal; },
    }), "ready");
    assert.equal(timeoutReads, 1);
    assert.equal(signalReads, 1);
    await observer.release();
    return 0;
  });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("observefd >out");
  assert.equal(result.exitCode, 0, result.stderr);
});

for (const reason of [false, 0, "", null]) test(`root cancellation ${String(reason)} outranks late metadata failure and drains before close`, async context => {
  const backing = createMemoryFileSystem();
  const entered = deferred(), releaseStat = deferred();
  const controller = new AbortController();
  let closes = 0;
  let settled = false;
  const subject = setup(async invocation => {
    const observer = observe(invocation.input, 1);
    await observer.probeRead();
    return 0;
  }, override(backing, { async open(path, options) {
    const descriptor = await backing.open!(path, options);
    return override(descriptor, {
      async stat() { entered.resolve(); await releaseStat.promise; throw new Error("late metadata failure"); },
      async close() { closes++; await descriptor.close(); },
    });
  } }));
  context.after(() => subject.shell.dispose());
  const execution = subject.shell.exec("observefd >out", { signal: controller.signal });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(execution, error => Object.is(error, reason));
  await entered.promise;
  try {
    controller.abort(reason);
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(closes, 0);
  } finally { releaseStat.resolve(); await rejected; }
  assert.equal(closes, 1);
});

test("an observer which escapes the invocation cannot admit another operation", async context => {
  let saved!: Observer;
  const subject = setup(async invocation => { saved = observe(invocation.input, 1); return 0; });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("observefd >out");
  assert.equal(result.exitCode, 0, result.stderr);
  await assert.rejects(saved.probeRead());
  await assert.rejects(saved.waitRead({ timeoutMs: 1 }));
  await saved.release();
  await saved.release();
});
