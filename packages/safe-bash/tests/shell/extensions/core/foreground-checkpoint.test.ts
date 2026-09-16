import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { InvocationScope, invocationScope } from "../../../../src/shell/cleanup.js";
import { PipeDescriptorFrame } from "../../../../src/shell/descriptors.js";
import type { PipeDescriptorReference } from "../../../../src/shell/descriptors.js";
import type { ShellExtensionContext, ShellExtensionInstance } from "../../../../src/shell/extensions.js";
import { ShellInput } from "../../../../src/shell/input.js";
import { Runtime } from "../../../../src/shell/runtime.js";
import { Shell } from "../../../../src/shell/shell.js";
import type { ShellLimits, ShellResult } from "../../../../src/shell/types.js";
import { ValueStore } from "../../../../src/shell/value-state.js";

async function bounded<Value>(pending: Promise<Value>, operation: string): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${operation} did not settle within 500ms`)), 500);
    })]);
  } finally { clearTimeout(timer); }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function setup(context: TestContext, options: {
  checkpoint?: (point: string, command: ShellExtensionContext) => void | Promise<void>;
  omitCheckpoint?: boolean;
  failFork?: () => void;
  limits?: ShellLimits;
} = {}) {
  const observed = {
    events: [] as string[],
    copies: [] as ValueStore[],
    closed: new Set<ValueStore>(),
    callbacks: [] as { point: string; owner: string; scope: object }[],
    parentScope: undefined as object | undefined,
    forks: 0,
    childRuns: 0,
  };
  const clone = ValueStore.prototype.clone;
  const close = ValueStore.prototype.close;
  context.mock.method(ValueStore.prototype, "clone", function(this: ValueStore) {
    observed.events.push("clone");
    const copy = clone.call(this);
    observed.copies.push(copy);
    return copy;
  });
  context.mock.method(ValueStore.prototype, "close", function(this: ValueStore) {
    close.call(this);
    observed.closed.add(this);
  });
  function instance(owner: string): ShellExtensionInstance {
    const result: ShellExtensionInstance = {
      builtins: [],
      start(command) { if (owner === "parent") observed.parentScope = command.scope; },
      fork(scope) {
        const child = `${scope}:${++observed.forks}`;
        observed.events.push(`fork:${child}`);
        options.failFork?.();
        return instance(child);
      },
      event(point, command) {
        if (point === "command" && owner !== "parent" && command.command === ":") {
          observed.childRuns++;
          observed.events.push(`run:${owner}`);
        }
      },
    };
    if (!options.omitCheckpoint) result.checkpoint = async (point, command) => {
      observed.events.push(`checkpoint:${owner}:${point}`);
      observed.callbacks.push({ point, owner, scope: command.scope });
      await options.checkpoint?.(point, command);
    };
    return result;
  }
  const owner: { shell?: Shell } = {};
  context.after(async () => { if (owner.shell) await bounded(owner.shell.dispose(), "shell disposal"); });
  const shell = new Shell({ fs: createMemoryFileSystem(), ...(options.limits ? { limits: options.limits } : {}), extensions: [{
    name: "foreground-checkpoint-contract",
    create: () => instance("parent"),
  }] });
  owner.shell = shell;
  return { shell, observed };
}

const foreground = [
  { name: "subshell", source: "(:)", point: "child-job-install", children: 1 },
  { name: "aggregate pipeline", source: ": | :", point: "child-job-install", children: 2 },
  { name: "dollar-parenthesis", source: "value=$(:)", point: "source-input-read", children: 1 },
] as const;

test("colon does not dispatch a foreground checkpoint or clone a child", async context => {
  const { shell, observed } = setup(context);
  const result = await bounded(shell.exec(":"), "colon");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(observed.events, []);
});

for (const scenario of foreground) test(`${scenario.name}: one parent checkpoint at the admitted boundary`, async context => {
  const { shell, observed } = setup(context);
  const result = await bounded(shell.exec(scenario.source), scenario.name);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(observed.callbacks.map(({ point, owner }) => ({ point, owner })), [{ point: scenario.point, owner: "parent" }]);
  assert.equal(observed.callbacks[0]!.scope, observed.parentScope);
  assert.equal(observed.forks, scenario.children);
  assert.equal(observed.childRuns, scenario.children);
  const checkpoint = observed.events.indexOf(`checkpoint:parent:${scenario.point}`);
  const forks = observed.events.flatMap((event, index) => event.startsWith("fork:") ? [index] : []);
  const runs = observed.events.flatMap((event, index) => event.startsWith("run:") ? [index] : []);
  assert.ok(runs.every(index => index > checkpoint), JSON.stringify(observed.events));
  if (scenario.point === "source-input-read") {
    assert.ok(checkpoint < observed.events.indexOf("clone"), JSON.stringify(observed.events));
    assert.ok(forks.every(index => index > checkpoint), JSON.stringify(observed.events));
  } else {
    assert.ok(forks.every(index => index < checkpoint), JSON.stringify(observed.events));
  }
  assert.ok(observed.copies.length > 0);
  assert.ok(observed.copies.every(copy => observed.closed.has(copy)));
});

for (const scenario of [
  { name: "skipped and-list pipeline", source: "! : && : | :", status: 1 },
  { name: "skipped or-list subshell", source: ": || (:)", status: 0 },
  { name: "present default alternate", source: 'present=set; : "${present:-$(:)}"', status: 0 },
  { name: "absent positive alternate", source: ': "${absent:+$(:)}"', status: 0 },
]) test(`${scenario.name}: inactive syntax does not checkpoint or clone`, async context => {
  const { shell, observed } = setup(context);
  const result = await bounded(shell.exec(scenario.source), scenario.name);
  assert.equal(result.exitCode, scenario.status);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.deepEqual(observed.events, []);
});

test("the four forms need neither a checkpoint consumer nor optional/default plugins", async context => {
  const { shell, observed } = setup(context, { omitCheckpoint: true });
  const owner: { shell?: Shell } = {};
  context.after(async () => { if (owner.shell) await bounded(owner.shell.dispose(), "plain shell disposal"); });
  const plain = new Shell({ fs: createMemoryFileSystem() });
  owner.shell = plain;
  for (const scenario of [{ source: ":", children: 0 }, ...foreground]) {
    const baseline: ShellResult = await bounded(plain.exec(scenario.source), "plain execution");
    observed.events.length = 0;
    observed.copies.length = 0;
    observed.closed.clear();
    observed.forks = 0;
    observed.childRuns = 0;
    const result = await bounded(shell.exec(scenario.source), "hook-free observer execution");
    assert.equal(baseline.exitCode, 0);
    assert.equal(baseline.stdout, "");
    assert.equal(baseline.stderr, "");
    assert.deepEqual(result, baseline);
    assert.equal(observed.forks, scenario.children);
    assert.equal(observed.childRuns, scenario.children);
    assert.equal(observed.copies.length, 2 * scenario.children);
    assert.ok(observed.copies.every(copy => observed.closed.has(copy)));
    assert.deepEqual(observed.callbacks, []);
  }
});

for (const sourceLine of [undefined, 777]) test(`dollar-parenthesis admission uses form, not sourceLine=${String(sourceLine)}`, async context => {
  const original = Runtime.prototype.runUnit;
  let inspected = false;
  context.mock.method(Runtime.prototype, "runUnit", function(this: Runtime, ...args: Parameters<Runtime["runUnit"]>) {
    if (!inspected) {
      const command = args[0].lists[0]!.pipelines[0]!.commands[0]!;
      assert.equal(command.kind, "simple");
      if (command.kind !== "simple") throw new Error("Expected assignment command");
      const substitution = command.words.flatMap(word => word.parts).find(part => part.kind === "substitution");
      assert.ok(substitution?.kind === "substitution");
      assert.equal(substitution.form, "dollar-parenthesis");
      if (sourceLine === undefined) delete substitution.sourceLine;
      else substitution.sourceLine = sourceLine;
      inspected = true;
    }
    return original.apply(this, args);
  });
  const { shell, observed } = setup(context);
  const result = await bounded(shell.exec("value=$(:)"), "provenance admission");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(inspected, true);
  assert.deepEqual(observed.callbacks.map(({ point, owner }) => ({ point, owner })), [{ point: "source-input-read", owner: "parent" }]);
  assert.ok(observed.events.indexOf("checkpoint:parent:source-input-read") < observed.events.indexOf("clone"));
});

for (const scenario of foreground) {
  for (const reason of [undefined, null, false, 0, ""]) test(`${scenario.name}: callback rejection preserves ${String(reason)} and cleans acquired values`, async context => {
    let acquired = false;
    let cleanups = 0;
    const { shell, observed } = setup(context, { checkpoint(point, command) {
      assert.equal(point, scenario.point);
      command.registerCleanup(() => { assert.equal(acquired, true); acquired = false; cleanups++; });
      acquired = true;
      throw reason;
    } });
    const outcome = await bounded(shell.exec(scenario.source).then(
      () => ({ rejected: false, reason: undefined as unknown }),
      failure => ({ rejected: true, reason: failure as unknown }),
    ), "checkpoint rejection");
    assert.equal(outcome.rejected, true);
    assert.ok(Object.is(outcome.reason, reason));
    assert.deepEqual(observed.callbacks.map(({ point, owner }) => ({ point, owner })), [{ point: scenario.point, owner: "parent" }]);
    assert.equal(cleanups, 1);
    assert.equal(acquired, false);
    assert.equal(observed.childRuns, 0);
    assert.equal(observed.forks, scenario.point === "source-input-read" ? 0 : scenario.children);
    if (scenario.point === "source-input-read") assert.equal(observed.copies.length, 0);
    else assert.ok(observed.copies.length > 0);
    assert.ok(observed.copies.every(copy => observed.closed.has(copy)));
  });
}

for (const scenario of foreground) test(`${scenario.name}: parent awaits cooperative callback before child execution`, async context => {
  const entered = deferred();
  const release = deferred();
  let acquisition: Promise<void> | undefined;
  let acquired = false;
  let cleanups = 0;
  const running: { pending?: Promise<unknown> } = {};
  context.after(async () => { release.resolve(); if (running.pending) await bounded(running.pending, "cooperative execution drain"); });
  const { shell, observed } = setup(context, { async checkpoint(point, command) {
    assert.equal(point, scenario.point);
    command.registerCleanup(async () => { await acquisition; acquired = false; cleanups++; });
    acquisition = release.promise.then(() => { acquired = true; });
    entered.resolve();
    await acquisition;
  } });
  const pending = shell.exec(scenario.source);
  running.pending = pending.then(() => undefined, () => undefined);
  try {
    await bounded(Promise.race([entered.promise, pending.then(() => { throw new Error("checkpoint was not admitted"); })]), "callback admission");
    assert.equal(observed.childRuns, 0);
    assert.equal(observed.forks, scenario.point === "source-input-read" ? 0 : scenario.children);
    assert.equal(acquired, false);
    assert.equal(cleanups, 0);
  } finally { release.resolve(); }
  const result = await bounded(pending, "cooperative callback completion");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(observed.childRuns, scenario.children);
  assert.equal(cleanups, 1);
  assert.equal(acquired, false);
});

test("pipeline failure-finally admission sentinels are not successful aggregate installation", async context => {
  const reason = new Error("injected pipeline fork preparation failure");
  const { shell, observed } = setup(context, { failFork() { throw reason; } });
  const outcome = await bounded(shell.exec(": | :").then(
    () => ({ rejected: false, reason: undefined as unknown }),
    failure => ({ rejected: true, reason: failure as unknown }),
  ), "failed pipeline preparation");
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, reason);
  assert.equal(observed.forks, 2);
  assert.deepEqual(observed.callbacks, []);
  assert.equal(observed.childRuns, 0);
  assert.ok(observed.copies.length > 0);
  assert.ok(observed.copies.every(copy => observed.closed.has(copy)));
});

for (const failedPreparation of [2, 1]) test(`enrolled observer blocks a prepared pipeline peer when preparation ${failedPreparation} fails`, async context => {
  const reason = new Error(`injected mixed pipeline preparation failure ${failedPreparation}`);
  let preparations = 0;
  const prepared: number[] = [];
  const { shell, observed } = setup(context, { failFork() {
    preparations++;
    if (preparations === failedPreparation) throw reason;
    prepared.push(preparations);
  } });
  const outcome = await bounded(shell.exec(": | :").then(
    () => ({ rejected: false, reason: undefined as unknown }),
    failure => ({ rejected: true, reason: failure as unknown }),
  ), "mixed pipeline preparation cleanup");
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, reason);
  assert.equal(observed.forks, 2);
  assert.deepEqual(prepared, [3 - failedPreparation]);
  assert.deepEqual(observed.callbacks, []);
  assert.equal(observed.copies.length, 4);
  assert.ok(observed.copies.every(copy => observed.closed.has(copy)));
  assert.equal(observed.childRuns, 0, JSON.stringify(observed.events));
});

test("pipeline stage-budget rejection occurs before installation callbacks or child clones", async context => {
  const { shell, observed } = setup(context, { limits: { maxPipelineStages: 1 } });
  await assert.rejects(bounded(shell.exec(": | :"), "pipeline stage budget"), { name: "ShellLimitError", limit: "maxPipelineStages" });
  assert.deepEqual(observed.events, []);
});

test("cancellation during parent source-input-read drains acquisition without cloning and retains falsey root reason", async context => {
  const entered = deferred();
  const release = deferred();
  const controller = new AbortController();
  let acquisition: Promise<void> | undefined;
  let acquired = false;
  let cleanups = 0;
  const running: { pending?: Promise<unknown> } = {};
  context.after(async () => { release.resolve(); if (running.pending) await bounded(running.pending, "cancelled execution drain"); });
  const { shell, observed } = setup(context, { async checkpoint(point, command) {
    assert.equal(point, "source-input-read");
    command.registerCleanup(async () => { await acquisition; acquired = false; cleanups++; });
    acquisition = release.promise.then(() => { acquired = true; });
    entered.resolve();
    await acquisition;
    throw new Error("late callback failure must not replace root cancellation");
  } });
  const pending = shell.exec("value=$(:)", { signal: controller.signal }).then(
    () => ({ rejected: false, reason: undefined as unknown }),
    reason => ({ rejected: true, reason: reason as unknown }),
  );
  running.pending = pending;
  try {
    await bounded(Promise.race([entered.promise, pending.then(() => { throw new Error("checkpoint was not admitted"); })]), "cancellable callback admission");
    controller.abort(false);
    assert.equal(observed.copies.length, 0);
    assert.equal(observed.forks, 0);
    assert.equal(cleanups, 0);
  } finally { release.resolve(); }
  const outcome = await bounded(pending, "cancelled callback cleanup");
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, false);
  assert.equal(cleanups, 1);
  assert.equal(acquired, false);
  assert.equal(observed.childRuns, 0);
  assert.equal(observed.copies.length, 0);
  assert.equal(observed.forks, 0);
});

for (const failedPreparation of [2, 1]) test(`without observers mixed preparation ${failedPreparation} keeps existing peer scheduling`, async context => {
  const reason = new Error(`observer-free preparation failure ${failedPreparation}`);
  let preparations = 0;
  const { shell, observed } = setup(context, { omitCheckpoint: true, failFork() {
    if (++preparations === failedPreparation) throw reason;
  } });
  const outcome = await bounded(shell.exec(": | :").then(
    () => ({ rejected: false, reason: undefined as unknown }),
    failure => ({ rejected: true, reason: failure as unknown }),
  ), "observer-free pipeline cleanup");
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, reason);
  assert.deepEqual(observed.callbacks, []);
  assert.equal(observed.childRuns, 1);
  assert.ok(observed.copies.every(copy => observed.closed.has(copy)));
});

test("pipeline child source-input checkpoint keeps falsey failure over extension cleanup failure", async context => {
  const primary = false;
  const secondary = new Error("secondary child extension cleanup failure");
  let cleanups = 0;
  const { shell, observed } = setup(context, { checkpoint(point, command) {
    if (point !== "source-input-read") return;
    command.registerCleanup(() => { cleanups++; throw secondary; });
    throw primary;
  } });
  const outcome = await bounded(shell.exec("value=$(:) | :").then(
    () => ({ rejected: false, reason: undefined as unknown }),
    failure => ({ rejected: true, reason: failure as unknown }),
  ), "pipeline child checkpoint rejection");
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, primary);
  assert.equal(cleanups, 1);
  assert.equal(observed.forks, 2);
  assert.ok(observed.copies.every(copy => observed.closed.has(copy)));
});

test("pipeline descriptor preparation failure finalizes its owner and blocks the prepared peer", async context => {
  const reason = new Error("second pipeline endpoint admission failed");
  const open = PipeDescriptorFrame.prototype.open;
  const references: ReturnType<PipeDescriptorFrame["open"]>[] = [];
  let attempts = 0;
  context.mock.method(PipeDescriptorFrame.prototype, "open", function(this: PipeDescriptorFrame, ...args: Parameters<PipeDescriptorFrame["open"]>) {
    if (++attempts === 2) throw reason;
    const reference = open.apply(this, args);
    references.push(reference);
    return reference;
  });
  const { shell, observed } = setup(context);
  const outcome = await bounded(shell.exec(": | :").then(
    () => ({ rejected: false, reason: undefined as unknown }),
    failure => ({ rejected: true, reason: failure as unknown }),
  ), "descriptor preparation failure drain");
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, reason);
  assert.equal(attempts, 2);
  assert.equal(references.length, 1);
  assert.throws(() => references[0]!.acquire(), { code: "EBADF" });
  assert.deepEqual(observed.callbacks, []);
  assert.equal(observed.childRuns, 0);
  assert.ok(observed.copies.every(copy => observed.closed.has(copy)));
});

type StageCleanupPoint = "input" | "descriptors" | "references";

function stageCleanupFault(context: TestContext, point: StageCleanupPoint | undefined, reason: unknown, options: {
  afterClose?: () => Promise<void>;
  executionFailure?: { reason: unknown };
} = {}) {
  const observed = {
    input: undefined as ShellInput | undefined,
    scope: undefined as InvocationScope | undefined,
    scopeClosing: false,
    closes: { input: 0, descriptors: 0, references: 0 },
    completed: new Set<StageCleanupPoint>(),
    starts: [] as { point: StageCleanupPoint; duringScopeClose: boolean }[],
  };
  const owners = new Map<PipeDescriptorReference, PipeDescriptorFrame>();
  const open = PipeDescriptorFrame.prototype.open;
  context.mock.method(PipeDescriptorFrame.prototype, "open", function(this: PipeDescriptorFrame, ...args: Parameters<PipeDescriptorFrame["open"]>) {
    const reference = open.apply(this, args);
    owners.set(reference, this);
    return reference;
  });
  const closeScope = InvocationScope.prototype.close;
  context.mock.method(InvocationScope.prototype, "close", function(this: InvocationScope) {
    if (this === observed.scope) observed.scopeClosing = true;
    return closeScope.call(this);
  });
  function track(name: StageCleanupPoint, resource: { close(): Promise<void> }) {
    const original = resource.close;
    let closing: Promise<void> | undefined;
    context.mock.method(resource, "close", function() {
      return closing ??= (async () => {
        observed.closes[name]++;
        observed.starts.push({ point: name, duringScopeClose: observed.scopeClosing });
        await original.call(resource);
        observed.completed.add(name);
        if (name === point) {
          await options.afterClose?.();
          throw reason;
        }
      })();
    });
  }
  const run = Runtime.prototype.runCommandIsolated;
  context.mock.method(Runtime.prototype, "runCommandIsolated", function(this: Runtime, ...args: Parameters<Runtime["runCommandIsolated"]>) {
    const io = args[2];
    if (!observed.input && io.terminal) {
      assert.ok(io.stdin instanceof ShellInput);
      observed.input = io.stdin;
      observed.scope = io[invocationScope];
      const reference = io.descriptors?.get(1)?.pipe;
      assert.ok(reference);
      const references = owners.get(reference);
      assert.ok(references);
      track("input", io.stdin);
      track("descriptors", io.terminal.frame);
      track("references", references);
      if (options.executionFailure) return Promise.reject(options.executionFailure.reason);
    }
    return run.apply(this, args);
  });
  return observed;
}

for (const point of ["input", "descriptors", "references"] as const) {
  for (const primary of [undefined, null, false, 0, ""]) test(`started stage keeps checkpoint ${String(primary)} through ${point} close failure`, async context => {
    const secondary = new Error(`secondary stage ${point} close failure`);
    const fault = stageCleanupFault(context, point, secondary);
    let checkpoints = 0;
    let cleanups = 0;
    const { shell, observed } = setup(context, { checkpoint(checkpoint, command) {
      if (checkpoint !== "source-input-read") return;
      checkpoints++;
      assert.equal(command.stdin, fault.input);
      command.registerCleanup(() => { cleanups++; });
      throw primary;
    } });
    const outcome = await bounded(shell.exec("value=$(:) | :").then(
      () => ({ rejected: false, reason: undefined as unknown }),
      reason => ({ rejected: true, reason: reason as unknown }),
    ), "started stage checkpoint cleanup");
    assert.equal(checkpoints, 1);
    assert.equal(cleanups, 1);
    assert.deepEqual(fault.closes, { input: 1, descriptors: 1, references: 1 });
    assert.equal(fault.completed.size, 3);
    assert.ok(observed.copies.every(copy => observed.closed.has(copy)));
    assert.equal(outcome.rejected, true);
    assert.ok(Object.is(outcome.reason, primary));
    assert.ok(fault.starts.every(start => !start.duringScopeClose), JSON.stringify(fault.starts));
  });
}

for (const point of ["input", "descriptors", "references"] as const) test(`started stage without a primary still escapes its ${point} close failure`, async context => {
  const secondary = new Error(`unopposed stage ${point} close failure`);
  const fault = stageCleanupFault(context, point, secondary);
  const { shell } = setup(context);
  const outcome = await bounded(shell.exec(": | :").then(
    () => ({ rejected: false, reason: undefined as unknown }),
    reason => ({ rejected: true, reason: reason as unknown }),
  ), "unopposed stage cleanup failure");
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, secondary);
  assert.deepEqual(fault.closes, { input: 1, descriptors: 1, references: 1 });
  assert.equal(fault.completed.size, 3);
  assert.ok(fault.starts.every(start => !start.duringScopeClose), JSON.stringify(fault.starts));
});

test("started stage ordinary host failure retains existing cleanup-error precedence", async context => {
  const primary = new Error("ordinary stage execution failure");
  const secondary = new Error("ordinary stage input close failure");
  const fault = stageCleanupFault(context, "input", secondary, { executionFailure: { reason: primary } });
  const { shell } = setup(context);
  const outcome = await bounded(shell.exec(": | :").then(
    () => ({ rejected: false, reason: undefined as unknown }),
    reason => ({ rejected: true, reason: reason as unknown }),
  ), "ordinary stage cleanup precedence");
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, secondary);
  assert.deepEqual(fault.closes, { input: 1, descriptors: 1, references: 1 });
  assert.ok(fault.starts.every(start => !start.duringScopeClose), JSON.stringify(fault.starts));
});

test("started stage ordinary guest failure stays a numeric pipeline result", async context => {
  const fault = stageCleanupFault(context, undefined, undefined);
  const { shell } = setup(context);
  const result = await bounded(shell.exec("set -o pipefail; : </missing | :"), "ordinary guest pipeline failure");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /missing/u);
  assert.deepEqual(fault.closes, { input: 1, descriptors: 1, references: 1 });
  assert.ok(fault.starts.every(start => !start.duringScopeClose), JSON.stringify(fault.starts));
});

test("root cancellation during started stage cleanup drains all closes and outranks checkpoint and secondary", async context => {
  const entered = deferred();
  const release = deferred();
  const controller = new AbortController();
  const running: { pending?: Promise<unknown> } = {};
  context.after(async () => { release.resolve(); if (running.pending) await bounded(running.pending, "started stage cancellation drain"); });
  const fault = stageCleanupFault(context, "input", new Error("late input close failure"), { async afterClose() {
    entered.resolve();
    await release.promise;
  } });
  let cleanups = 0;
  const { shell, observed } = setup(context, { checkpoint(point, command) {
    if (point !== "source-input-read") return;
    command.registerCleanup(() => { cleanups++; });
    throw false;
  } });
  let settled = false;
  const pending = shell.exec("value=$(:) | :", { signal: controller.signal }).then(
    () => ({ rejected: false, reason: undefined as unknown }),
    reason => ({ rejected: true, reason: reason as unknown }),
  ).finally(() => { settled = true; });
  running.pending = pending;
  try {
    await bounded(Promise.race([entered.promise, pending.then(() => { throw new Error("stage cleanup was not entered"); })]), "started stage close entry");
    controller.abort(0);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
  } finally { release.resolve(); }
  const outcome = await bounded(pending, "cancelled started stage cleanup");
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, 0);
  assert.equal(cleanups, 1);
  assert.deepEqual(fault.closes, { input: 1, descriptors: 1, references: 1 });
  assert.equal(fault.completed.size, 3);
  assert.ok(observed.copies.every(copy => observed.closed.has(copy)));
});
