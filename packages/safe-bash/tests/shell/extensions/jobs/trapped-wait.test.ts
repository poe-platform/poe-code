import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { Shell } from "../../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { basicCommands } from "../../../../src/commands/basic.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { createJobState } from "../../../../src/shell/extensions/jobs/state.js";
import type { JobState } from "../../../../src/shell/extensions/jobs/state.js";
import { trapExtension } from "../../../../src/shell/extensions/trap/index.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import type { ShellResult } from "../../../../src/shell/types.js";

const signalNames = Object.freeze({ SIGUSR1: 30, SIGUSR2: 31 });

function deferred() {
  let complete!: () => void;
  const promise = new Promise<void>(resolve => { complete = resolve; });
  return { promise, resolve: complete };
}

interface Scenario {
  readonly signal: "USR1" | "USR2";
  readonly disposition: "handled" | "ignored" | "unhandled";
  readonly cancellation?: { readonly reason: unknown };
  readonly cleanupFailure?: { readonly reason: unknown };
  readonly checkpointFailure?: { readonly reason: unknown };
  readonly waitFailure?: { readonly reason: unknown };
  readonly repeated?: boolean;
  readonly dispose?: boolean;
  readonly sourceBudget?: boolean;
  readonly trapExit?: number;
}

async function runWait(context: TestContext, scenario: Scenario): Promise<void> {
  const released = deferred();
  const blocked = deferred();
  const registered = deferred();
  const owner: {
    shell?: Shell;
    probe?: JobState;
    running?: Promise<ShellResult>;
    safety?: ReturnType<typeof setTimeout>;
    interruptionDeadline?: ReturnType<typeof setTimeout>;
  } = {};
  const controller = new AbortController();
  const subscriptions: { deliver(signal: string | number): boolean; closed: number }[] = [];
  const descriptors: { closes: number }[] = [];
  const events: string[] = [];
  let childReturned = false;
  let finished = false;
  let deadlineRelease = false;
  let continuation: { status: number; traps: number; childLive: boolean } | undefined;
  context.after(async () => {
    clearTimeout(owner.safety);
    clearTimeout(owner.interruptionDeadline);
    released.resolve();
    if (!finished) controller.abort(new Error("owned ordinary-wait control cleanup"));
    await owner.running?.catch(() => undefined);
    await owner.shell?.dispose().catch(() => undefined);
    await owner.probe?.close();
  });
  const memory = new MemoryFileSystem();
  await memory.writeFile("/gate", Buffer.from("release\n"));
  const filesystem: FileSystem = new Proxy(memory, { get(target, property) {
    if (property === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
      const descriptor = await target.open(...args);
      const retained = { closes: 0 };
      descriptors.push(retained);
      return new Proxy(descriptor, { get(resource, member) {
        if (member === "close") return async () => {
          retained.closes++;
          await resource.close();
          if (scenario.cleanupFailure) throw scenario.cleanupFailure.reason;
        };
        if (member === "read" && args[0] === "/gate") return async (...operation: Parameters<typeof descriptor.read>) => {
          events.push("child-read-blocked");
          blocked.resolve();
          const signal = operation[2]?.signal;
          let aborted!: () => void;
          try {
            await new Promise<void>((resolve, reject) => {
              aborted = () => { reject(signal?.reason); };
              if (signal?.aborted) aborted();
              else signal?.addEventListener("abort", aborted, { once: true });
              void released.promise.then(resolve);
            });
            signal?.throwIfAborted();
            return await resource.read(...operation);
          } finally { signal?.removeEventListener("abort", aborted); }
        };
        const value: unknown = Reflect.get(resource, member, resource);
        return typeof value === "function" ? value.bind(resource) : value;
      } });
    };
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  owner.probe = createJobState({ maxJobs: 1, maxWaiters: 1 });
  const prototype = Object.getPrototypeOf(owner.probe) as JobState;
  const originalWait = prototype.wait;
  context.mock.method(prototype, "wait", function (this: JobState, targets: Parameters<JobState["wait"]>[0], options: Parameters<JobState["wait"]>[1]) {
    const signal = options?.signal;
    assert(signal instanceof AbortSignal);
    const previous = Object.getOwnPropertyDescriptor(signal, "addEventListener");
    const originalAdd = signal.addEventListener;
    Object.defineProperty(signal, "addEventListener", { configurable: true, value(...[type, listener, settings]: Parameters<AbortSignal["addEventListener"]>) {
      originalAdd.call(signal, type, listener, settings);
      if (type === "abort") { events.push("wait-listener-registered"); registered.resolve(); }
    } });
    try {
      const waiting = originalWait.call(this, targets, options);
      return scenario.waitFailure ? waiting.catch(() => { throw scenario.waitFailure!.reason; }) : waiting;
    }
    finally {
      if (previous) Object.defineProperty(signal, "addEventListener", previous);
      else Reflect.deleteProperty(signal, "addEventListener");
    }
  });
  owner.shell = new Shell({ fs: filesystem, extensions: [jobsExtension(), trapExtension({ signalNames, signalHost: {
    subscribe(deliver) {
      const entry = { deliver, closed: 0 };
      subscriptions.push(entry);
      return () => { entry.closed++; };
    },
  } }), ...(scenario.checkpointFailure ? [{ name: "wait-checkpoint-observer", create: () => ({ builtins: [], checkpoint() { throw scenario.checkpointFailure!.reason; } }) }] : [])] });
  for (const command of basicCommands()) owner.shell.register(command);
  owner.shell.register({ name: "child_read", async execute({ stdin, signal }) {
    for await (const bytes of stdin) { assert(bytes.length > 0); signal.throwIfAborted(); }
    childReturned = true;
    events.push("child-returned-seven");
    return { exitCode: 7 };
  } });
  owner.shell.register({ name: "parent_observe", execute({ args }) {
    continuation = { status: Number(args[0]), traps: Number(args[1]), childLive: !childReturned };
    events.push("parent-continuation");
    clearTimeout(owner.interruptionDeadline);
    released.resolve();
    return { exitCode: 0 };
  } });
  const handler = `trap_status=$?; traps=$((traps + 1)); ${scenario.checkpointFailure ? "value=$(:); " : ""}printf "trap:%s\\n" "$trap_status"${scenario.trapExit === undefined ? "" : `; parent_observe "$trap_status" "$traps"; exit ${scenario.trapExit}`}`;
  const action = scenario.disposition === "handled"
    ? `trap '${handler}' ${scenario.signal}; `
    : scenario.disposition === "ignored" ? `trap '' ${scenario.signal}; ` : "";
  const source = `traps=0; ${action}child_read </gate & child=$!; wait "$child"; first=$?; parent_observe "$first" "$traps"; wait "$child"; printf 'later:%s;traps:%s\\n' "$?" "$traps"`;
  owner.safety = setTimeout(() => {
    controller.abort(new Error("owned ordinary-wait safety deadline"));
    released.resolve();
  }, 1500);
  owner.running = owner.shell.exec(source, { signal: controller.signal, ...(scenario.sourceBudget ? { limits: { maxSourceBytes: Buffer.byteLength(source) + Buffer.byteLength(handler) } } : {}) });
  void owner.running.catch(() => undefined);
  await Promise.race([Promise.all([blocked.promise, registered.promise]), owner.running.then(() => assert.fail("execution ended before actual wait registration"))]);
  assert.equal(childReturned, false);
  assert.equal(subscriptions[0]!.closed, 0);
  events.push("named-signal-delivered");
  assert.equal(subscriptions[0]!.deliver(scenario.signal), scenario.disposition !== "unhandled");
  if (scenario.repeated) assert.equal(subscriptions[0]!.deliver(scenario.signal), true);
  if (scenario.dispose) {
    void owner.shell.dispose().catch(() => undefined);
  } else if (scenario.cancellation) {
    controller.abort(scenario.cancellation.reason);
    released.resolve();
  } else if (scenario.disposition === "handled") {
    owner.interruptionDeadline = setTimeout(() => {
      deadlineRelease = true;
      events.push("bounded-negative-release");
      released.resolve();
    }, 150);
  } else released.resolve();
  const outcome = await owner.running.then(value => ({ kind: "return" as const, value }), reason => ({ kind: "throw" as const, reason: reason as unknown }));
  finished = true;
  clearTimeout(owner.safety);
  clearTimeout(owner.interruptionDeadline);
  await owner.shell.dispose().catch(() => undefined);
  context.diagnostic(JSON.stringify({ scenario: { signal: scenario.signal, disposition: scenario.disposition }, events, deadlineRelease, continuation, outcome, descriptors, subscriptionCloses: subscriptions.map(entry => entry.closed) }));
  assert.ok(descriptors.length > 0);
  assert.ok(descriptors.every(entry => entry.closes === 1));
  assert.ok(subscriptions.every(entry => entry.closed === 1));
  assert.equal(subscriptions[0]!.deliver(scenario.signal), false);
  if (scenario.dispose || scenario.sourceBudget) {
    assert.equal(outcome.kind, "throw");
    if (outcome.kind === "throw") {
      if (scenario.dispose) assert.ok(outcome.reason instanceof Error && outcome.reason.message === "Shell is disposed");
      else assert.ok(outcome.reason instanceof ShellLimitError && outcome.reason.limit === "maxSourceBytes");
    }
    assert.equal(continuation, undefined);
    return;
  }
  if (scenario.cancellation || scenario.cleanupFailure || scenario.checkpointFailure || scenario.waitFailure) {
    assert.equal(outcome.kind, "throw");
    if (outcome.kind === "throw") assert.equal(outcome.reason, scenario.cancellation ? controller.signal.reason : scenario.waitFailure ? scenario.waitFailure.reason : scenario.checkpointFailure ? scenario.checkpointFailure.reason : scenario.cleanupFailure!.reason);
    if (scenario.cancellation || scenario.checkpointFailure || scenario.waitFailure?.reason instanceof ShellLimitError) assert.equal(continuation, undefined);
    else if (scenario.waitFailure) assert.deepEqual(continuation, { status: 1, traps: 1, childLive: true });
    return;
  }
  assert.equal(outcome.kind, "return");
  if (outcome.kind !== "return") return;
  assert.equal(outcome.value.exitCode, scenario.trapExit ?? 0, outcome.value.stderr);
  assert.equal(outcome.value.stderr, "");
  const expectedStatus = scenario.disposition === "handled" ? 128 + signalNames[`SIG${scenario.signal}`] : 7;
  assert.equal(continuation?.status, expectedStatus, "trapped ordinary wait must return before child release, without consuming its status");
  assert.equal(continuation?.traps, scenario.disposition === "handled" ? 1 : 0);
  assert.equal(continuation?.childLive, scenario.disposition === "handled");
  assert.equal(deadlineRelease, false);
  assert.equal(outcome.value.stdout, scenario.trapExit !== undefined ? `trap:${expectedStatus}\n` : scenario.disposition === "handled" ? `trap:${expectedStatus}\nlater:7;traps:1\n` : "later:7;traps:0\n");
}

for (const scenario of [
  { signal: "USR1", disposition: "handled" },
  { signal: "USR2", disposition: "handled" },
  { signal: "USR1", disposition: "ignored" },
  { signal: "USR1", disposition: "unhandled" },
] as const) test(`ordinary wait ${scenario.disposition} ${scenario.signal} preserves child ownership`, { timeout: 3000 }, context => runWait(context, scenario));

for (const reason of [undefined, null, false, 0, ""]) {
  test(`ordinary wait root cancellation wins over trapped interruption: ${String(reason)}`, { timeout: 3000 }, context =>
    runWait(context, { signal: "USR1", disposition: "handled", cancellation: { reason }, cleanupFailure: { reason: new Error("secondary close") } }));
  test(`ordinary wait retains exact child cleanup failure after trapped interruption: ${String(reason)}`, { timeout: 3000 }, context =>
    runWait(context, { signal: "USR1", disposition: "handled", cleanupFailure: { reason } }));
  test(`ordinary wait retains exact trap checkpoint failure: ${String(reason)}`, { timeout: 3000 }, context =>
    runWait(context, { signal: "USR1", disposition: "handled", checkpointFailure: { reason }, cleanupFailure: { reason: new Error("secondary close") } }));
  test(`ordinary wait retains an escaping wait failure instead of selecting interruption: ${String(reason)}`, { timeout: 3000 }, context =>
    runWait(context, { signal: "USR1", disposition: "handled", waitFailure: { reason }, cleanupFailure: { reason: new Error("secondary close") } }));
}

test("ordinary wait disposal drains the live child without treating interruption as completion", { timeout: 3000 }, context =>
  runWait(context, { signal: "USR1", disposition: "handled", dispose: true }));

test("ordinary wait trap evaluation retains the shared source budget", { timeout: 3000 }, context =>
  runWait(context, { signal: "USR1", disposition: "handled", sourceBudget: true }));

test("ordinary wait trap exit remains shell control flow, not a wait failure", { timeout: 3000 }, context =>
  runWait(context, { signal: "USR1", disposition: "handled", trapExit: 23 }));

test("ordinary wait coalesces repeated pending delivery into one trap", { timeout: 3000 }, context =>
  runWait(context, { signal: "USR1", disposition: "handled", repeated: true }));

test("ordinary wait retains fatal limit failure without parent continuation", { timeout: 3000 }, context =>
  runWait(context, { signal: "USR1", disposition: "handled", waitFailure: { reason: new ShellLimitError("maxCommands") }, cleanupFailure: { reason: false } }));
