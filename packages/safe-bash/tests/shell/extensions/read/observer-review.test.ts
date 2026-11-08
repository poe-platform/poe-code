import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { basicCommands } from "../../../../src/commands/basic.js";
import { streamCommands } from "../../../../src/commands/streams.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { readExtension } from "../../../../src/shell/extensions/read/index.js";
import { ShellInput } from "../../../../src/shell/input.js";
import { Budget, defaultLimits } from "../../../../src/shell/runtime.js";
import { Shell } from "../../../../src/shell/shell.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function setup(hooks: { beforeProbe?: () => Promise<void>; beforeWait?: () => Promise<void> } = {}) {
  const fs = createMemoryFileSystem();
  const trace = { borrows: 0, observations: 0, probes: 0, waits: 0, releases: 0, indexedWrites: 0, assignments: [] as string[], deadlines: [] as number[] };
  const definition = readExtension();
  const failures: unknown[] = [];
  const shell = new Shell({ fs, onInternalError: reason => { failures.push(reason); }, limits: { maxWallClockMs: 2000 }, extensions: [arraysExtension(), { ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(invocation) {
      return builtin.execute({ ...invocation,
        bindings: { ...invocation.bindings,
          async assign(name, value) { trace.assignments.push(name); await invocation.bindings.assign(name, value); },
          async openIndexed(name, options) { trace.indexedWrites++; return invocation.bindings.openIndexed(name, options); },
        },
        input: {
          validateOpen: invocation.input.validateOpen.bind(invocation.input),
          borrow(descriptor) { trace.borrows++; return invocation.input.borrow(descriptor); },
          observe(descriptor) {
            trace.observations++;
            const observer = invocation.input.observe(descriptor);
            return { readable: observer.readable,
              async probeRead() { trace.probes++; await hooks.beforeProbe?.(); return observer.probeRead(); },
              async waitRead(options) {
                trace.waits++;
                trace.deadlines.push(options.timeoutMs);
                assert.equal(options.signal, invocation.signal);
                await hooks.beforeWait?.();
                return observer.waitRead(options);
              },
              async release() { trace.releases++; await observer.release(); },
            };
          },
        },
      });
    } })) };
  } }] });
  for (const command of basicCommands()) shell.register(command);
  const cat = streamCommands().find(command => command.name === "cat");
  assert.ok(cat);
  shell.register(cat);
  return { shell, fs, trace, failures };
}

test("read observer review: zero timeout preserves raw variables and the entire unread stdin without borrowing", async context => {
  const subject = setup();
  context.after(() => subject.shell.dispose());
  const bytes = Uint8Array.of(255, 0, 128, 10, 254);
  const result = await subject.shell.exec("value=$'\\xff\\n'; values=($'\\xfe' 'two words'); read -t0 -u0 -e bad-name; printf '%s|%s|%s|%s|' \"$?\" \"$value\" \"${values[0]}\" \"${values[1]}\"; cat", { stdin: bytes });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.concat([Buffer.from("0|"), Buffer.from([255, 10, 124, 254]), Buffer.from("|two words|"), Buffer.from(bytes)]));
  assert.deepEqual(subject.trace, { borrows: 0, observations: 1, probes: 1, waits: 0, releases: 1, indexedWrites: 0, assignments: [], deadlines: [] });
});

for (const provenance of ["stream", "unknown"] as const) test(`read observer review: zero timeout ${provenance} input never starts a pull or validates assignment targets`, async context => {
  const subject = setup();
  const budget = new Budget({ ...defaultLimits, maxWallClockMs: 2000 });
  let pulls = 0;
  const input = new ShellInput({ [Symbol.asyncIterator]() { return {
    async next() { pulls++; return { done: false, value: Uint8Array.of(255, 0, 10) }; },
    async return() { return { done: true, value: undefined }; },
  }; } }, budget, budget.signal, provenance === "stream" ? { provenance, poll: () => "blocked" } : { provenance });
  context.after(async () => {
    try { await subject.shell.dispose(); await input.close(); }
    finally { budget.close(); budget.values.close(); }
  });
  const result = await subject.shell.exec("value=OLD; values=(old keep); readonly value; read -t0 -N0 -a bad-name; printf '%s:<%s>:<%s>' \"$?\" \"$value\" \"${values[*]}\"", { stdin: input });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "1:<OLD>:<old keep>");
  assert.equal(result.stderr, provenance === "unknown" ? "shell: line 1: read: input readiness is unknown for this cursor\n" : "");
  assert.equal(pulls, 0);
  assert.deepEqual(subject.trace, { borrows: 0, observations: 1, probes: 1, waits: 0, releases: 1, indexedWrites: 0, assignments: [], deadlines: [] });
  const next = await input.next();
  assert.deepEqual(next.value, Uint8Array.of(255, 0, 10));
  assert.equal(pulls, 1);
});

