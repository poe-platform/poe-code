import assert from "node:assert/strict";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { InvocationScope } from "../../../../src/shell/cleanup.js";
import { extensionState, forkExtensions } from "../../../../src/shell/extensions.js";
import type { ShellExecutionCheckpoint, ShellExtension, ShellExtensionInstance } from "../../../../src/shell/extensions.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { trapExtension } from "../../../../src/shell/extensions/trap/index.js";
import { Runtime } from "../../../../src/shell/runtime.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";

function setup(create: () => ShellExtensionInstance, extensions: readonly ShellExtension[] = []) {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [{ name: "checkpoint-consumer", create }, ...extensions] });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

for (const scenario of [
  { name: "for", source: "for item in a b; do record; done; record", expected: ["body:a", "checkpoint:a", "body:b", "checkpoint:b", "body:b"] },
  { name: "while", source: "while condition; do record; done", expected: ["condition", "body:", "checkpoint:", "condition", "body:", "checkpoint:", "condition"] },
  { name: "until", source: "until inverse; do record; done", expected: ["condition", "body:", "checkpoint:", "condition", "body:", "checkpoint:", "condition"] },
  { name: "break", source: "for item in a b; do record; break; done", expected: ["body:a", "checkpoint:a"] },
  { name: "continue", source: "for item in a b; do record; continue; record; done", expected: ["body:a", "checkpoint:a", "body:b", "checkpoint:b"] },
  { name: "break two", source: "for outer in a b; do for item in x y; do record; break 2; done; record; done", expected: ["body:x", "checkpoint:x", "checkpoint:x"] },
  { name: "continue two", source: "for outer in a b; do for item in x y; do record; continue 2; done; record; done", expected: ["body:x", "checkpoint:x", "checkpoint:x", "body:x", "checkpoint:x", "checkpoint:x"] },
]) test(`generic checkpoint order: ${scenario.name}`, async context => {
  const events: string[] = [];
  let conditions = 0;
  const shell = setup(() => ({
    builtins: [
      { name: "record", execute(command) { events.push(`body:${command.variable("item") ?? ""}`); return 0; } },
      { name: "condition", execute() { events.push("condition"); return Number(conditions++ >= 2); } },
      { name: "inverse", execute() { events.push("condition"); return Number(conditions++ < 2); } },
    ],
    checkpoint(point: ShellExecutionCheckpoint, command) {
      assert.equal(point, "loop-body-complete");
      events.push(`checkpoint:${command.variable("item") ?? ""}`);
    },
  }));
  context.after(() => shell.dispose());
  const result = await shell.exec(scenario.source);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(events, scenario.expected);
});

for (const source of [
  "for item in; do :; done", "while false; do :; done", "until true; do :; done",
  "f() { :; }; f; eval ':'", "for item in a; do exit 7; done",
  "f() { for item in a; do return 7; done; }; f",
  "set -e; for item in a; do false; done",
  "set -u; for item in a; do printf '%s' \"$missing\"; done",
]) test(`checkpoint does not run for uncompleted body: ${source}`, async context => {
  let checkpoints = 0;
  const shell = setup(() => ({ builtins: [], checkpoint() { checkpoints++; } }));
  context.after(() => shell.dispose());
  await shell.exec(source);
  assert.equal(checkpoints, 0);
});

test("discarded readonly input unit does not checkpoint the abandoned body", async context => {
  let checkpoints = 0;
  const shell = setup(() => ({ builtins: [], checkpoint() { checkpoints++; } }), [arraysExtension()]);
  context.after(() => shell.dispose());
  const result = await shell.exec("readonly -a values=(one); for item in a; do readonly -a values=(two); done\nprintf after");
  assert.equal(result.stdout, "after");
  assert.match(result.stderr, /readonly variable/u);
  assert.equal(checkpoints, 0);
});

test("checkpoint preserves observed status, raw pipeline status and command identity", async context => {
  const observed: unknown[] = [];
  const shell = setup(() => ({ builtins: [], checkpoint(_point, command) {
    observed.push({ status: command.status, pipeline: command.bindings.get("PIPESTATUS", 0), command: command.variable("BASH_COMMAND") });
  } }), [arraysExtension()]);
  context.after(() => shell.dispose());
  const result = await shell.exec("for item in a; do false; done; printf '<%s>' \"$?\"");
  assert.equal(result.stdout, "<1>");
  assert.equal(result.stderr, "");
  assert.deepEqual(observed, [{ status: 1, pipeline: "1", command: "false" }]);
});

test("deliberate callback binding mutations are not rolled back", async context => {
  const shell = setup(() => ({ builtins: [], async checkpoint(_point, command) { await command.bindings.assign("value", "changed"); } }));
  context.after(() => shell.dispose());
  const result = await shell.exec("value=old; for item in a; do :; done; printf '%s' \"$value\"");
  assert.equal(result.stdout, "changed");
  assert.equal(result.stderr, "");
});

