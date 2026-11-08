import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { Shell } from "../../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { basicCommands } from "../../../../src/commands/basic.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { createJobState } from "../../../../src/shell/extensions/jobs/state.js";
import type { JobState } from "../../../../src/shell/extensions/jobs/state.js";
import { trapExtension } from "../../../../src/shell/extensions/trap/index.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import type { ShellExtension } from "../../../../src/shell/extensions.js";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

interface Form {
  readonly id: string;
  readonly wait: string;
  readonly next?: boolean;
  readonly destination?: boolean;
  readonly second?: boolean;
  readonly negate?: boolean;
  readonly laterOperand?: boolean;
  readonly race?: "completion-first" | "interruption-first";
}

interface Scenario {
  readonly cancellation?: { readonly reason: unknown };
  readonly cleanupFailure?: { readonly reason: unknown };
  readonly referenceFailure?: { readonly reason: unknown };
  readonly waitFailure?: { readonly reason: unknown };
  readonly checkpointFailure?: { readonly reason: unknown };
  readonly disposition?: "ignored" | "unhandled";
  readonly dispose?: boolean;
  readonly sourceBudget?: boolean;
}

const forms: readonly Form[] = [
  { id: "ordinary", wait: 'wait "$child"' },
  { id: "all", wait: "wait" },
  { id: "specific-p", wait: 'wait -p chosen "$child"', destination: true },
  { id: "all-p", wait: "wait -p chosen", destination: true },
  { id: "duplicate", wait: 'wait "$child" "$child"' },
  { id: "multiple", wait: 'wait "$other" "$child"', second: true },
  { id: "multiple-p", wait: 'wait -p chosen "$other" "$child"', second: true, destination: true },
  { id: "next", wait: "wait -n", next: true },
  { id: "next-target", wait: 'wait -n "$child"', next: true },
  { id: "next-p", wait: "wait -n -p chosen", next: true, destination: true },
  { id: "next-target-p", wait: 'wait -n -p chosen "$child"', next: true, destination: true },
  { id: "next-multiple-p", wait: 'wait -n -p chosen "$other" "$child"', second: true, next: true, destination: true },
  { id: "negated-ordinary", wait: '! wait "$child"', negate: true },
  { id: "negated-all", wait: "! wait", negate: true },
  { id: "negated-specific-p", wait: '! wait -p chosen "$child"', negate: true, destination: true },
  { id: "negated-next-p", wait: '! wait -n -p chosen "$child"', negate: true, next: true, destination: true },
  { id: "all-multiple", wait: "wait", second: true },
  { id: "clustered-next-p", wait: 'wait -fnpchosen "$child"', next: true, destination: true },
  { id: "repeated-next-p", wait: 'wait -p ignored -n -p chosen "$child"', next: true, destination: true },
];
const nextDestination: Form = { id: "next-target-p", wait: 'wait -n -p chosen "$child"', next: true, destination: true };

