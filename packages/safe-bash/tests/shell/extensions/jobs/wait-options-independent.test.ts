import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "poe-code/safe-fs";
import { agentCommands } from "../../../../src/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import type { ShellExtension } from "../../../../src/shell/extensions.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { createJobState, type PreparedJob } from "../../../../src/shell/extensions/jobs/state.js";
import { nextJobReference } from "./next53-reference.js";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(accept => { resolve = accept; });
  return { promise, resolve };
}

for (const reason of [undefined, null, false, 0, ""]) {
  test(`independent: failed preparation must not retire an earlier notified job (${String(reason)})`, async context => {
    const jobs = createJobState();
    context.after(() => jobs.close());
    const earlier = await jobs.start(() => ({ run: () => 7 }));
    await jobs.wait([{ handle: earlier }]);
    const before = jobs.snapshot();
    assert.equal(before[0]!.residency, "active-notified");
    let cleaned = 0;
    await assert.rejects(jobs.start(task => {
      task.registerCleanup(() => { cleaned++; });
      throw reason;
    }), failure => Object.is(failure, reason));
    assert.equal(cleaned, 1);
    assert.deepEqual(jobs.snapshot(), before);
    assert.equal(jobs.savedStatus(earlier), undefined);
    assert.deepEqual(await jobs.waitNext([{ handle: earlier }]), {
      outcome: { kind: "status", status: 127 }, unknown: [],
    });
    assert.deepEqual((await jobs.wait([{ handle: earlier }])).outcome, { kind: "status", status: 7 });
  });
}

test("independent: invalid prepared runner is not successful child admission", async context => {
  const jobs = createJobState();
  context.after(() => jobs.close());
  const earlier = await jobs.start(() => ({ run: () => 7 }));
  await jobs.wait([{ handle: earlier }]);
  const before = jobs.snapshot();
  await assert.rejects(jobs.start(() => ({ run: undefined }) as unknown as PreparedJob), TypeError);
  assert.deepEqual(jobs.snapshot(), before);
  assert.equal(jobs.savedStatus(earlier), undefined);
});

test("independent: pending preparation does not retire before successful admission", async () => {
  const jobs = createJobState();
  const release = deferred<PreparedJob>();
  const earlier = await jobs.start(() => ({ run: () => 7 }));
  await jobs.wait([{ handle: earlier }]);
  const starting = jobs.start(() => release.promise);
  const during = jobs.snapshot().find(entry => entry.handle === earlier);
  const savedDuring = jobs.savedStatus(earlier);
  try {
    assert.equal(during!.residency, "active-notified");
    assert.equal(savedDuring, undefined);
  } finally {
    release.resolve({ run: () => 9 });
    await starting;
    await jobs.close();
  }
});

test("independent: successful admission retires notified but not unnotified status", async context => {
  const jobs = createJobState();
  context.after(() => jobs.close());
  const earlier = await jobs.start(() => ({ run: () => 7 }));
  await jobs.wait([{ handle: earlier }]);
  const admitted = await jobs.start(() => ({ run: () => 9 }));
  await admitted.completion;
  assert.equal(jobs.savedStatus(earlier), 7);
  assert.equal(jobs.savedStatus(admitted), undefined);
  assert.equal(jobs.snapshot().find(entry => entry.handle === admitted)!.residency, "active-unnotified");
  assert.equal((await jobs.waitNext()).handle, admitted);
});

test("independent: failure after valid admission does not undo earlier retirement", async () => {
  const jobs = createJobState();
  try {
    const earlier = await jobs.start(() => ({ run: () => 7 }));
    await jobs.wait([{ handle: earlier }]);
    const admitted = await jobs.start(() => ({ run() { throw false; } }));
    assert.deepEqual(await admitted.completion, { kind: "failure", reason: false });
    assert.equal(jobs.savedStatus(earlier), 7);
    assert.equal(jobs.savedStatus(admitted), undefined);
    await assert.rejects(jobs.finish(), reason => reason === false);
  } finally { await jobs.close().catch(reason => { assert.equal(reason, false); }); }
});

test("independent: capacity refusal leaves notification and preparation untouched", async context => {
  const jobs = createJobState({ maxJobs: 1 });
  context.after(() => jobs.close());
  const earlier = await jobs.start(() => ({ run: () => 7 }));
  await jobs.wait([{ handle: earlier }]);
  const before = jobs.snapshot();
  let prepared = false;
  await assert.rejects(jobs.start(() => { prepared = true; return { run: () => 0 }; }), {
    message: "job limit exceeded: maxJobs",
  });
  assert.equal(prepared, false);
  assert.deepEqual(jobs.snapshot(), before);
  await jobs.wait();
  assert.deepEqual(jobs.snapshot(), []);
  const fresh = await jobs.start(() => ({ run: () => 0 }));
  assert.deepEqual(await fresh.completion, { kind: "status", status: 0 });
});