test("checkpoint receiver and callable are captured before start mutates the method", async context => {
  let calls = 0;
  const instance: ShellExtensionInstance = { builtins: [], start() {
    Object.defineProperty(this, "checkpoint", { get() { throw new Error("late checkpoint lookup"); } });
  }, checkpoint() { assert.equal(this, instance); calls++; } };
  const shell = setup(() => instance);
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("for item in a b; do :; done")).exitCode, 0);
  assert.equal(calls, 2);
});

for (const value of [null, false, 0, "hook", {}, []]) test(`noncallable own checkpoint is refused: ${JSON.stringify(value)}`, async context => {
  let executed = false;
  const shell = setup(() => Object.assign({ builtins: [{ name: "body", execute() { executed = true; return 0; } }] }, { checkpoint: value }) as unknown as ShellExtensionInstance);
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("body"), TypeError);
  assert.equal(executed, false);
});

test("own accessor checkpoint is rejected without invoking its getter", async context => {
  let gets = 0;
  const shell = setup(() => Object.defineProperty({ builtins: [] }, "checkpoint", { get() { gets++; return () => {}; } }));
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec(":"), TypeError);
  assert.equal(gets, 0);
});

test("inherited checkpoint including accessor is ignored, own undefined is absent", async context => {
  let gets = 0;
  const prototype = Object.defineProperty({}, "checkpoint", { get() { gets++; throw new Error("inherited hook"); } });
  const shell = setup(() => Object.assign(Object.create(prototype) as ShellExtensionInstance, { builtins: [] }), [
    { name: "undefined-hook", create: () => Object.defineProperty({ builtins: [] }, "checkpoint", { value: undefined }) },
  ]);
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("for item in a; do :; done")).exitCode, 0);
  assert.equal(gets, 0);
});

test("fork admission captures a fresh receiver without changing parent hook", async context => {
  const observed: string[] = [];
  function instance(label: string): ShellExtensionInstance {
    const value: ShellExtensionInstance = { builtins: [], fork(scope) { assert.equal(this, value); return instance(scope); }, checkpoint() {
      assert.equal(this, value); observed.push(label);
    } };
    return value;
  }
  const shell = setup(() => instance("parent"));
  context.after(() => shell.dispose());
  const result = await shell.exec("(for item in a; do :; done); value=$(for item in a; do :; done); for item in a; do :; done");
  assert.equal(result.stderr, "");
  assert.deepEqual(observed, ["parent", "subshell", "parent", "substitution", "parent"]);
});

test("fork rejects own accessor before executing child body", () => {
  let gets = 0;
  const parent = extensionState([{ name: "fork-contract", create: () => ({ builtins: [], fork: () => Object.defineProperty({ builtins: [] }, "checkpoint", { get() { gets++; return () => {}; } }) }) }]);
  assert.throws(() => forkExtensions(parent, "subshell"), TypeError);
  assert.equal(gets, 0);
});

for (const payload of [false, 0, null, { action: "skip" }, { action: "return", status: 7 }]) test(`checkpoint resolved payload is noncontrolling: ${JSON.stringify(payload)}`, async context => {
  let calls = 0;
  const shell = setup(() => ({ builtins: [], checkpoint() { calls++; return payload as never; } }));
  context.after(() => shell.dispose());
  const result = await shell.exec("for item in a b; do printf body; done; printf after");
  assert.equal(result.stdout, "bodybodyafter");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(calls, 2);
});

test("checkpoint is separate from trap RETURN dispatch", async context => {
  let checkpoints = 0;
  const shell = setup(() => ({ builtins: [], checkpoint() { checkpoints++; } }), [trapExtension()]);
  context.after(() => shell.dispose());
  const result = await shell.exec("trap 'printf RETURN' RETURN; for item in a b; do :; done; printf done");
  assert.equal(result.stdout, "done");
  assert.equal(result.stderr, "");
  assert.equal(checkpoints, 2);
});

test("without an enrolled checkpoint loop completion keeps its existing microtask order", async () => {
  async function order(extensions: ReturnType<typeof extensionState>) {
    const events: string[] = [];
    const runtime = { script: async () => 7, extensionCheckpoint() { throw new Error("absent checkpoint dispatch"); } };
    const pending = Reflect.apply(Runtime.prototype.loopBody, runtime, [{}, { extensions }, {}]) as Promise<{ status: number; stop: boolean }>;
    void pending.then(() => { events.push("done"); });
    queueMicrotask(() => { events.push("one"); queueMicrotask(() => { events.push("two"); }); });
    assert.deepEqual(await pending, { status: 7, stop: false });
    await Promise.resolve();
    return events;
  }
  const baseline = await order(undefined);
  assert.deepEqual(baseline, ["one", "done", "two"]);
  assert.deepEqual(await order(extensionState([{ name: "no-hook", create: () => ({ builtins: [] }) }])), baseline);
});

