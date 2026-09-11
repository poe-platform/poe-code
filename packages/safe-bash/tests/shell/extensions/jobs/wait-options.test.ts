import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem, type FileDescriptor, type FileSystem } from "poe-code/safe-fs";
import { agentCommands } from "../../../../src/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { createJobState } from "../../../../src/shell/extensions/jobs/state.js";
import type { ShellExtension } from "../../../../src/shell/extensions.js";
import type { ShellExtensionContext } from "../../../../src/shell/extensions.js";
import { nextJobReference } from "./next53-reference.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const indexedSeed: ShellExtension = { name: "wait-indexed-seed-fixture", create: () => ({ builtins: [{ name: "seed_values", async execute(context) {
  const transaction = await context.bindings.prepare("values", { kind: "indexed", clear: true });
  try { await transaction.set(0, "left"); await transaction.set(1, "right"); await transaction.commit(); }
  finally { await transaction.close(); }
  return 0;
} }, { name: "inspect_values", async execute(context) {
  const left = context.bindings.get("values", 0);
  const right = context.bindings.get("values", 1);
  await context.bindings.assign("left_value", left ?? "");
  await context.bindings.assign("right_value", right ?? "");
  await context.bindings.assign("right_set", right === undefined ? "" : "x");
  return 0;
} }] }) };

function indexedSource(source: string): string {
  const parts = source.split("values=(left right)");
  assert.equal(parts.length, 2);
  let adapted = parts.join("seed_values");
  if (adapted.includes("[[ ${values[1]-}")) adapted = adapted.replace("[[ ${values[1]-}", "inspect_values; [[ \"$right_value\"");
  else adapted = adapted.replace("result=$?; printf", "result=$?; inspect_values; printf");
  return adapted.replace("${values[0]}", "$left_value").replace("${values[1]+x}", "$right_set").replace("${values[1]-}", "$right_value");
}

for (const id of [1, 2, 3, 4, 5, 6, 19, 20, 21, 22, 23, 24, "L1", "L2"] as const) {
  const reference = nextJobReference(id);
  test(`qualified wait observation ${id === 23 ? "canonical indexed seed and observer adaptation" : "exact source replay"} ${id}`, async context => {
    assert.equal(reference.request.gates.length, 0);
    assert.notEqual(reference.qualification.kind, "exploratory");
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension(), arraysExtension(), ...(id === 23 ? [indexedSeed] : [])], env: reference.request.environment }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(id === 23 ? indexedSource(reference.source) : reference.source, { stdin: reference.stdin });
    assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout, result.stderr);
    assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
    assert.equal(result.exitCode, reference.status);
  });
}