test("read observer review: positive timeout on a regular write-only descriptor ignores waiting and preserves raw values", async context => {
  const subject = setup();
  context.after(() => subject.shell.dispose());
  await subject.fs.writeFile("/out", Uint8Array.of(255, 0, 10));
  const result = await subject.shell.exec("value=$'\\xff'; values=($'\\xfe' keep); read -t.003 -u3 value 3>>/out; printf '%s|%s|%s|' \"$?\" \"$value\" \"${values[0]}\"");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from([49, 124, 255, 124, 254, 124]));
  assert.equal(result.stderr, "shell: line 1: read: 3: read error: Bad file descriptor\n");
  assert.deepEqual(await subject.fs.readFile("/out"), Uint8Array.of(255, 0, 10));
  assert.deepEqual(subject.trace, { borrows: 1, observations: 1, probes: 1, waits: 0, releases: 1, indexedWrites: 0, assignments: [], deadlines: [] });
});

test("read observer review: opaque write-only timeout refuses unsupported observation without clearing values", async context => {
  const subject = setup();
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("value=OLD; values=(old keep); read -t.003 -u1 -a values; printf '%s:<%s>:<%s>' \"$?\" \"$value\" \"${values[*]}\"");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "1:<OLD>:<old keep>");
  assert.equal(result.stderr, "shell: line 1: read: descriptor timeout observation unavailable through this extension API\n");
  assert.deepEqual(subject.trace, { borrows: 1, observations: 1, probes: 1, waits: 0, releases: 1, indexedWrites: 0, assignments: [], deadlines: [] });
});

for (const target of ["scalars", "array"] as const) test(`read observer review: real pipe write-end timeout applies only ${target} timeout assignment`, async context => {
  const subject = setup();
  context.after(() => subject.shell.dispose());
  const script = target === "scalars"
    ? "{ left=OLD; right=KEEP; read -t.003 -u1 left right; printf '%s:<%s>:<%s>' \"$?\" \"$left\" \"$right\" >&2; } | cat"
    : "{ values=(old keep); TMOUT=.003; read -u1 -a values; printf '%s:<%s>' \"$?\" \"${values[*]}\" >&2; } | cat";
  const result = await subject.shell.exec(script);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, target === "scalars" ? "142:<>:<>" : "142:<>");
  assert.deepEqual(subject.trace, { borrows: 1, observations: 1, probes: 1, waits: 1, releases: 1, indexedWrites: target === "array" ? 1 : 0, assignments: target === "scalars" ? ["left", "right"] : [], deadlines: [3] });
});

test("read observer review: real peer retirement permits the read attempt but preserves variables on write-only EBADF", async context => {
  const subject = setup();
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("{ value=OLD; read -t1 -u1 value; printf '%s:<%s>' \"$?\" \"$value\" >&2; } | true");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "shell: line 1: read: 1: read error: Bad file descriptor\n1:<OLD>");
  assert.equal(subject.trace.assignments.length, 0);
  assert.equal(subject.trace.indexedWrites, 0);
  assert.equal(subject.trace.observations, 1);
  assert.equal(subject.trace.releases, 1);
});

for (const phase of ["probe", "wait"] as const) for (const reason of [false, 0, "", null]) test(`read observer review: ${phase} cancellation preserves ${String(reason)} without assignment or early settlement`, async context => {
  const entered = deferred();
  const gate = deferred();
  const root = new AbortController();
  const pause = async () => { entered.resolve(); await gate.promise; };
  const subject = setup(phase === "probe" ? { beforeProbe: pause } : { beforeWait: pause });
  context.after(() => subject.shell.dispose());
  let settled = false;
  const execution = subject.shell.exec("{ value=OLD; read -t1 -u1 value; } | cat", { signal: root.signal });
  void execution.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(execution, error => Object.is(error, reason));
  await Promise.race([entered.promise, execution.then(() => { throw new Error("Read did not reach the controlled observation phase"); })]);
  root.abort(reason);
  await nextTurn();
  const earlySettlement = settled;
  gate.resolve();
  await rejected;
  assert.equal(earlySettlement, false);
  assert.equal(subject.trace.assignments.length, 0);
  assert.equal(subject.trace.indexedWrites, 0);
  assert.equal(subject.trace.borrows, 1);
  assert.equal(subject.trace.probes, 1);
  assert.equal(subject.trace.waits, phase === "wait" ? 1 : 0);
  assert.equal(subject.trace.releases, 1);
});

test("read observer review: genuine undefined metadata failure is not converted into timeout assignment", async context => {
  const subject = setup({ beforeProbe: async () => { throw undefined; } });
  context.after(() => subject.shell.dispose());
  const result = await subject.shell.exec("value=OLD; read -t.003 -u3 value 3>/out; printf '%s:<%s>' \"$?\" \"$value\"");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "1:<OLD>");
  assert.equal(result.stderr, "shell: line 1: internal error\n");
  assert.deepEqual(subject.failures, [undefined]);
  assert.equal(subject.trace.assignments.length, 0);
  assert.equal(subject.trace.indexedWrites, 0);
  assert.equal(subject.trace.waits, 0);
  assert.equal(subject.trace.releases, 1);
});