for (const reason of [undefined, null, false, 0, "", new ShellLimitError("maxExpansionBytes")]) test(`escaping checkpoint failure retains identity: ${String(reason)}`, async context => {
  let closed = 0;
  const shell = setup(() => ({ builtins: [], checkpoint(_point, command) { command.registerCleanup(() => { closed++; }); throw reason; } }));
  context.after(() => shell.dispose());
  const outcome = await shell.exec("for item in a; do :; done").then(() => ({ threw: false, reason: undefined }), error => ({ threw: true, reason: error as unknown }));
  assert.equal(outcome.threw, true);
  assert.ok(Object.is(outcome.reason, reason));
  assert.equal(closed, 1);
});

for (const reason of [null, false, 0, ""]) test(`root cancellation drains checkpoint acquisition and retains reason: ${String(reason)}`, { timeout: 2500 }, async context => {
  const entered = deferred();
  const release = deferred();
  const controller = new AbortController();
  let acquired = false;
  let closed = false;
  const shell = setup(() => ({ builtins: [], async checkpoint(_point, command) {
    command.registerCleanup(async () => { await acquisition; closed = acquired; });
    const acquisition = release.promise.then(() => { acquired = true; });
    entered.resolve();
    await acquisition;
    throw new Error("late cooperative failure");
  } }));
  const running = shell.exec("for item in a; do :; done", { signal: controller.signal }).then(() => ({ threw: false, reason: undefined }), error => ({ threw: true, reason: error as unknown }));
  context.after(async () => { release.resolve(); await running; await shell.dispose(); });
  await Promise.race([entered.promise, running.then(() => { throw new Error("checkpoint was not admitted"); })]);
  controller.abort(reason);
  let settled = false;
  void running.then(() => { settled = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  release.resolve();
  const outcome = await running;
  assert.equal(outcome.threw, true);
  assert.ok(Object.is(outcome.reason, reason));
  assert.equal(closed, true);
});

test("checkpoint work is enrolled before callback reentrantly closes its invocation scope", { timeout: 2500 }, async context => {
  const release = deferred();
  const entered = deferred();
  const observed: { scope?: InvocationScope; closing?: Promise<void> } = {};
  const original = InvocationScope.prototype.run;
  context.mock.method(InvocationScope.prototype, "run", function<Value>(this: InvocationScope, operation: () => Promise<Value>) {
    observed.scope = this;
    return original.call(this, operation) as Promise<Value>;
  });
  const shell = setup(() => ({ builtins: [], async checkpoint() {
    assert.ok(observed.scope);
    observed.closing = observed.scope.close();
    entered.resolve();
    await release.promise;
  } }));
  const running = shell.exec("for item in a; do :; done").then(value => ({ value }), error => ({ error: error as unknown }));
  context.after(async () => { release.resolve(); await running; await shell.dispose(); });
  await Promise.race([entered.promise, running.then(() => { throw new Error("checkpoint was not admitted"); })]);
  let closed = false;
  void observed.closing!.then(() => { closed = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  release.resolve();
  await running;
  await observed.closing;
  assert.equal(closed, true);
});

test("function, eval and source share checkpoints while process and pipeline owners fork", async context => {
  const observations: { label: string; scope: object }[] = [];
  function instance(label: string): ShellExtensionInstance {
    return { builtins: [], fork: scope => instance(scope), checkpoint(_point, command) { observations.push({ label, scope: command.scope }); } };
  }
  const shell = setup(() => instance("parent"));
  context.after(() => shell.dispose());
  const result = await shell.exec("f() { for item in a; do :; done; }; f; eval 'for item in a; do :; done'; printf 'for item in a; do :; done' >/script; source /script; bash /script; sh /script; for item in a; do :; done | for item in a; do :; done");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(observations.map(entry => entry.label).sort(), ["parent", "parent", "parent", "parent", "pipeline", "pipeline", "process", "process"]);
  const parent = observations.filter(entry => entry.label === "parent");
  assert.equal(new Set(parent.map(entry => entry.scope)).size, 1);
  assert.equal(new Set(observations.map(entry => entry.scope)).size, 5);
});

test("checkpoint callbacks run in enrollment order and await each predecessor", async context => {
  const events: string[] = [];
  const shell = setup(() => ({ builtins: [], async checkpoint() { events.push("first:start"); await Promise.resolve(); events.push("first:end"); } }), [
    { name: "next-contract", create: () => ({ builtins: [], checkpoint() { events.push("second"); } }) },
  ]);
  context.after(() => shell.dispose());
  await shell.exec("for item in a b; do :; done");
  assert.deepEqual(events, ["first:start", "first:end", "second", "first:start", "first:end", "second"]);
});

test("a rejected callback prevents later callbacks and shell continuation", async context => {
  const reason = new Error("checkpoint rejected");
  let later = false;
  let continued = false;
  const shell = setup(() => ({ builtins: [], async checkpoint() { await Promise.resolve(); throw reason; } }), [
    { name: "later-contract", create: () => ({ builtins: [{ name: "continued", execute() { continued = true; return 0; } }], checkpoint() { later = true; } }) },
  ]);
  context.after(() => shell.dispose());
  await assert.rejects(shell.exec("for item in a; do :; done; continued"), error => error === reason);
  assert.equal(later, false);
  assert.equal(continued, false);
});

for (const wrapper of [
  "f() { BODY; }; f", "eval 'BODY'", "(BODY)", "value=$(BODY)",
  "printf 'BODY' >/script; bash /script", "printf 'BODY' >/script; sh /script",
  "printf 'BODY' >/script; source /script", "BODY | :",
]) test(`falsey checkpoint failures escape nested execution: ${wrapper}`, async context => {
  const shell = setup(() => ({ builtins: [], checkpoint() { throw false; } }));
  context.after(() => shell.dispose());
  const source = wrapper.replace("BODY", "for item in a; do :; done");
  const outcome = await shell.exec(source).then(() => ({ threw: false, reason: undefined }), error => ({ threw: true, reason: error as unknown }));
  assert.equal(outcome.threw, true);
  assert.equal(outcome.reason, false);
});

for (const reason of [undefined, null, false, 0, ""]) test(`checkpoint failure outranks owned cleanup failure: ${String(reason)}`, async context => {
  let cleanup = 0;
  const shell = setup(() => ({ builtins: [], checkpoint(_point, command) {
    command.registerCleanup(() => { cleanup++; throw new Error("secondary cleanup"); });
    throw reason;
  } }));
  context.after(() => shell.dispose());
  const outcome = await shell.exec("for item in a; do :; done").then(() => ({ threw: false, reason: undefined }), error => ({ threw: true, reason: error as unknown }));
  assert.equal(outcome.threw, true);
  assert.ok(Object.is(outcome.reason, reason));
  assert.equal(cleanup, 1);
});

test("cancellation during the body prevents checkpoint admission", async context => {
  const controller = new AbortController();
  let checkpoints = 0;
  const shell = setup(() => ({ builtins: [{ name: "cancel", execute() { controller.abort(false); return 0; } }], checkpoint() { checkpoints++; } }));
  context.after(() => shell.dispose());
  const outcome = await shell.exec("for item in a; do cancel; done", { signal: controller.signal }).then(() => ({ threw: false, reason: undefined }), error => ({ threw: true, reason: error as unknown }));
  assert.equal(outcome.threw, true);
  assert.equal(outcome.reason, false);
  assert.equal(checkpoints, 0);
});

test("an async non-undefined result is not a shell control directive", async context => {
  const shell = setup(() => ({ builtins: [], async checkpoint() { await Promise.resolve(); return { action: "return", status: 7 } as never; } }));
  context.after(() => shell.dispose());
  const result = await shell.exec("for item in a; do :; done; printf after");
  assert.equal(result.stdout, "after");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

for (const source of [
  "trap 'for item in a; do :; done' EXIT; :",
  "f() { trap 'for item in a; do :; done' RETURN; :; }; f",
]) test(`checkpoint failures in trap evaluation remain escaping: ${source}`, async context => {
  let calls = 0;
  const shell = setup(() => ({ builtins: [], checkpoint() { calls++; throw false; } }), [trapExtension()]);
  context.after(() => shell.dispose());
  const outcome = await shell.exec(source).then(() => ({ threw: false, reason: undefined }), error => ({ threw: true, reason: error as unknown }));
  assert.equal(calls, 1);
  assert.equal(outcome.threw, true);
  assert.equal(outcome.reason, false);
});

test("checkpoint failure during EXIT outranks cleanup failure without leaking its carrier", async context => {
  let cleanups = 0;
  const shell = setup(() => ({ builtins: [], checkpoint(_point, command) {
    command.registerCleanup(() => { cleanups++; throw new Error("cleanup after EXIT checkpoint"); });
    throw false;
  } }), [trapExtension()]);
  context.after(() => shell.dispose());
  const outcome = await shell.exec("trap 'for item in a; do :; done' EXIT; :").then(() => ({ threw: false, reason: undefined }), error => ({ threw: true, reason: error as unknown }));
  assert.equal(outcome.threw, true);
  assert.equal(outcome.reason, false);
  assert.equal(cleanups, 1);
});
