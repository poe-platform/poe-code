import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import type { CommandContext } from "../../../../src/contracts/command.js";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { Shell } from "../../../../src/shell/shell.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

function subject(context: TestContext, fs: FileSystem = createMemoryFileSystem()) {
  const events = new Map<string, ReturnType<typeof deferred>>();
  const gates = new Map<string, ReturnType<typeof deferred>>();
  const diagnostic = deferred();
  const stderr: Uint8Array[] = [];
  const controller = new AbortController();
  const executions: Promise<unknown>[] = [];
  let active = 0;
  let acquired = 0;
  let released = 0;
  const trace: string[] = [];
  const owned: { shell?: Shell } = {};
  const event = (name: string) => {
    let entry = events.get(name);
    if (!entry) { entry = deferred(); events.set(name, entry); }
    return entry;
  };
  const gate = (name: string) => {
    let entry = gates.get(name);
    if (!entry) { entry = deferred(); gates.set(name, entry); }
    return entry;
  };
  const timer = setTimeout(() => controller.abort(new Error("lifecycle review safety deadline")), 1800);
  context.after(async () => {
    clearTimeout(timer);
    controller.abort(new Error("lifecycle review teardown"));
    for (const entry of gates.values()) entry.resolve();
    await Promise.allSettled(executions);
    await owned.shell?.dispose();
    context.diagnostic(JSON.stringify({ trace, active, acquired, released }));
    assert.equal(active, 0, "all admitted gate owners released");
    assert.equal(released, acquired);
  });
  const shell = owned.shell = new Shell({ fs, extensions: [jobsExtension()], limits: {
    maxWallClockMs: 2000, maxOutputBytes: 65536, pipeHighWaterMark: 8,
  } });
  for (const command of basicCommands()) shell.register(command);
  const hold = async (invocation: CommandContext, name: string) => {
    let admitted = false;
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      invocation.signal.removeEventListener("abort", cleanup);
      if (admitted) { active--; released++; gate(name).resolve(); }
    };
    assert.equal(typeof invocation.registerCleanup, "function");
    invocation.registerCleanup!(cleanup);
    invocation.signal.throwIfAborted();
    assert.equal(closed, false);
    admitted = true;
    acquired++;
    active++;
    trace.push(`holding:${name}`);
    invocation.signal.addEventListener("abort", cleanup, { once: true });
    event(`holding:${name}`).resolve();
    try { await gate(name).promise; invocation.signal.throwIfAborted(); }
    finally { cleanup(); }
  };
  shell.register({ name: "review_gate", async execute(invocation) {
    await hold(invocation, invocation.args[0]!);
    return { exitCode: 0 };
  } });
  shell.register({ name: "review_mark", execute(invocation) {
    trace.push(invocation.args[0]!);
    event(invocation.args[0]!).resolve();
    return { exitCode: 0 };
  } });
  return {
    shell, hold, mark: (name: string) => { trace.push(name); event(name).resolve(); },
    release: (name: string) => gate(name).resolve(),
    run(source: string) {
      const execution = shell!.exec(source, { signal: controller.signal,
        stderr: { async write(bytes) {
          stderr.push(bytes.slice());
          trace.push(`stderr:${Buffer.from(bytes).toString("hex")}`);
          diagnostic.resolve();
        } },
      });
      executions.push(execution);
      void execution.catch(() => undefined);
      return execution;
    },
    async reached(name: string, execution: Promise<unknown>) {
      await Promise.race([event(name).promise, diagnostic.promise.then(() => {
        throw new Error(`Unexpected stderr before ${name}: ${Buffer.concat(stderr).toString()}`);
      }), execution.then(
        result => { throw new Error(`Execution completed before ${name}: ${JSON.stringify(result)}`); },
        reason => { throw reason; },
      )]);
    },
  };
}