test("independent: concurrent next waiters publish each completion only once", async () => {
  const jobs = createJobState();
  const release = deferred<number>();
  let cleaned = 0;
  try {
    const first = await jobs.start(task => {
      task.registerCleanup(() => { cleaned++; });
      return { run: () => release.promise };
    });
    const second = await jobs.start(task => {
      task.registerCleanup(() => { cleaned++; });
      return { async run() { return (await release.promise) + 2; } };
    });
    const waiting = [jobs.waitNext(), jobs.waitNext(), jobs.waitNext()];
    release.resolve(7);
    const results = await Promise.all(waiting);
    assert.equal(cleaned, 2);
    assert.deepEqual(results.map(result => result.outcome), [
      { kind: "status", status: 7 }, { kind: "status", status: 9 }, { kind: "status", status: 127 },
    ]);
    assert.deepEqual(results.map(result => result.handle), [first, second, undefined]);
    assert.equal(jobs.savedStatus(first), 7);
    assert.equal(jobs.savedStatus(second), 9);
    await jobs.wait();
    assert.deepEqual(jobs.snapshot(), []);
  } finally { release.resolve(7); await jobs.close(); }
});

for (const [id, expectedPreparations] of [[3, 0], [19, 0], [21, 3], [22, 3]] as const) {
  test(`independent: exact native25 program ${id} preserves bytes and preparation count`, async context => {
    const reference = nextJobReference(id);
    const definition = jobsExtension();
    let preparations = 0;
    const extension: ShellExtension = { ...definition, create() {
      const instance = definition.create();
      return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(command) {
        const bindings = command.bindings;
        return builtin.execute.call(builtin, { ...command, bindings: { ...bindings, prepareReference(value) {
          preparations++;
          return bindings.prepareReference(value);
        } } });
      } })) };
    } };
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [extension], env: reference.request.environment }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(reference.source, { stdin: reference.stdin });
    assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
    assert.equal(result.exitCode, reference.status);
    assert.equal(preparations, expectedPreparations);
  });
}

test("independent: saved prepass suppresses earlier raw invalid operands without consuming status", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("{ exit 7; } & child=$!; for item in one; do wait \"$child\"; done; wait -n -p who -- $'\\377' \"$child\"; result=$?; [[ $who == $child ]]; printf '%s:%s:' \"$result\" \"$?\"; wait -n -p who \"$child\"; printf '%s:' \"$?\"; wait -n; printf '%s' \"$?\"");
  assert.equal(result.stdout, "7:0:7:127");
  assert.deepEqual(result.stderrBytes, new Uint8Array());
  assert.equal(result.exitCode, 0);
});

test("admission repair: preparation reserves a handle and budget without publishing its job number", async () => {
  const jobs = createJobState({ maxJobs: 1 });
  const release = deferred<PreparedJob>();
  const starting = jobs.start(() => release.promise);
  const reserved = jobs.snapshot()[0]!;
  try {
    assert.equal(reserved.state, "preparing");
    assert.equal(reserved.listed, false);
    assert.equal(reserved.handle.jobId, 1);
    assert.deepEqual((await jobs.wait([{ jobId: 1 }])).unknown, [{ jobId: 1 }]);
    await assert.rejects(jobs.start(() => ({ run: () => 0 })), { message: "job limit exceeded: maxJobs" });
    release.resolve({ run: () => 7 });
    const admitted = await starting;
    assert.equal(admitted, reserved.handle);
    assert.equal(jobs.snapshot()[0]!.listed, true);
    assert.deepEqual((await jobs.wait([{ jobId: 1 }])).outcome, { kind: "status", status: 7 });
  } finally { release.resolve({ run: () => 7 }); await starting; await jobs.close(); }
});

test("admission repair: reusable job number remains reserved across out-of-order preparation", async () => {
  const jobs = createJobState({ maxJobs: 3 });
  const release = deferred<PreparedJob>();
  const earlier = await jobs.start(() => ({ run: () => 7 }));
  await jobs.wait([{ jobId: earlier.jobId }]);
  const starting = jobs.start(() => release.promise);
  const reserved = jobs.snapshot().find(entry => entry.state === "preparing")!;
  try {
    assert.equal(jobs.savedStatus(earlier), undefined);
    assert.equal(jobs.snapshot().find(entry => entry.handle === earlier)!.listed, true);
    assert.equal(reserved.handle.jobId, earlier.jobId);
    assert.equal(reserved.listed, false);
    const faster = await jobs.start(() => ({ run: () => 11 }));
    assert.equal(faster.jobId, 2);
    assert.equal(jobs.savedStatus(earlier), 7);
    release.resolve({ run: () => 9 });
    const slower = await starting;
    assert.equal(slower, reserved.handle);
    assert.notEqual(slower, earlier);
    assert.deepEqual((await jobs.wait([{ jobId: 1 }])).outcome, { kind: "status", status: 9 });
    assert.deepEqual((await jobs.wait([{ handle: faster }])).outcome, { kind: "status", status: 11 });
    assert.deepEqual((await jobs.wait([{ handle: earlier }])).outcome, { kind: "status", status: 7 });
  } finally { release.resolve({ run: () => 9 }); await starting; await jobs.close(); }
});