for (const id of [7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, "R8"] as const) {
  const reference = nextJobReference(id);
  test(`qualified wait observation with owned VFS descriptor adaptation ${id}`, { timeout: 2500 }, async context => {
    const memory = createMemoryFileSystem();
    await memory.writeFile("/gate3", Buffer.from("release\n"));
    await memory.writeFile("/gate4", Buffer.from("release\n"));
    await memory.writeFile("/control", new Uint8Array());
    const gates = new Map([[3, deferred()], [4, deferred()]]);
    const released = new Set<number>();
    const opened: { closes: number }[] = [];
    let control = "";
    let diagnostic = Buffer.alloc(0);
    const release = () => {
      for (const gate of reference.request.gates) {
        const ready = gate.after === "CALIBRATION25_STDERR" ? diagnostic.equals(nextJobReference(25).stderr) : control.includes(`${gate.after}\n`);
        if (ready && !released.has(gate.fd)) { released.add(gate.fd); gates.get(gate.fd)!.resolve(); }
      }
    };
    const fs: FileSystem = new Proxy(memory, { get(target, property, receiver) {
      if (property === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
        const [path] = args;
        const descriptor = await target.open!(...args);
        const resource = { closes: 0 };
        opened.push(resource);
        return new Proxy(descriptor, { get(retained, member) {
          if (member === "close") return async () => { resource.closes++; await retained.close(); };
          if (member === "read" && (path === "/gate3" || path === "/gate4")) return async (...operation: Parameters<FileDescriptor["read"]>) => {
            await gates.get(path === "/gate3" ? 3 : 4)!.promise;
            operation[2]?.signal?.throwIfAborted();
            return retained.read(...operation);
          };
          if (member === "write" && path === "/control") return async (...operation: Parameters<FileDescriptor["write"]>) => {
            const count = await retained.write(...operation);
            control += Buffer.from(operation[0].subarray(0, count)).toString();
            release();
            return count;
          };
          const value: unknown = Reflect.get(retained, member, retained);
          return typeof value === "function" ? value.bind(retained) : value;
        } });
      };
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error("wait VFS handshake safety deadline"));
      for (const gate of gates.values()) gate.resolve();
    }, 1500);
    const shell = new Shell({ fs, extensions: [jobsExtension(), arraysExtension(), ...(id === 17 ? [indexedSeed] : [])], env: reference.request.environment }).use(agentCommands());
    const running = shell.exec(`{ ${id === 17 ? indexedSource(reference.source) : reference.source}; } 3</gate3 4</gate4 7>/control`, {
      stdin: reference.stdin, signal: controller.signal,
      stderr: { async write(bytes) { diagnostic = Buffer.concat([diagnostic, bytes]); release(); } },
    });
    void running.catch(() => undefined);
    context.after(async () => {
      clearTimeout(timer);
      for (const gate of gates.values()) gate.resolve();
      await running.catch(() => undefined);
      await shell.dispose();
    });
    const result = await running;
    let expectedStderr = reference.stderr;
    if (id === 14) {
      const captured = reference.sourceControl.toString().split("\n").find(line => line.startsWith("PID:"))?.slice(4);
      const actual = control.split("\n").find(line => line.startsWith("PID:"))?.slice(4);
      assert.ok(captured && actual && Number.isSafeInteger(Number(actual)));
      const pieces = expectedStderr.toString().split(captured);
      assert.equal(pieces.length, 3);
      expectedStderr = Buffer.from(pieces.join(actual));
    }
    assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout, result.stderr);
    assert.deepEqual(Buffer.from(result.stderrBytes), expectedStderr);
    assert.equal(result.exitCode, reference.status);
    assert.deepEqual([...released], reference.request.gates.map(gate => gate.fd));
    assert.ok(opened.length >= 3);
    assert.ok(opened.every(resource => resource.closes === 1));
  });
}

test("exploratory12 is never a replay expectation and25 remains only calibration", () => {
  assert.equal(nextJobReference(12).qualification.kind, "exploratory");
  assert.equal(nextJobReference(12).qualification.deterministicGolden, false);
  assert.equal(nextJobReference(25).qualification.kind, "calibration");
  assert.deepEqual(nextJobReference(25).stderr, nextJobReference("R8").stderr);
});

test("canonical retirement distinguishes active-notified, saved and forgotten", async context => {
  const jobs = createJobState();
  context.after(() => jobs.close());
  const child = await jobs.start(() => ({ run: () => 7 }));
  await jobs.wait([{ handle: child }]);
  assert.equal(jobs.savedStatus(child), undefined);
  assert.equal(jobs.snapshot()[0]!.residency, "active-notified");
  const first = await jobs.waitNext([{ handle: child }]);
  assert.deepEqual(first.outcome, { kind: "status", status: 127 });
  assert.deepEqual(first.unknown, []);
  jobs.retireNotified();
  assert.equal(jobs.savedStatus(child), 7);
  assert.equal(jobs.snapshot()[0]!.residency, "saved");
  assert.equal(jobs.savedStatus(child), 7);
  assert.deepEqual((await jobs.waitNext()).outcome, { kind: "status", status: 127 });
  await jobs.wait();
  assert.equal(jobs.savedStatus(child), undefined);
  assert.deepEqual(jobs.snapshot(), []);
});

test("ordinary wait retires previously-notified status before marking its own target", async context => {
  const jobs = createJobState();
  context.after(() => jobs.close());
  const first = await jobs.start(() => ({ run: () => 7 }));
  const second = await jobs.start(() => ({ run: () => 9 }));
  await jobs.wait([{ handle: second }]);
  await jobs.wait([{ handle: first }]);
  assert.equal(jobs.savedStatus(second), 9);
  assert.equal(jobs.savedStatus(first), undefined);
  assert.equal(jobs.snapshot().find(entry => entry.handle === first)!.residency, "active-notified");
});

