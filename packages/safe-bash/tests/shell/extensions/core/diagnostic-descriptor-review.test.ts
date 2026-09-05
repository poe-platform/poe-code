import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../../src/contracts/errors.js";
import { shellValueBytes, shellValueFromBytes } from "../../../../src/contracts/value.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError, type ShellLimits } from "../../../../src/shell/types.js";

function setup(execute: (context: ShellExtensionContext) => Promise<number>, limits: ShellLimits = {}) {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, limits, extensions: [{ name: "diagnostic-descriptor-review", create: () => ({ builtins: [{ name: "probe", execute }] }) }] });
  return { fs, shell };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function observed(action: () => unknown): { threw: boolean; reason: unknown } {
  try { action(); return { threw: false, reason: undefined }; }
  catch (reason) { return { threw: true, reason }; }
}

const reasons = [false, null, 0, -0, "", NaN, new Error("exact root reason")];

for (const reason of reasons) test(`retained input capability checks root cancellation after capture: ${String(reason)} negative-zero=${Object.is(reason, -0)}`, async context => {
  const controller = new AbortController();
  const outcomes: ReturnType<typeof observed>[] = [];
  let pulls = 0;
  const subject = setup(async invocation => {
    const input = invocation.input;
    const validate = input.validateOpen;
    const borrow = input.borrow;
    controller.abort(reason);
    outcomes.push(observed(() => validate(0)), observed(() => borrow(0)), observed(() => validate(NaN)), observed(() => borrow(-1)));
    return 0;
  });
  context.after(() => subject.shell.dispose());
  await assert.rejects(subject.shell.exec("probe", {
    signal: controller.signal,
    stdin: { async *[Symbol.asyncIterator]() { pulls++; yield Uint8Array.of(255); } },
  }), error => Object.is(error, reason));
  assert.equal(outcomes.length, 4);
  for (const result of outcomes) {
    assert.equal(result.threw, true);
    assert.equal(Object.is(result.reason, reason), true);
  }
  assert.equal(pulls, 0);
});

test("retained validation and borrow expire even when the input getter was evaluated during invocation", async context => {
  let input: ShellExtensionContext["input"] | undefined;
  const subject = setup(async invocation => { input = invocation.input; input.validateOpen(0); return 0; });
  context.after(() => subject.shell.dispose());
  assert.equal((await subject.shell.exec("probe")).exitCode, 0);
  const retained = input;
  assert.ok(retained);
  assert.throws(() => retained.validateOpen(0));
  assert.throws(() => retained.borrow(0));
});

for (const cap of [0, 1]) for (const argument of ["plain", "$'\\xff'"]) test(`diagnostic output cap ${cap} preserves earlier admitted writes for ${argument}`, async context => {
  const output: Uint8Array[] = [], diagnostic: Uint8Array[] = [];
  const subject = setup(async invocation => {
    if (cap === 1) await invocation.stdout.write(Uint8Array.of(65));
    await invocation.diagnostic(invocation.argumentValues[0]!);
    return 0;
  }, { maxOutputBytes: cap });
  context.after(() => subject.shell.dispose());
  await assert.rejects(subject.shell.exec(`probe ${argument}`, {
    stdout: { async write(bytes) { output.push(bytes.slice()); } },
    stderr: { async write(bytes) { diagnostic.push(bytes.slice()); } },
  }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  assert.deepEqual(Buffer.concat(output), cap ? Buffer.from("A") : Buffer.alloc(0));
  assert.deepEqual(diagnostic, []);
});

for (const reason of [undefined, ...reasons]) test(`diagnostic retains exact non-atomic sink failure ${String(reason)} negative-zero=${Object.is(reason, -0)}`, async context => {
  let outcome: { threw: boolean; reason: unknown } | undefined;
  const written: Uint8Array[] = [];
  const subject = setup(async invocation => {
    try { await invocation.diagnostic(shellValueFromBytes(Uint8Array.of(255, 0, 128))); outcome = { threw: false, reason: undefined }; }
    catch (error) { outcome = { threw: true, reason: error }; }
    return 0;
  });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("probe", { stderr: { async write(bytes) {
    written.push(bytes.slice(0, 1));
    throw reason;
  } } });
  assert.equal(result.exitCode, 0);
  assert.ok(outcome);
  assert.equal(outcome.threw, true);
  assert.equal(Object.is(outcome.reason, reason), true);
  assert.deepEqual(Buffer.concat(written), Buffer.from("s"));
});

test("diagnostic awaits the admitted sink and retains the raw payload until completion", async context => {
  const entered = deferred(), release = deferred();
  let completed = false;
  let borrowed: Uint8Array | undefined;
  const subject = setup(async invocation => { await invocation.diagnostic(shellValueFromBytes(Uint8Array.of(255, 0, 128))); completed = true; return 0; });
  context.after(async () => { release.resolve(); await subject.shell.dispose(); });
  const running = subject.shell.exec("probe", { stderr: { async write(bytes) {
    borrowed = bytes;
    entered.resolve();
    await release.promise;
    assert.deepEqual(Buffer.from(bytes), Buffer.concat([Buffer.from("shell: line 1: "), Buffer.from([255, 0, 128, 10])]));
  } } });
  await entered.promise;
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(completed, false);
    assert.ok(borrowed);
    assert.deepEqual(Buffer.from(borrowed), Buffer.concat([Buffer.from("shell: line 1: "), Buffer.from([255, 0, 128, 10])]));
  } finally { release.resolve(); assert.equal((await running).exitCode, 0); }
  assert.equal(completed, true);
});

for (const reason of [false, null, 0, ""]) test(`pending diagnostic preserves exact root cancellation ${JSON.stringify(reason)} over sink failure`, async context => {
  const controller = new AbortController(), entered = deferred(), release = deferred();
  const outcomes: { threw: boolean; reason: unknown }[] = [];
  const subject = setup(async invocation => {
    try { await invocation.diagnostic(shellValueFromBytes(Uint8Array.of(255, 0, 128))); outcomes.push({ threw: false, reason: undefined }); }
    catch (error) { outcomes.push({ threw: true, reason: error }); }
    return 0;
  });
  context.after(async () => { release.resolve(); await subject.shell.dispose(); });
  const running = subject.shell.exec("probe", { signal: controller.signal, stderr: { async write() {
    entered.resolve();
    await release.promise;
    throw new Error("sink failed after root cancellation");
  } } });
  const rejected = assert.rejects(running, error => Object.is(error, reason));
  await entered.promise;
  controller.abort(reason);
  release.resolve();
  await rejected;
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.threw, true);
  assert.equal(Object.is(outcomes[0]!.reason, reason), true);
});

