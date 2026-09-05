import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createMemoryFileSystem } from "poe-code/safe-fs";
import { browserCommands } from "../../../../src/browser.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ownPipeDescriptor, pipeObservation, PipeDescriptorFrame, type PipeDescriptorReference } from "../../../../src/shell/descriptors.js";
import { createBytePipe, outputFailure, type PipeWriteEndpoint } from "../../../../src/contracts/io.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { InvocationScope } from "../../../../src/shell/cleanup.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

for (const duration of [0.125, 2_147_483_647.5, 9_000_000_000]) test(`pipe wait keeps one deadline across revision wakes: ${duration}`, async context => {
  let now = 100;
  context.mock.method(performance, "now", () => now);
  let revision = 0n;
  const waits: number[] = [];
  const endpoint: PipeWriteEndpoint = {
    direction: "write",
    writable: { async write() { throw new Error("Observation must not write"); } },
    acquire() { throw new Error("Observation must not acquire a peer alias"); },
    async close() { throw new Error("Observation must not close the FD"); },
    probe: () => ({ revision, ready: false, peerClosed: false }),
    async waitForChange(previous, options) {
      assert.equal(previous, revision);
      assert.ok(Number.isSafeInteger(options.timeoutMs));
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 2_147_483_647);
      waits.push(options.timeoutMs);
      if (waits.length === 1) now += Math.min(duration / 2, 0.0625);
      else now += options.timeoutMs;
      revision++;
      return { revision, ready: false, peerClosed: false };
    },
  };
  const observation = pipeObservation(endpoint);
  assert.deepEqual(await observation.probeRead(new AbortController().signal), { readiness: "blocked", timeout: "honor" });
  assert.equal(await observation.waitRead!({ timeoutMs: duration, deadline: now + duration, signal: new AbortController().signal }), "timeout");
  assert.ok(waits.length >= 2 && waits.length <= 7);
  assert.ok(now >= 100 + duration && now < 101 + duration);
});

for (const buffered of [false, true]) test(`write-end read observation ignores reader-side buffered data: buffered=${buffered}`, async context => {
  const releaseReader = deferred();
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 }, extensions: [{
    name: "write-observation",
    create: () => ({ builtins: [{ name: "inspectwriter", async execute(invocation) {
      try {
        if (buffered) await invocation.stdout.write(Uint8Array.of(88, 10));
        const observer = invocation.input.observe(1);
        assert.equal(observer.readable, false);
        assert.deepEqual(await observer.probeRead(), { readiness: "blocked", timeout: "honor" });
        assert.equal(await observer.waitRead({ timeoutMs: 1 }), "timeout");
        await observer.release();
        return 0;
      } finally { releaseReader.resolve(); }
    } }] }),
  }] }).use(browserCommands());
  shell.register({ name: "holdreader", async execute() { await releaseReader.promise; return { exitCode: 0 }; } });
  context.after(() => shell.dispose());
  const result = await shell.exec("inspectwriter | holdreader");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("duplicated write endpoint retains directional observation after stdout replacement", async context => {
  const releaseReader = deferred();
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 }, extensions: [{
    name: "write-alias-observation",
    create: () => ({ builtins: [{ name: "inspectwriter", async execute(invocation) {
      try {
        const observer = invocation.input.observe(3);
        assert.equal(observer.readable, false);
        assert.deepEqual(await observer.probeRead(), { readiness: "blocked", timeout: "honor" });
        await observer.release();
        const saved = invocation.input.observe(1);
        assert.deepEqual(await saved.probeRead(), { readiness: "unknown", timeout: "unknown" });
        await saved.release();
        return 0;
      } finally { releaseReader.resolve(); }
    } }] }),
  }] }).use(browserCommands());
  shell.register({ name: "holdreader", async execute() { await releaseReader.promise; return { exitCode: 0 }; } });
  context.after(() => shell.dispose());
  const result = await shell.exec("{ { inspectwriter; } 3>&1 1>&4 | holdreader; } 4>&1");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("last writer alias closure exposes EOF while its producer stage remains active", async context => {
  const producerWaiting = deferred(), releaseProducer = deferred();
  let producerExited = false;
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 }, extensions: [{
    name: "last-writer-observation",
    create: () => ({ builtins: [{ name: "inspectreader", async execute(invocation) {
      try {
        await producerWaiting.promise;
        const observer = invocation.input.observe(0);
        assert.equal(observer.readable, true);
        assert.equal(producerExited, false);
        assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "honor" });
        assert.equal(await observer.waitRead({ timeoutMs: 1 }), "ready");
        await observer.release();
        return 0;
      } finally { releaseProducer.resolve(); }
    } }] }),
  }] }).use(browserCommands());
  shell.register({ name: "producerwaiting", async execute() {
    producerWaiting.resolve();
    await releaseProducer.promise;
    producerExited = true;
    return { exitCode: 0 };
  } });
  context.after(() => shell.dispose());
  const result = await shell.exec("{ : 3>&1-; producerwaiting; } | inspectreader");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(producerExited, true);
});