for (const reason of [null, false, 0, ""]) {
  test(`admission repair: close during preparation drains acquisition without retirement (${String(reason)})`, async () => {
    const jobs = createJobState();
    const earlier = await jobs.start(() => ({ run: () => 7 }));
    await jobs.wait([{ handle: earlier }]);
    const before = jobs.snapshot();
    const acquire = deferred<void>();
    const acquired = deferred<void>();
    let cleaned = 0;
    let ran = false;
    const starting = jobs.start(async task => {
      task.registerCleanup(async () => { await acquired.promise; cleaned++; });
      await acquire.promise;
      acquired.resolve();
      return { run() { ran = true; return 9; } };
    });
    const rejected = assert.rejects(starting, failure => Object.is(failure, reason));
    const closing = jobs.close(reason);
    let settled = false;
    void closing.then(() => { settled = true; });
    try {
      await Promise.resolve();
      assert.equal(settled, false);
      assert.equal(cleaned, 0);
      acquire.resolve();
      await Promise.all([closing, rejected]);
      assert.equal(ran, false);
      assert.equal(cleaned, 1);
      assert.equal(jobs.close(), closing);
      assert.deepEqual(jobs.snapshot(), before);
      assert.equal(jobs.savedStatus(earlier), undefined);
    } finally { acquire.resolve(); await Promise.all([closing, rejected]); }
  });
}

test("admission repair: owner cancellation wins over falsey preparation failure without retirement", async () => {
  const owner = new AbortController();
  const jobs = createJobState({ signal: owner.signal });
  const earlier = await jobs.start(() => ({ run: () => 7 }));
  await jobs.wait([{ handle: earlier }]);
  const release = deferred<void>();
  let cleaned = 0;
  const starting = jobs.start(async task => {
    task.registerCleanup(() => { cleaned++; });
    await release.promise;
    throw false;
  });
  const rejected = assert.rejects(starting, reason => reason === 0);
  try {
    const closing = jobs.close(null);
    owner.abort(0);
    release.resolve();
    await Promise.all([closing, rejected]);
    assert.equal(cleaned, 1);
    assert.equal(jobs.savedStatus(earlier), undefined);
    assert.equal(jobs.snapshot()[0]!.residency, "active-notified");
  } finally { release.resolve(); await rejected; await jobs.close(); }
});

test("admission repair: cancellation from the runner getter precedes publication", async () => {
  const jobs = createJobState();
  const earlier = await jobs.start(() => ({ run: () => 7 }));
  await jobs.wait([{ handle: earlier }]);
  let cleaned = 0;
  let ran = false;
  try {
    await assert.rejects(jobs.start(task => {
      task.registerCleanup(() => { cleaned++; });
      return { get run() {
        void jobs.close(false);
        return () => { ran = true; return 9; };
      } };
    }), reason => reason === false);
    assert.equal(cleaned, 1);
    assert.equal(ran, false);
    assert.equal(jobs.savedStatus(earlier), undefined);
    assert.equal(jobs.snapshot().length, 1);
  } finally { await jobs.close(); }
});

test("admission repair: natural finish admits an existing reservation before draining it", async () => {
  const jobs = createJobState();
  const earlier = await jobs.start(() => ({ run: () => 7 }));
  await jobs.wait([{ handle: earlier }]);
  const release = deferred<PreparedJob>();
  let cleaned = 0;
  const starting = jobs.start(task => {
    task.registerCleanup(() => { cleaned++; });
    return release.promise;
  });
  const finishing = jobs.finish();
  try {
    release.resolve({ run: () => 9 });
    const admitted = await starting;
    await finishing;
    assert.equal(jobs.savedStatus(earlier), 7);
    assert.deepEqual(await admitted.completion, { kind: "status", status: 9 });
    assert.equal(cleaned, 1);
    assert.equal(jobs.close(), finishing);
    await assert.rejects(jobs.start(() => ({ run: () => 0 })), { message: "job state is closed to admission" });
  } finally { release.resolve({ run: () => 9 }); await starting; await jobs.close(); }
});

test("admission repair: rejected preparation retains its quota until cleanup settles", async () => {
  const jobs = createJobState({ maxJobs: 2 });
  const earlier = await jobs.start(() => ({ run: () => 7 }));
  await jobs.wait([{ handle: earlier }]);
  const cleanup = deferred<void>();
  const cleaning = deferred<void>();
  let cleaned = 0;
  const starting = jobs.start(task => {
    task.registerCleanup(async () => { cleaning.resolve(); await cleanup.promise; cleaned++; });
    throw undefined;
  });
  const rejected = assert.rejects(starting, reason => reason === undefined);
  try {
    await cleaning.promise;
    assert.equal(jobs.savedStatus(earlier), undefined);
    await assert.rejects(jobs.start(() => ({ run: () => 0 })), { message: "job limit exceeded: maxJobs" });
    cleanup.resolve();
    await rejected;
    assert.equal(cleaned, 1);
    const admitted = await jobs.start(() => ({ run: () => 9 }));
    assert.equal(jobs.savedStatus(earlier), 7);
    assert.deepEqual(await admitted.completion, { kind: "status", status: 9 });
  } finally { cleanup.resolve(); await rejected; await jobs.close(); }
});