for (const capDelta of [0, -1]) test(`Unicode diagnostic prefix and raw payload share exact byte budget delta=${capDelta}`, async context => {
  const expected = Buffer.concat([Buffer.from("路径-é: line 2: "), Buffer.from([255, 0, 128, 10])]);
  const writes: Uint8Array[] = [];
  const subject = setup(async invocation => {
    await invocation.diagnostic(shellValueFromBytes(Uint8Array.of(255, 0, 128)));
    return 1;
  }, { maxOutputBytes: expected.length + capDelta });
  context.after(() => subject.shell.dispose());
  const execution = subject.shell.exec("sh -c $':\\nprobe' '路径-é'", { stderr: { async write(bytes) { writes.push(bytes.slice()); } } });
  if (capDelta === 0) {
    assert.equal((await execution).exitCode, 1);
    assert.deepEqual(Buffer.concat(writes), expected);
  } else {
    await assert.rejects(execution, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.deepEqual(writes, []);
  }
});

const topologies = [
  { name: "moved output", redirects: "3>/output 4>&3-", open: [0, 1, 2, 4], closed: [3], readable: undefined, writeOnly: [4] },
  { name: "moved input", redirects: "3</input 4<&3-", open: [0, 1, 2, 4], closed: [3], readable: 4, writeOnly: [] },
  { name: "closed source keeps output aliases", redirects: "3>/output 4>&3 3>&- 5>&4", open: [0, 1, 2, 4, 5], closed: [3], readable: undefined, writeOnly: [4, 5] },
  { name: "closed source keeps input alias", redirects: "3</input 4<&3 3<&-", open: [0, 1, 2, 4], closed: [3], readable: 4, writeOnly: [] },
  { name: "rebound source does not rebind input alias", redirects: "3</input 4<&3 3>/output", open: [0, 1, 2, 3, 4], closed: [9], readable: 4, writeOnly: [3] },
  { name: "standard descriptor closure retains output alias", redirects: "3>&1 1>&- 0<&-", open: [2, 3], closed: [0, 1], readable: undefined, writeOnly: [2, 3] },
];

for (const topology of topologies) test(`descriptor topology: ${topology.name}`, async context => {
  const subject = setup(async invocation => {
    const input = invocation.input;
    for (const descriptor of topology.open) assert.equal(input.validateOpen(descriptor), undefined);
    for (const descriptor of topology.closed) assert.throws(() => input.validateOpen(descriptor), error => error instanceof FsError && error.code === "EBADF");
    for (const descriptor of topology.writeOnly) assert.throws(() => input.borrow(descriptor), error => error instanceof FsError && error.code === "EBADF");
    if (topology.readable !== undefined) {
      const borrow = input.borrow(topology.readable);
      try {
        const record = await borrow.record();
        try { assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 10)); }
        finally { await record.release(); }
      } finally { await borrow.release(); }
    }
    return 0;
  });
  context.after(() => subject.shell.dispose());
  await subject.fs.writeFile("/input", Uint8Array.of(255, 0, 10));
  const result = await subject.shell.exec(`probe ${topology.redirects}`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
});

test("validation between alias consumers preserves the shared cursor and performs no filesystem acquisition", async context => {
  const subject = setup(async invocation => {
    const input = invocation.input;
    const first = input.borrow(3);
    try {
      const record = await first.record();
      try { assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(255, 0, 10)); }
      finally { await record.release(); }
    } finally { await first.release(); }
    const before = [opens.mock.callCount(), stats.mock.callCount(), lstats.mock.callCount()];
    for (let attempt = 0; attempt < 3; attempt++) {
      input.validateOpen(3);
      input.validateOpen(4);
    }
    assert.deepEqual([opens.mock.callCount(), stats.mock.callCount(), lstats.mock.callCount()], before);
    const second = input.borrow(4);
    try {
      const record = await second.record();
      try { assert.deepEqual(shellValueBytes(record.shellValue), Uint8Array.of(254, 0, 10)); }
      finally { await record.release(); }
    } finally { await second.release(); }
    return 0;
  });
  context.after(() => subject.shell.dispose());
  await subject.fs.writeFile("/input", Uint8Array.of(255, 0, 10, 254, 0, 10));
  const opens = context.mock.method(subject.fs, "open");
  const stats = context.mock.method(subject.fs, "stat");
  const lstats = context.mock.method(subject.fs, "lstat");
  const result = await subject.shell.exec("probe 3</input 4<&3");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(opens.mock.callCount(), 1);
});