for (const child of ["( : 3>&1- )", "bash -c ': 3>&1-'", "sh -c ': 3>&1-'", "./child.sh", "delegate"]) test(`child FD moves do not close the parent writer: ${child}`, async context => {
  const releaseReader = deferred();
  const fs = createMemoryFileSystem();
  await fs.writeFile("/child.sh", new TextEncoder().encode(": 3>&1-\n"));
  await fs.chmod("/child.sh", 0o755);
  const shell = new Shell({ fs, limits: { maxWallClockMs: 2000 }, extensions: [{
    name: "forked-writer-observation",
    create: () => ({ builtins: [{ name: "inspectwriter", async execute(invocation) {
      try {
        const observer = invocation.input.observe(1);
        assert.deepEqual(await observer.probeRead(), { readiness: "blocked", timeout: "honor" });
        await observer.release();
        await invocation.stdout.write(Uint8Array.of(255, 0, 97));
        return 0;
      } finally { releaseReader.resolve(); }
    } }] }),
  }] }).use(browserCommands());
  shell.register({ name: "delegate", async execute(invocation) {
    assert.ok(invocation.invoke);
    return invocation.invoke("child", []);
  } });
  shell.register({ name: "holdreader", async execute(invocation) {
    await releaseReader.promise;
    const bytes: number[] = [];
    for await (const chunk of invocation.stdin) bytes.push(...chunk);
    assert.deepEqual(bytes, [255, 0, 97]);
    return { exitCode: 0 };
  } });
  context.after(() => shell.dispose());
  const result = await shell.exec(`child() { : 3>&1-; }; { ${child}; inspectwriter; } | holdreader`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("last reader alias closure makes writer read-select ready without ending its stage", async context => {
  const readerWaiting = deferred(), releaseReader = deferred();
  let readerExited = false;
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 }, extensions: [{
    name: "last-reader-observation",
    create: () => ({ builtins: [{ name: "inspectwriter", async execute(invocation) {
      try {
        await readerWaiting.promise;
        const observer = invocation.input.observe(1);
        assert.equal(observer.readable, false);
        assert.equal(readerExited, false);
        assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "honor" });
        assert.equal(await observer.waitRead({ timeoutMs: 0.125 }), "ready");
        assert.throws(() => invocation.input.borrow(1), { code: "EBADF" });
        await observer.release();
        return 0;
      } finally { releaseReader.resolve(); }
    } }] }),
  }] }).use(browserCommands());
  shell.register({ name: "readerwaiting", async execute() {
    readerWaiting.resolve();
    await releaseReader.promise;
    readerExited = true;
    return { exitCode: 0 };
  } });
  context.after(() => shell.dispose());
  const result = await shell.exec("inspectwriter | { : 3<&0-; readerwaiting; }");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(readerExited, true);
});