async function runWait(context: TestContext, form: Form, scenario: Scenario = {}) {
  const gate = deferred();
  const blocked = deferred();
  const admitted = deferred();
  const controller = new AbortController();
  const owner: {
    shell?: Shell;
    probe?: JobState;
    running?: ReturnType<Shell["exec"]>;
    negativeTimer?: ReturnType<typeof setTimeout>;
    safety?: ReturnType<typeof setTimeout>;
  } = {};
  let finished = false;
  context.after(async () => {
    clearTimeout(owner.negativeTimer);
    clearTimeout(owner.safety);
    gate.resolve();
    if (!finished) controller.abort(new Error("owned wait-combination cleanup"));
    await owner.running?.catch(() => undefined);
    await owner.shell?.dispose().catch(() => undefined);
    await owner.probe?.close();
  });
  const descriptors: { closed: number }[] = [];
  const subscriptions: { deliver(signal: string | number): boolean; closed: number }[] = [];
  const events: string[] = [];
  const references = { assigned: 0, closed: 0 };
  let returned = 0;
  let continuation: { status: number; traps: number; trapStatus: number; chosen: string; live: number; child: string } | undefined;
  let deadlineRelease = false;
  let delivered = false;
  const expectedChildren = form.second ? 2 : 1;
  const memory = new MemoryFileSystem();
  await memory.writeFile("/gate", Buffer.from("release\n"));
  const filesystem: FileSystem = new Proxy(memory, { get(target, member) {
    if (member === "open") return async (...args: Parameters<MemoryFileSystem["open"]>) => {
      const resource = await target.open(...args);
      const record = { closed: 0 };
      descriptors.push(record);
      return new Proxy(resource, { get(descriptor, key) {
        if (key === "close") return async () => {
          record.closed++;
          await descriptor.close();
          if (scenario.cleanupFailure) throw scenario.cleanupFailure.reason;
        };
        if (key === "read" && args[0] === "/gate") return async (...operation: Parameters<typeof descriptor.read>) => {
          events.push("child-read");
          blocked.resolve();
          const signal = operation[2]?.signal;
          let abort!: () => void;
          try {
            await new Promise<void>((resolve, reject) => {
              abort = () => { reject(signal?.reason); };
              if (signal?.aborted) abort();
              else signal?.addEventListener("abort", abort, { once: true });
              void gate.promise.then(resolve);
            });
            signal?.throwIfAborted();
            return await descriptor.read(...operation);
          } finally { signal?.removeEventListener("abort", abort); }
        };
        const value: unknown = Reflect.get(descriptor, key, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value: unknown = Reflect.get(target, member, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const deliver = () => {
    assert.equal(delivered, false);
    delivered = true;
    events.push("delivered");
    assert.equal(subscriptions[0]!.deliver("USR1"), scenario.disposition !== "unhandled");
  };
  owner.probe = createJobState({ maxJobs: 1, maxWaiters: 1 });
  const prototype = Object.getPrototypeOf(owner.probe) as JobState;
  for (const method of ["wait", "waitNext"] as const) {
    const original = prototype[method];
    context.mock.method(prototype, method, function (this: JobState, targets: Parameters<JobState["wait"]>[0], options: Parameters<JobState["wait"]>[1]) {
      const signal = options?.signal;
      assert(signal instanceof AbortSignal);
      const observed = method === (form.next ? "waitNext" : "wait") && (!form.laterOperand || returned === 1 && (targets === undefined || targets.some(target => "handle" in target && target.handle.jobId === 2)));
      const previous = Object.getOwnPropertyDescriptor(signal, "addEventListener");
      const originalAdd = signal.addEventListener;
      Object.defineProperty(signal, "addEventListener", { configurable: true, value(...[type, listener, settings]: Parameters<AbortSignal["addEventListener"]>) {
        originalAdd.call(signal, type, listener, settings);
        if (type === "abort" && observed) { events.push(method + "-admitted"); admitted.resolve(); }
      } });
      try {
        const waiting = original.call(this, targets, options);
        if (!observed) return waiting;
        if (scenario.waitFailure) return waiting.catch(() => { throw scenario.waitFailure!.reason; });
        if (form.race === "completion-first" && !delivered) return waiting.then(result => { deliver(); return result; });
        return waiting;
      } finally {
        if (previous) Object.defineProperty(signal, "addEventListener", previous);
        else Reflect.deleteProperty(signal, "addEventListener");
      }
    });
  }
  const definition = jobsExtension();
  const jobs: ShellExtension = { ...definition, create() {
    const instance = definition.create();
    return { ...instance, builtins: instance.builtins.map(builtin => ({ ...builtin, execute(command) {
      const bindings = command.bindings;
      return builtin.execute.call(builtin, { ...command, bindings: { ...bindings, async prepareReference(value) {
        const result = await bindings.prepareReference(value);
        if (!result.ok) return result;
        return { ok: true, value: { ...result.value,
          async assignInteger(value) { references.assigned++; return result.value.assignInteger(value); },
          async close() {
            references.closed++;
            await result.value.close();
            if (scenario.referenceFailure) throw scenario.referenceFailure.reason;
          },
        } };
      } } });
    } })) };
  } };
  owner.shell = new Shell({ fs: filesystem, extensions: [jobs, trapExtension({ signalNames: { SIGUSR1: 30 }, signalHost: {
    subscribe(deliver) {
      const entry = { deliver, closed: 0 };
      subscriptions.push(entry);
      return () => { entry.closed++; };
    },
  } }), ...(scenario.checkpointFailure ? [{ name: "wait-combination-observer", create: () => ({ builtins: [], checkpoint() { throw scenario.checkpointFailure!.reason; } }) }] : [])] });
  for (const command of basicCommands()) owner.shell.register(command);
  owner.shell.register({ name: "child_read", async execute({ stdin, signal }) {
    for await (const chunk of stdin) { assert(chunk.length > 0); signal.throwIfAborted(); }
    returned++;
    events.push("child-return7");
    return { exitCode: 7 };
  } });
  owner.shell.register({ name: "child_done", execute() { returned++; events.push("first-child-return7"); return { exitCode: 7 }; } });
  owner.shell.register({ name: "parent_observe", execute({ args }) {
    continuation = { status: Number(args[0]), traps: Number(args[1]), trapStatus: Number(args[2]), chosen: args[3]!, live: expectedChildren - returned, child: args[4]! };
    events.push("continuation");
    clearTimeout(owner.negativeTimer);
    gate.resolve();
    return { exitCode: 0 };
  } });
  const handler = `trap_status=$?; traps=$((traps + 1))${scenario.checkpointFailure ? "; value=$(:)" : ""}`;
  const action = scenario.disposition === "unhandled" ? "" : `trap '${scenario.disposition === "ignored" ? "" : handler}' USR1; `;
  const source = `traps=0; chosen=old; trap_status=99; ${action}${form.laterOperand ? "child_done" : "child_read </gate"} & child=$!; ${form.second ? "child_read </gate & other=$!; " : ""}${form.wait}; first=$?; parent_observe "$first" "$traps" "$trap_status" "\${chosen-unset}" "$child"; wait "$child"; printf 'later:%s;traps:%s\n' "$?" "$traps"${form.second ? '; wait "$other"; printf "other:%s\\n" "$?"' : ""}`;
  owner.safety = setTimeout(() => { controller.abort(new Error("owned wait-combination safety")); gate.resolve(); }, 1700);
  owner.running = owner.shell.exec(source, { signal: controller.signal, ...(scenario.sourceBudget ? { limits: { maxSourceBytes: Buffer.byteLength(source) + Buffer.byteLength(handler) } } : {}) });
  void owner.running.catch(() => undefined);
  await Promise.race([Promise.all([blocked.promise, admitted.promise]), owner.running.then(() => assert.fail("ended before actual wait admission"))]);
  assert.equal(returned, form.laterOperand ? 1 : 0);
  if (form.race === "completion-first") gate.resolve();
  else {
    deliver();
    if (scenario.cancellation) { controller.abort(scenario.cancellation.reason); gate.resolve(); }
    else if (scenario.dispose) void owner.shell.dispose().catch(() => undefined);
    else if (scenario.disposition || form.race === "interruption-first") gate.resolve();
    else owner.negativeTimer = setTimeout(() => { deadlineRelease = true; events.push("negative-release"); gate.resolve(); }, 150);
  }
  const outcome = await owner.running.then(value => ({ kind: "return" as const, value }), reason => ({ kind: "throw" as const, reason: reason as unknown }));
  finished = true;
  clearTimeout(owner.negativeTimer);
  clearTimeout(owner.safety);
  await owner.shell.dispose().catch(() => undefined);
  context.diagnostic(JSON.stringify({ id: form.id, events, continuation, deadlineRelease, outcome, references, descriptors, subscriptionCloses: subscriptions.map(entry => entry.closed) }));
  assert.equal(descriptors.length, expectedChildren - Number(Boolean(form.laterOperand)));
  assert.ok(descriptors.every(entry => entry.closed === 1));
  assert.ok(subscriptions.every(entry => entry.closed === 1));
  assert.equal(subscriptions[0]!.deliver("USR1"), false);
  assert.equal(references.closed, form.destination ? 1 : 0);
  assert.equal(deadlineRelease, false, "handled signal must interrupt before bounded negative release");
  if (scenario.cancellation || scenario.waitFailure || scenario.checkpointFailure || scenario.referenceFailure || scenario.cleanupFailure) {
    assert.equal(outcome.kind, "throw");
    const primary = scenario.cancellation ? controller.signal.reason : scenario.waitFailure ? scenario.waitFailure.reason : scenario.checkpointFailure ? scenario.checkpointFailure.reason : scenario.referenceFailure ? scenario.referenceFailure.reason : scenario.cleanupFailure!.reason;
    if (outcome.kind === "throw") assert.equal(outcome.reason, primary);
    assert.equal(references.assigned, 0);
    if (scenario.cancellation || scenario.checkpointFailure || scenario.waitFailure?.reason instanceof ShellLimitError) assert.equal(continuation, undefined);
    return;
  }
  if (scenario.dispose || scenario.sourceBudget) {
    assert.equal(outcome.kind, "throw");
    if (outcome.kind === "throw") assert.ok(scenario.dispose ? outcome.reason instanceof Error && outcome.reason.message === "Shell is disposed" : outcome.reason instanceof ShellLimitError && outcome.reason.limit === "maxSourceBytes");
    assert.equal(continuation, undefined);
    assert.equal(references.assigned, 0);
    return;
  }
  assert.equal(outcome.kind, "return");
  if (outcome.kind !== "return") return;
  const completed = Boolean(scenario.disposition) || form.race === "completion-first";
  const status = form.negate ? 0 : completed ? 7 : 158;
  assert.equal(outcome.value.exitCode, 0);
  assert.equal(outcome.value.stderr, "");
  assert.equal(continuation?.status, status);
  assert.equal(continuation?.traps, scenario.disposition ? 0 : 1);
  assert.equal(continuation?.trapStatus, scenario.disposition ? 99 : status);
  assert.equal(continuation?.chosen, form.destination ? completed ? continuation.child : "unset" : "old");
  if (form.race !== "interruption-first") assert.equal(continuation?.live, completed ? 0 : expectedChildren - Number(Boolean(form.laterOperand)));
  assert.equal(references.assigned, form.destination && completed ? 1 : 0);
  assert.equal(outcome.value.stdout, `later:7;traps:${scenario.disposition ? 0 : 1}\n${form.second ? "other:7\n" : ""}`);
}

for (const form of forms) test(`trapped wait combination: ${form.id}`, { timeout: 3000 }, context => runWait(context, form));

for (const reason of [undefined, null, false, 0, ""]) {
  test(`wait-next root cancellation wins: ${String(reason)}`, { timeout: 3000 }, context => runWait(context, nextDestination, { cancellation: { reason }, referenceFailure: { reason: new Error("secondary reference") }, cleanupFailure: { reason: new Error("secondary descriptor") } }));
  test(`wait-next reference cleanup exactness: ${String(reason)}`, { timeout: 3000 }, context => runWait(context, nextDestination, { referenceFailure: { reason }, cleanupFailure: { reason: new Error("secondary descriptor") } }));
  test(`wait-next child cleanup exactness: ${String(reason)}`, { timeout: 3000 }, context => runWait(context, nextDestination, { cleanupFailure: { reason } }));
  test(`wait-next escaping failure precedes reference cleanup: ${String(reason)}`, { timeout: 3000 }, context => runWait(context, nextDestination, { waitFailure: { reason }, referenceFailure: { reason: new Error("secondary reference") }, cleanupFailure: { reason: new Error("secondary descriptor") } }));
  test(`wait-next trap checkpoint failure exactness: ${String(reason)}`, { timeout: 3000 }, context => runWait(context, nextDestination, { checkpointFailure: { reason }, cleanupFailure: { reason: new Error("secondary descriptor") } }));
}
for (const race of ["completion-first", "interruption-first"] as const) test(`wait-next deterministic ${race} preserves selected outcome`, { timeout: 3000 }, context => runWait(context, { ...nextDestination, id: race, race }));
for (const negate of [false, true]) test(`ordinary wait interrupts later operand without publishing earlier PID: negated=${negate}`, { timeout: 3000 }, context => runWait(context, { id: "later-operand", wait: `${negate ? "! " : ""}wait -p chosen "$child" "$other"`, second: true, destination: true, laterOperand: true, negate }));
test("bare wait interrupts after an earlier child completed", { timeout: 3000 }, context => runWait(context, { id: "later-bare", wait: "wait", second: true, laterOperand: true }));
for (const disposition of ["ignored", "unhandled"] as const) test(`wait-next ${disposition} signal preserves normal completion`, { timeout: 3000 }, context => runWait(context, nextDestination, { disposition }));
test("wait-next disposal drains live child and destination", { timeout: 3000 }, context => runWait(context, nextDestination, { dispose: true }));
test("wait-next trap evaluation preserves shared source budget", { timeout: 3000 }, context => runWait(context, nextDestination, { sourceBudget: true }));