test("retirement does not archive unnotified completions or admit them as saved", async context => {
  const jobs = createJobState();
  context.after(() => jobs.close());
  const child = await jobs.start(() => ({ run: () => 7 }));
  await child.completion;
  jobs.retireNotified();
  assert.equal(jobs.savedStatus(child), undefined);
  assert.equal(jobs.snapshot()[0]!.residency, "active-unnotified");
  const winner = await jobs.waitNext();
  assert.equal(winner.handle, child);
  assert.equal(jobs.savedStatus(child), 7);
});

for (const reason of [undefined, null, false, 0, ""]) test(`failed child is never archived as a numeric status: ${String(reason)}`, async () => {
  const jobs = createJobState();
  const child = await jobs.start(() => ({ run() { throw reason; } }));
  const result = await jobs.wait([{ handle: child }]);
  assert.deepEqual(result.outcome, { kind: "failure", reason });
  jobs.retireNotified();
  assert.equal(jobs.savedStatus(child), undefined);
  await assert.rejects(jobs.finish(), failure => Object.is(failure, reason));
});

test("source-backed saved-status prepass precedes later invalid operand diagnostics", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("{ exit 7; } & child=$!; for item in one; do wait \"$child\"; done; wait -n -p who \"$child\" bad; result=$?; [[ $who == $child ]]; printf '%s:%s' \"$result\" \"$?\"");
  assert.equal(result.stdout, "7:0");
  assert.equal(result.stderr, "");
});

test("no arbitrary command or next-wait counter retires active-notified status", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("{ exit 7; } & child=$!; wait \"$child\"; :; for item in; do :; done; wait -n \"$child\"; printf '%s:' \"$?\"; :; wait -n \"$child\"; printf '%s' \"$?\"");
  assert.equal(result.stdout, "127:127");
  assert.equal(result.stderr, "");
});

test("zero saved status remains a hit and repeated explicit lookups retain it", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] }).use(agentCommands());
  context.after(() => shell.dispose());
  const result = await shell.exec("{ exit 0; } & child=$!; for item in one; do wait \"$child\"; done; wait -n -p who \"$child\"; printf '%s:' \"$?\"; wait -n -p who \"$child\"; printf '%s:' \"$?\"; wait -n; printf '%s' \"$?\"");
  assert.equal(result.stdout, "0:0:127");
  assert.equal(result.stderr, "");
});

test("next waiter cancellation does not cancel the child or save a phantom result", async () => {
  const release = deferred();
  const controller = new AbortController();
  const jobs = createJobState();
  let childSignal: AbortSignal | undefined;
  const child = await jobs.start(task => { childSignal = task.signal; return { async run() { await release.promise; return 7; } }; });
  try {
    const waiting = jobs.waitNext([{ handle: child }], { signal: controller.signal });
    controller.abort(false);
    await assert.rejects(waiting, reason => reason === false);
    assert.equal(childSignal!.aborted, false);
    assert.equal(jobs.savedStatus(child), undefined);
    release.resolve();
    const result = await jobs.waitNext([{ handle: child }]);
    assert.deepEqual(result.outcome, { kind: "status", status: 7 });
    assert.equal(jobs.savedStatus(child), 7);
  } finally { release.resolve(); await jobs.close(); }
});

test("next completion and saved publication wait for owned task cleanup", async () => {
  const cleaning = deferred();
  const release = deferred();
  const jobs = createJobState();
  const child = await jobs.start(task => {
    task.registerCleanup(async () => { cleaning.resolve(); await release.promise; });
    return { run: () => 7 };
  });
  const waiting = jobs.waitNext([{ handle: child }]);
  try {
    await cleaning.promise;
    let settled = false;
    void waiting.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    assert.equal(jobs.savedStatus(child), undefined);
    release.resolve();
    assert.deepEqual((await waiting).outcome, { kind: "status", status: 7 });
    assert.equal(jobs.savedStatus(child), 7);
  } finally { release.resolve(); await waiting; await jobs.close(); }
});