test("owned endpoint close enrolls idempotent drain before provider reentry", async () => {
  const gate = deferred();
  const budget = new Budget(defaultLimits);
  const pipe = createBytePipe();
  let reentrant: Promise<void> | undefined;
  let calls = 0;
  const endpoint = pipe.endpoints!.write;
  const reference: PipeDescriptorReference = ownPipeDescriptor({ ...endpoint, close() {
    calls++;
    if (calls === 1) reentrant = reference.close();
    return gate.promise.then(() => endpoint.close());
  } }, budget);
  const retained = budget.values.usage.bytes;
  assert.ok(retained >= 96);
  try {
    const closing = reference.close();
    assert.equal(reference.close(), closing);
    assert.equal(reentrant, closing);
    assert.equal(calls, 1);
    assert.throws(() => reference.acquire(), { code: "EBADF" });
    assert.equal(budget.values.usage.bytes, retained);
    gate.resolve();
    await closing;
    assert.equal(budget.values.usage.bytes, 0);
  } finally {
    gate.resolve();
    await reference.close();
    await pipe.endpoints!.read.close();
    budget.close();
    budget.values.close();
  }
});

test("FD frame cleanup joins the admitted endpoint retirement and closes admission", async () => {
  const budget = new Budget(defaultLimits);
  const scope = new InvocationScope(budget.signal);
  const gate = deferred();
  const pipe = createBytePipe();
  const endpoint = pipe.endpoints!.write;
  const frame = new PipeDescriptorFrame(scope);
  let reentrant: Promise<void> | undefined;
  frame.open({ ...endpoint, close() {
    reentrant = frame.close();
    return gate.promise.then(() => endpoint.close());
  } }, budget);
  try {
    const closing = frame.close();
    assert.equal(frame.close(), closing);
    assert.equal(reentrant, closing);
    assert.throws(() => frame.open(endpoint, budget), { code: "EBADF" });
    let cleanupDone = false;
    const cleanup = scope.close().then(() => { cleanupDone = true; });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(cleanupDone, false);
    assert.ok(budget.values.usage.bytes > 0);
    gate.resolve();
    await Promise.all([closing, cleanup]);
    assert.equal(budget.values.usage.bytes, 0);
  } finally {
    gate.resolve();
    await scope.close();
    await pipe.endpoints!.read.close();
    budget.close();
    budget.values.close();
  }
});

for (const child of ["( : )", "bash -c ':'", "sh -c ':'", "captured=$(printf captured)", "printf ignored | cat", "delegate"]) test(`child frame retirement leaves no writer alias behind: ${child}`, async context => {
  const producerWaiting = deferred(), releaseProducer = deferred();
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 }, extensions: [{
    name: "retired-writer-frame",
    create: () => ({ builtins: [{ name: "inspectreader", async execute(invocation) {
      try {
        await producerWaiting.promise;
        const observer = invocation.input.observe(0);
        assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "honor" });
        await observer.release();
        const input = invocation.input.borrow(0);
        try {
          while (true) {
            const result = await input.record({ delimiter: 10 });
            const done = result.reason === "eof";
            await result.release();
            if (done) break;
          }
        } finally { await input.release(); }
        return 0;
      } finally { releaseProducer.resolve(); }
    } }] }),
  }] }).use(browserCommands());
  shell.register({ name: "delegate", async execute(invocation) {
    assert.ok(invocation.invoke);
    return invocation.invoke("true", []);
  } });
  shell.register({ name: "producerwaiting", async execute() {
    producerWaiting.resolve();
    await releaseProducer.promise;
    return { exitCode: 0 };
  } });
  context.after(() => shell.dispose());
  const result = await shell.exec(`{ ${child}; : 3>&1-; producerwaiting; } | inspectreader`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

const nativeStaticCases = [
  { name: "writer-open", body: "{ producerwaiting; } | inspectreader", descriptor: 0, readiness: "blocked" },
  { name: "writer-saved-alias", body: "{ : 3>&1-; producerwaiting; } 4>&1 | inspectreader", descriptor: 0, readiness: "blocked" },
  { name: "writer-child-subshell", body: "{ ( : 3>&1- ); producerwaiting; } | inspectreader", descriptor: 0, readiness: "blocked" },
  { name: "writer-function-move", body: "child() { : 3>&1-; }; { child; producerwaiting; } | inspectreader", descriptor: 0, readiness: "ready" },
  { name: "writer-redirect-save-stack", body: "{ : 3>&1-; producerwaiting; } 4>&1 4>&- | inspectreader", descriptor: 0, readiness: "ready" },
  { name: "reader-open", body: "inspectwriter | { readerwaiting; }", descriptor: 1, readiness: "blocked" },
  { name: "reader-saved-alias", body: "inspectwriter | { : 3<&0-; readerwaiting; } 4<&0", descriptor: 1, readiness: "blocked" },
  { name: "reader-child-subshell", body: "inspectwriter | { ( : 3<&0- ); readerwaiting; }", descriptor: 1, readiness: "blocked" },
  { name: "reader-function-move", body: "child() { : 3<&0-; }; inspectwriter | { child; readerwaiting; }", descriptor: 1, readiness: "ready" },
] as const;

for (const fixture of nativeStaticCases) test(`Bash 5.3 static live-peer qualification: ${fixture.name}`, async context => {
  const started = deferred(), observed = deferred();
  let peerLive = false;
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 }, extensions: [{
    name: "native-static-observation",
    create: () => ({ builtins: [{ name: fixture.descriptor === 0 ? "inspectreader" : "inspectwriter", async execute(invocation) {
      try {
        await started.promise;
        assert.equal(peerLive, true);
        const observer = invocation.input.observe(fixture.descriptor);
        assert.equal(observer.readable, fixture.descriptor === 0);
        assert.deepEqual(await observer.probeRead(), { readiness: fixture.readiness, timeout: "honor" });
        await observer.release();
        assert.equal(peerLive, true);
        return 0;
      } finally { observed.resolve(); }
    } }] }),
  }] }).use(browserCommands());
  shell.register({ name: fixture.descriptor === 0 ? "producerwaiting" : "readerwaiting", async execute() {
    peerLive = true;
    started.resolve();
    await observed.promise;
    peerLive = false;
    return { exitCode: 0 };
  } });
  context.after(() => shell.dispose());
  const result = await shell.exec(fixture.body);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(peerLive, false);
});