function observedFileSystem() {
  const memory = createMemoryFileSystem();
  const handles: { path: string; closes: number; reads: number; writes: number }[] = [];
  const fs = new Proxy(memory, { get(target, key) {
    if (key === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
      const descriptor = await target.open(...args);
      const record = { path: args[0], closes: 0, reads: 0, writes: 0 };
      handles.push(record);
      return new Proxy(descriptor, { get(retained, property) {
        if (property === "close") return async () => { record.closes++; await retained.close(); };
        if (property === "read") return (...request: Parameters<typeof retained.read>) => { record.reads++; return retained.read(...request); };
        if (property === "write") return (...request: Parameters<typeof retained.write>) => { record.writes++; return retained.write(...request); };
        const value: unknown = Reflect.get(retained, property, retained);
        return typeof value === "function" ? value.bind(retained) : value;
      } });
    };
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  return { fs, memory, handles };
}

for (const enclosure of ["function", "group"] as const) {
  test(`adapted lifecycle: ${enclosure} return and fd rebinding retain child VFS descriptors`, { timeout: 4000 }, async context => {
    const observed = observedFileSystem();
    const bytes = Uint8Array.of(65, 0, 255, 128, 10, 66);
    await observed.memory.writeFile("/input", bytes);
    const control = subject(context, observed.fs);
    control.shell.register({ name: "review_copy", async execute(invocation) {
      for await (const chunk of invocation.stdin) await invocation.stdout.write(chunk);
      return { exitCode: 0 };
    } });
    const body = "{ review_gate child; review_copy <&3 >&4; } &";
    const invocation = enclosure === "function"
      ? `launch() { ${body} }; launch 3</input 4>/output`
      : `{ ${body} } 3</input 4>/output`;
    const execution = control.run(`${invocation}; { printf rebound >&4; } 4>/replacement; : 3<&- 4>&-; review_mark rebound; wait`);
    await control.reached("rebound", execution);
    for (const path of ["/input", "/output"]) {
      const retained = observed.handles.filter(handle => handle.path === path);
      assert.equal(retained.length, 1);
      assert.equal(retained[0]!.closes, 0, `${path} remains child-owned after parent scope returns`);
    }
    control.release("child");
    const result = await execution;
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "");
    assert.deepEqual(await observed.memory.readFile("/output"), bytes);
    assert.deepEqual(await observed.memory.readFile("/replacement"), new TextEncoder().encode("rebound"));
    assert.ok(observed.handles.some(handle => handle.path === "/input" && handle.reads > 0));
    assert.ok(observed.handles.some(handle => handle.path === "/output" && handle.writes > 0));
    assert.ok(observed.handles.every(handle => handle.closes === 1), "each actual VFS descriptor closes once");
  });
}

for (const explicitWait of [false, true]) test(`adapted lifecycle: substitution retains inherited writer until raw-byte EOF; wait=${explicitWait}`, { timeout: 4000 }, async context => {
  const control = subject(context);
  let emitted = 0;
  let cleaned = 0;
  control.shell.register({ name: "review_emit", async execute(invocation) {
    invocation.registerCleanup!(() => { cleaned++; });
    await invocation.stdout.write(Uint8Array.of(255, 128, 65, 10, 10));
    emitted++;
    return { exitCode: 0 };
  } });
  const execution = control.run(`value=$({ review_gate writer; review_emit; } & review_mark direct_eof; ${explicitWait ? "wait; " : ""}exit 0); printf "<%s>" "$value"`);
  let settled = false;
  void execution.then(() => { settled = true; }, () => { settled = true; });
  await control.reached("direct_eof", execution);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(emitted, 0);
  control.release("writer");
  const result = await execution;
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(result.stdoutBytes, Uint8Array.of(60, 255, 128, 65, 62));
  assert.equal(emitted, 1);
  assert.equal(cleaned, 1);
});

for (const mode of ["background", "wait", "foreground"] as const) test(`adapted lifecycle: pipeline EOF retains a writer under bounded backpressure; ${mode}`, { timeout: 4000 }, async context => {
  const control = subject(context);
  const payload = Uint8Array.from({ length: 257 }, (_, index) => index % 256);
  const collected: Uint8Array[] = [];
  let written = false;
  let cleaned = 0;
  control.shell.register({ name: "review_emit", async execute(invocation) {
    invocation.registerCleanup!(() => { cleaned++; });
    control.mark("writing");
    await invocation.stdout.write(payload.subarray(0, 128));
    await invocation.stdout.write(payload.subarray(128));
    written = true;
    return { exitCode: 0 };
  } });
  control.shell.register({ name: "review_collect", async execute(invocation) {
    await control.hold(invocation, "consumer");
    for await (const chunk of invocation.stdin) collected.push(chunk.slice());
    return { exitCode: 0 };
  } });
  const producer = mode === "foreground" ? "review_mark direct_eof; review_gate writer; review_emit;"
    : `{ review_gate writer; review_emit; } & review_mark direct_eof; ${mode === "wait" ? "wait;" : ""}`;
  const execution = control.run(`{ ${producer} } | review_collect`);
  await control.reached("direct_eof", execution);
  await control.reached("holding:consumer", execution);
  control.release("writer");
  await control.reached("writing", execution);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(written, false, "an inherited writer still observes pipe backpressure");
  control.release("consumer");
  const result = await execution;
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(Buffer.concat(collected), Buffer.from(payload));
  assert.equal(written, true);
  assert.equal(cleaned, 1);
});

for (const failure of [undefined, false, 0, ""] as const) {
  test(`adapted lifecycle: root drain retains late VFS-script generations and ${String(failure)} cleanup`, { timeout: 4000 }, async context => {
    const observed = observedFileSystem();
    await observed.memory.writeFile("/generation.sh", new TextEncoder().encode("{ review_gate second; review_emit >/late; } &"));
    const control = subject(context, observed.fs);
    let cleaned = 0;
    control.shell.register({ name: "review_emit", async execute(invocation) {
      invocation.registerCleanup!(() => { cleaned++; if (failure !== undefined) throw failure; });
      await invocation.stdout.write(Uint8Array.of(0, 255, 65));
      await invocation.stderr.write(Uint8Array.of(128, 66));
      return { exitCode: 0 };
    } });
    const execution = control.run("{ review_gate first; sh /generation.sh; } & review_mark foreground_eof");
    await control.reached("foreground_eof", execution);
    await control.reached("holding:first", execution);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(observed.handles.some(handle => handle.path === "/late"), false);
    control.release("first");
    await control.reached("holding:second", execution);
    control.release("second");
    const outcome = await execution.then(result => ({ result }), reason => ({ reason }));
    context.diagnostic(JSON.stringify({ outcome, cleaned, handles: observed.handles }));
    if (failure === undefined) {
      const result = await execution;
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "");
      assert.deepEqual(result.stderrBytes, Uint8Array.of(128, 66));
    } else await assert.rejects(execution, reason => Object.is(reason, failure));
    assert.deepEqual(await observed.memory.readFile("/late"), Uint8Array.of(0, 255, 65));
    assert.equal(cleaned, 1);
    assert.equal(observed.handles.filter(handle => handle.path === "/late").length, 1);
    assert.ok(observed.handles.every(handle => handle.closes === 1));
  });
}

for (const failure of [false, 0, ""] as const) {
  test(`control: foreground command cleanup preserves exact ${String(failure)}`, { timeout: 4000 }, async context => {
    const control = subject(context);
    let cleaned = 0;
    control.shell.register({ name: "review_fail", execute(invocation) {
      invocation.registerCleanup!(() => { cleaned++; throw failure; });
      return { exitCode: 0 };
    } });
    await assert.rejects(control.run("review_fail"), reason => Object.is(reason, failure));
    assert.equal(cleaned, 1);
  });
}