test("retained saved statuses remain within the shared job-record admission limit", async () => {
  const jobs = createJobState({ maxJobs: 2 });
  try {
    const first = await jobs.start(() => ({ run: () => 7 }));
    await jobs.wait([{ handle: first }]);
    jobs.retireNotified();
    const second = await jobs.start(() => ({ run: () => 9 }));
    await jobs.wait([{ handle: second }]);
    jobs.retireNotified();
    await assert.rejects(jobs.start(() => ({ run: () => 0 })), /maxJobs/u);
    assert.equal(jobs.snapshot().length, 2);
    await jobs.wait();
    const fresh = await jobs.start(() => ({ run: () => 0 }));
    assert.deepEqual(await fresh.completion, { kind: "status", status: 0 });
  } finally { await jobs.close(); }
});

test("invalid-target diagnostics honor backpressure after destination unset", { timeout: 2500 }, async context => {
  const writing = deferred();
  const release = deferred();
  let active: ShellExtensionContext | undefined;
  const definition = jobsExtension();
  const extension: ShellExtension = { ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(command) { active = command; return builtin.execute.call(builtin, command); } })) };
  } };
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [extension] }).use(agentCommands());
  const running = shell.exec("who=old; wait -n -p who 0; printf after", { stderr: { async write() {
    assert.ok(active);
    assert.equal(active.bindings.get("who"), undefined);
    writing.resolve();
    await release.promise;
  } } });
  context.after(async () => { release.resolve(); await running.catch(() => undefined); await shell.dispose(); });
  await Promise.race([writing.promise, running.then(() => { throw new Error("diagnostic was not written"); })]);
  let settled = false;
  void running.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  release.resolve();
  assert.equal((await running).stdout, "after");
});

for (const reason of [null, false, 0, ""]) test(`root cancellation after -p unset drains child and retains ${String(reason)}`, { timeout: 2500 }, async context => {
  const unbound = deferred();
  const release = deferred();
  const controller = new AbortController();
  let closed = 0;
  const definition = jobsExtension();
  const extension: ShellExtension = { ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(command) {
      const bindings = command.bindings;
      return builtin.execute.call(builtin, { ...command, bindings: { ...bindings, async prepareReference(value) {
        const result = await bindings.prepareReference(value);
        if (!result.ok) return result;
        return { ok: true, value: { ...result.value, async unbindName() {
          const removed = await result.value.unbindName();
          assert.equal(bindings.get("who"), undefined);
          unbound.resolve();
          return removed;
        } } };
      } } });
    } })) };
  } };
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [extension] }).use(agentCommands());
  shell.register({ name: "blocked", async execute(command) {
    command.registerCleanup!(() => { closed++; release.resolve(); });
    await release.promise;
    command.signal.throwIfAborted();
    return { exitCode: 7 };
  } });
  const running = shell.exec("who=old; blocked & child=$!; wait -n -p who \"$child\"; printf wrong", { signal: controller.signal })
    .then(() => ({ threw: false, reason: undefined }), error => ({ threw: true, reason: error as unknown }));
  context.after(async () => { release.resolve(); await running; await shell.dispose(); });
  await Promise.race([unbound.promise, running.then(() => { throw new Error("destination unset was not admitted"); })]);
  controller.abort(reason);
  const outcome = await running;
  assert.equal(outcome.threw, true);
  assert.ok(Object.is(outcome.reason, reason));
  assert.equal(closed, 1);
});

for (const reason of [undefined, null, false, 0, ""]) for (const diagnosticFailure of [false, true]) test(`reference close retains ${diagnosticFailure ? "diagnostic primary" : "standalone close"} ${String(reason)}`, async context => {
  let closed = 0;
  const secondary = new Error("reference close secondary");
  const definition = jobsExtension();
  const extension: ShellExtension = { ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(command) {
      const bindings = command.bindings;
      return builtin.execute.call(builtin, { ...command, bindings: { ...bindings, async prepareReference(value) {
        const result = await bindings.prepareReference(value);
        if (!result.ok) return result;
        return { ok: true, value: { ...result.value, async close() {
          closed++;
          await result.value.close();
          throw diagnosticFailure ? secondary : reason;
        } } };
      } } });
    } })) };
  } };
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [extension] }).use(agentCommands());
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("who=old; wait -n -p who 0; printf wrong", {
    stderr: { async write() { if (diagnosticFailure) throw reason; } },
  }), failure => Object.is(failure, reason));
  assert.equal(closed, 1);
});