for (const reason of [false, 0, "", null]) test(`pipe observation local cancellation retains reason ${String(reason)} without closing FD aliases`, async context => {
  const releaseReader = deferred();
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 }, extensions: [{
    name: "pipe-observation-cancel",
    create: () => ({ builtins: [{ name: "inspectwriter", async execute(invocation) {
      try {
        const observer = invocation.input.observe(1);
        const cancellation = new AbortController();
        const rejected = assert.rejects(observer.waitRead({ timeoutMs: 9_000_000_000, signal: cancellation.signal }), error => Object.is(error, reason));
        cancellation.abort(reason);
        await rejected;
        assert.deepEqual(await observer.probeRead(), { readiness: "blocked", timeout: "honor" });
        await observer.release();
        await invocation.stdout.write(Uint8Array.of(255, 0, 97));
        return 0;
      } finally { releaseReader.resolve(); }
    } }] }),
  }] }).use(browserCommands());
  shell.register({ name: "holdreader", async execute(invocation) {
    await releaseReader.promise;
    const bytes: number[] = [];
    for await (const chunk of invocation.stdin) bytes.push(...chunk);
    assert.deepEqual(bytes, [255, 0, 97]);
    return { exitCode: 0 };
  } });
  context.after(() => shell.dispose());
  const result = await shell.exec("inspectwriter | holdreader");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("evaluate closes a moved binding without retargeting a captured observer or adding a peer alias", async context => {
  const moved = deferred(), observed = deferred();
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 }, extensions: [{
    name: "captured-pipe-observation",
    create: () => ({ builtins: [{ name: "movebinding", async execute(invocation) {
      const observer = invocation.input.observe(1);
      assert.deepEqual(await observer.probeRead(), { readiness: "blocked", timeout: "honor" });
      assert.equal(await invocation.evaluate(": 3>&1-"), 0);
      assert.throws(() => invocation.input.observe(1), { code: "EBADF" });
      await assert.rejects(observer.probeRead(), { code: "EBADF" });
      moved.resolve();
      try { await observed.promise; }
      finally { await observer.release(); }
      return 0;
    } }, { name: "inspectreader", async execute(invocation) {
      try {
        await moved.promise;
        const observer = invocation.input.observe(0);
        assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "honor" });
        await observer.release();
        return 0;
      } finally { observed.resolve(); }
    } }] }),
  }] }).use(browserCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("movebinding | inspectreader");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("nested pipeline stderr retains its inherited directional endpoint", async context => {
  const inspected = deferred();
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 }, extensions: [{
    name: "nested-stderr-observer",
    create: () => ({ builtins: [{ name: "inspecterror", async execute(invocation) {
      try {
        const observer = invocation.input.observe(2);
        assert.equal(observer.readable, false);
        assert.deepEqual(await observer.probeRead(), { readiness: "blocked", timeout: "honor" });
        await observer.release();
        return 0;
      } finally { inspected.resolve(); }
    } }] }),
  }] }).use(browserCommands());
  shell.register({ name: "holdreader", async execute() { await inspected.promise; return { exitCode: 0 }; } });
  context.after(() => shell.dispose());
  const result = await shell.exec("{ inspecterror | :; } 2>&1 | holdreader");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("stdin interpreter retains its pipe endpoint through the parser cursor view", async context => {
  const inspected = deferred();
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 }, extensions: [{
    name: "interpreter-input-observer",
    create: () => ({ builtins: [{ name: "inspectreader", async execute(invocation) {
      try {
        const observer = invocation.input.observe(0);
        assert.equal(observer.readable, true);
        assert.deepEqual(await observer.probeRead(), { readiness: "blocked", timeout: "honor" });
        assert.equal(await observer.waitRead({ timeoutMs: 1 }), "timeout");
        await observer.release();
        return 0;
      } finally { inspected.resolve(); }
    } }] }),
  }] }).use(browserCommands());
  shell.register({ name: "scriptwriter", async execute(invocation) {
    await invocation.stdout.write(new TextEncoder().encode("inspectreader\n"));
    await inspected.promise;
    return { exitCode: 0 };
  } });
  context.after(() => shell.dispose());
  const result = await shell.exec("scriptwriter | bash -s");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("normal reader retirement does not cancel a writer which makes no further write", async context => {
  const written = deferred();
  let producerCompleted = false;
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 }, extensions: [{
    name: "normal-peer-close",
    create: () => ({ builtins: [{ name: "waitforpeer", async execute(invocation) {
      await invocation.stdout.write(Uint8Array.of(97));
      written.resolve();
      const observer = invocation.input.observe(1);
      try {
        assert.equal(await observer.waitRead({ timeoutMs: 1000 }), "ready");
        await nextTurn();
        assert.equal(invocation.signal.aborted, false);
        assert.deepEqual(await observer.probeRead(), { readiness: "ready", timeout: "honor" });
        producerCompleted = true;
        return 0;
      } finally { await observer.release(); }
    } }] }),
  }] }).use(browserCommands());
  shell.register({ name: "readerexit", async execute() { await written.promise; return { exitCode: 0 }; } });
  context.after(() => shell.dispose());
  const result = await shell.exec("set -o pipefail; waitforpeer | readerexit");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(producerCompleted, true);
});

for (const reason of [undefined, false, 0, "", null]) test(`pipeline output failure forwards the exact reason ${String(reason)} to its reader`, async context => {
  const reading = deferred();
  let observed: { reason: unknown } | undefined;
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxWallClockMs: 2000 } });
  shell.register({ name: "failpipe", async execute(invocation) {
    await reading.promise;
    const fail = invocation.stdout[outputFailure];
    assert.equal(typeof fail, "function");
    await fail!.call(invocation.stdout, reason);
    return { exitCode: 0 };
  } });
  shell.register({ name: "inspectfailure", async execute(invocation) {
    const reader = invocation.stdin[Symbol.asyncIterator]();
    const pending = reader.next().then(
      result => { assert.fail(`Expected read failure, received done=${String(result.done)}`); },
      failure => { observed = { reason: failure }; },
    );
    reading.resolve();
    try { await pending; }
    finally { await reader.return?.(); }
    return { exitCode: 0 };
  } });
  context.after(() => shell.dispose());
  const result = await shell.exec("failpipe | inspectfailure");
  assert.ok(observed);
  assert.equal(Object.is(observed.reason, reason), true, `Expected ${String(reason)}, received ${String(observed.reason)}`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
