import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { shellValueText } from "../../../../src/contracts/value.js";
import { basicCommands } from "../../../../src/commands/basic.js";
import { Shell } from "../../../../src/shell/shell.js";
import type { ShellExtension } from "../../../../src/shell/extensions.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { createJobState } from "../../../../src/shell/extensions/jobs/state.js";
import type { JobState } from "../../../../src/shell/extensions/jobs/state.js";
import { trapExtension } from "../../../../src/shell/extensions/trap/index.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

interface Scenario {
  readonly next?: boolean;
  readonly destination?: "indexed" | "readonly-indexed" | "readonly-scalar" | "readonly-array";
  readonly ignored?: boolean;
  readonly transition?: boolean;
  readonly secondComplete?: boolean;
  readonly negate?: boolean;
  readonly repeated?: boolean;
  readonly action?: "replace" | "ignore" | "remove";
  readonly cancellation?: { readonly reason: unknown };
}

async function control(context: TestContext, scenario: Scenario) {
  const gate = deferred();
  const blocked = deferred();
  const admitted = deferred();
  const controller = new AbortController();
  const owner: { shell?: Shell; probe?: JobState; activeJobs?: JobState; running?: ReturnType<Shell["exec"]>; timer?: ReturnType<typeof setTimeout>; safety?: ReturnType<typeof setTimeout> } = {};
  let finished = false;
  context.after(async () => {
    clearTimeout(owner.timer);
    clearTimeout(owner.safety);
    gate.resolve();
    if (!finished) controller.abort(new Error("destination-transition cleanup"));
    await owner.running?.catch(() => undefined);
    await owner.shell?.dispose().catch(() => undefined);
    await owner.probe?.close();
  });
  const subscriptions: { deliver(signal: string): boolean; closes: number }[] = [];
  const descriptors: { closes: number }[] = [];
  const events: string[] = [];
  const references = { unbound: 0, assigned: 0, closed: 0 };
  const observations: { status: number; traps: number; trapStatus: number; labels: string; live: number; kind: string; readonly: boolean; left?: string; right?: string }[] = [];
  let returned = 0;
  let phase = 0;
  let deliveries = 0;
  let negativeRelease = false;
  const earlyReadonly = scenario.destination === "readonly-scalar" || scenario.destination === "readonly-array";
  const totalChildren = scenario.transition ? 2 : 1;
  const memory = new MemoryFileSystem();
  await memory.writeFile("/gate", Buffer.from("release\n"));
  const fs: FileSystem = new Proxy(memory, { get(target, member) {
    if (member === "open") return async (...args: Parameters<MemoryFileSystem["open"]>) => {
      const descriptor = await target.open(...args);
      const record = { closes: 0 };
      descriptors.push(record);
      return new Proxy(descriptor, { get(resource, property) {
        if (property === "close") return async () => { record.closes++; await resource.close(); };
        if (property === "read" && args[0] === "/gate") return async (...operation: Parameters<typeof descriptor.read>) => {
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
            return await resource.read(...operation);
          } finally { signal?.removeEventListener("abort", abort); }
        };
        const value: unknown = Reflect.get(resource, property, resource);
        return typeof value === "function" ? value.bind(resource) : value;
      } });
    };
    const value: unknown = Reflect.get(target, member, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const deliver = (expected = true) => {
    deliveries++;
    events.push(`deliver:${phase}`);
    assert.equal(subscriptions[0]!.deliver("USR1"), expected);
    if (scenario.repeated && phase === 0) assert.equal(subscriptions[0]!.deliver("USR1"), true);
    if (scenario.cancellation) { controller.abort(scenario.cancellation.reason); gate.resolve(); }
    else if (scenario.ignored || phase === 1 && scenario.action !== "replace") gate.resolve();
    else owner.timer = setTimeout(() => { negativeRelease = true; gate.resolve(); }, 150);
  };
  owner.probe = createJobState({ maxJobs: 1, maxWaiters: 1 });
  const prototype = Object.getPrototypeOf(owner.probe) as JobState;
  const originalStart = prototype.start;
  context.mock.method(prototype, "start", function (this: JobState, ...args: Parameters<JobState["start"]>) {
    owner.activeJobs ??= this;
    return originalStart.apply(this, args);
  });
  for (const method of ["wait", "waitNext"] as const) {
    const original = prototype[method];
    context.mock.method(prototype, method, function (this: JobState, targets: Parameters<JobState["wait"]>[0], options: Parameters<JobState["wait"]>[1]) {
      const signal = options?.signal;
      assert(signal instanceof AbortSignal);
      const previous = Object.getOwnPropertyDescriptor(signal, "addEventListener");
      const originalAdd = signal.addEventListener;
      Object.defineProperty(signal, "addEventListener", { configurable: true, value(...[type, listener, settings]: Parameters<AbortSignal["addEventListener"]>) {
        originalAdd.call(signal, type, listener, settings);
        if (type === "abort") {
          events.push(`admitted:${method}:${phase}`);
          admitted.resolve();
          if (phase === 1 && scenario.action && deliveries === 1) queueMicrotask(() => { deliver(scenario.action !== "remove"); });
        }
      } });
      try {
        const waiting = original.call(this, targets, options);
        if (scenario.transition && phase === 0 && deliveries === 0 && targets?.some(target => "handle" in target && target.handle.jobId === 1)) {
          return waiting.then(result => {
            assert.deepEqual(result.outcome, { kind: "status", status: 7 });
            events.push("first-operand-completed");
            deliver();
            return result;
          });
        }
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
          async unbindName() {
            references.unbound++;
            const unbound = await result.value.unbindName();
            if (earlyReadonly && phase === 0 && deliveries === 0) {
              assert.equal(unbound.ok, false);
              deliver();
            }
            return unbound;
          },
          async assignInteger(value) { references.assigned++; return result.value.assignInteger(value); },
          async close() { references.closed++; await result.value.close(); },
        } };
      } } });
    } })) };
  } };
  const observer: ShellExtension = { name: "wait-destination-observer", create: () => ({ builtins: [{ name: "observe_wait", execute(command) {
    const binding = command.bindings.describe("values");
    const left = command.bindings.get("values", 0);
    const right = command.bindings.get("values", 1);
    observations.push({ status: Number(command.args[0]), traps: Number(command.args[1]), trapStatus: Number(command.args[2]), labels: command.args[3]!, live: totalChildren - returned, kind: binding.kind, readonly: binding.readonly,
      ...(left === undefined ? {} : { left: shellValueText(left) }), ...(right === undefined ? {} : { right: shellValueText(right) }),
    });
    clearTimeout(owner.timer);
    phase++;
    if (!scenario.action || phase === 2) gate.resolve();
    return 0;
  } }] }) };
  owner.shell = new Shell({ fs, extensions: [arraysExtension(), jobs, observer, trapExtension({ signalNames: { SIGUSR1: 30 }, signalHost: {
    subscribe(deliver) { const entry = { deliver, closes: 0 }; subscriptions.push(entry); return () => { entry.closes++; }; },
  } })] });
  for (const command of basicCommands()) owner.shell.register(command);
  owner.shell.register({ name: "child", async execute({ stdin, signal, args }) {
    for await (const chunk of stdin) { assert(chunk.length > 0); signal.throwIfAborted(); }
    returned++;
    return { exitCode: Number(args[0]) };
  } });
  owner.shell.register({ name: "settle_children", async execute() {
    const { activeJobs } = owner;
    assert(activeJobs);
    await Promise.all(activeJobs.snapshot().map(entry => entry.handle.completion));
    return { exitCode: 0 };
  } });
  let handler = 'trap_status=$?; traps=$((traps + 1)); labels="${labels}A"';
  if (scenario.action === "replace") handler += '; trap "trap_status=\\$?; traps=\\$((traps + 1)); labels=\\${labels}B" USR1';
  if (scenario.action === "ignore") handler += '; trap "" USR1';
  if (scenario.action === "remove") handler += '; trap - USR1';
  const initial = scenario.destination === "readonly-scalar" ? "readonly values=old" : `${scenario.destination?.startsWith("readonly") ? "readonly -a " : ""}values=(left right)`;
  const destination = scenario.destination ? earlyReadonly ? "values" : "values[1]" : "chosen";
  const operands = scenario.transition ? '"$first" "$second"' : '"$first"';
  const source = `traps=0; trap_status=99; labels=; ${initial}; trap '${scenario.ignored ? "" : handler}' USR1; child 7 ${scenario.transition ? "</empty" : "</gate"} & first=$!; ${scenario.transition ? `child 9 ${scenario.secondComplete ? "</empty" : "</gate"} & second=$!; ` : ""}${scenario.secondComplete ? "settle_children; " : ""}${scenario.negate ? "! " : ""}wait ${scenario.next ? "-n " : ""}-p '${destination}' ${operands}; status=$?; observe_wait "$status" "$traps" "$trap_status" "$labels"; ${scenario.action ? 'wait "$second"; status=$?; observe_wait "$status" "$traps" "$trap_status" "$labels"; ' : ""}wait "$first"; printf 'first:%s\\n' "$?"${scenario.transition ? '; wait "$second"; printf "second:%s\\n" "$?"' : ""}`;
  await memory.writeFile("/empty", new Uint8Array());
  owner.safety = setTimeout(() => { controller.abort(new Error("destination-transition safety")); gate.resolve(); }, 1700);
  owner.running = owner.shell.exec(source, { signal: controller.signal });
  void owner.running.catch(() => undefined);
  if (!scenario.transition && !earlyReadonly) {
    await Promise.race([Promise.all([blocked.promise, admitted.promise]), owner.running.then(() => assert.fail("ended before admitted destination wait"))]);
    deliver();
  }
  const outcome = await owner.running.then(value => ({ kind: "return" as const, value }), reason => ({ kind: "throw" as const, reason: reason as unknown }));
  finished = true;
  clearTimeout(owner.timer);
  clearTimeout(owner.safety);
  await owner.shell.dispose().catch(() => undefined);
  context.diagnostic(JSON.stringify({ scenario, events, observations, references, negativeRelease, deliveries, outcome, descriptors, subscriptionCloses: subscriptions.map(entry => entry.closes) }));
  assert.ok(descriptors.length > 0);
  assert.ok(descriptors.every(entry => entry.closes === 1));
  assert.ok(subscriptions.every(entry => entry.closes === 1));
  assert.equal(subscriptions[0]!.deliver("USR1"), false);
  assert.equal(references.closed, 1);
  assert.equal(references.unbound, 1);
  assert.equal(negativeRelease, false);
  if (scenario.cancellation) {
    assert.equal(outcome.kind, "throw");
    if (outcome.kind === "throw") assert.equal(outcome.reason, controller.signal.reason);
    assert.equal(observations.length, 0);
    return;
  }
  assert.equal(outcome.kind, "return");
  if (outcome.kind !== "return") return;
  assert.equal(outcome.value.exitCode, 0);
  const rejected = earlyReadonly || scenario.ignored && scenario.destination === "readonly-indexed";
  assert.equal(outcome.value.stderr.includes("readonly variable"), Boolean(rejected));
  if (!rejected) assert.equal(outcome.value.stderr, "");
  assert.equal(observations.length, scenario.action ? 2 : 1);
  const first = observations[0]!;
  const status = scenario.negate ? 0 : rejected ? 1 : scenario.ignored ? 7 : 158;
  assert.equal(first.status, status);
  assert.equal(first.traps, scenario.ignored ? 0 : 1);
  assert.equal(first.trapStatus, scenario.ignored ? 99 : status);
  assert.equal(first.labels, scenario.ignored ? "" : "A");
  if (earlyReadonly) assert.equal(events.some(event => event.startsWith("admitted:") && event.endsWith(":0")), false);
  assert.equal(first.live, scenario.ignored || scenario.secondComplete ? 0 : 1);
  assert.equal(first.kind, scenario.destination === "readonly-scalar" ? "scalar" : "indexed");
  assert.equal(first.readonly, Boolean(scenario.destination?.startsWith("readonly")));
  assert.equal(first.left, scenario.destination === "readonly-scalar" ? "old" : "left");
  if (scenario.destination === "readonly-scalar") assert.equal(first.right, undefined);
  else if (scenario.ignored && scenario.destination === "indexed") assert.ok(Number(first.right) > 0);
  else assert.equal(first.right, "right");
  assert.equal(references.assigned, scenario.ignored && !earlyReadonly ? 1 : 0);
  if (scenario.action) {
    const second = observations[1]!;
    assert.equal(second.status, scenario.action === "replace" ? 158 : 9);
    assert.equal(second.traps, scenario.action === "replace" ? 2 : 1);
    assert.equal(second.labels, scenario.action === "replace" ? "AB" : "A");
    assert.equal(second.trapStatus, 158);
    assert.equal(second.live, scenario.action === "replace" ? 1 : 0);
  }
  assert.equal(deliveries, scenario.action ? 2 : 1);
  assert.equal(outcome.value.stdout, `first:7\n${scenario.transition ? "second:9\n" : ""}`);
}

for (const destination of ["indexed", "readonly-indexed", "readonly-scalar", "readonly-array"] as const) for (const next of [false, true]) {
  test(`handled signal with ${next ? "next" : "ordinary"} ${destination} destination`, { timeout: 3000 }, context => control(context, { destination, next }));
}
for (const destination of ["indexed", "readonly-indexed"] as const) for (const next of [false, true]) {
  test(`ignored signal retains ${next ? "next" : "ordinary"} ${destination} completion`, { timeout: 3000 }, context => control(context, { destination, next, ignored: true }));
}
test("pending signal after first completed operand interrupts before next pending operand", { timeout: 3000 }, context => control(context, { transition: true }));
test("negation retains pending signal between completed operands", { timeout: 3000 }, context => control(context, { transition: true, negate: true }));
test("pending signal between two completed operands retains interrupted selection", { timeout: 3000 }, context => control(context, { transition: true, secondComplete: true }));
test("repeated pending signal between operands runs one action", { timeout: 3000 }, context => control(context, { transition: true, repeated: true }));
for (const action of ["replace", "ignore", "remove"] as const) test(`pending action ${action} governs subsequent wait admission`, { timeout: 3000 }, context => control(context, { transition: true, action }));
for (const reason of [undefined, null, false, 0, ""]) test(`root cancellation beats between-operand interruption: ${String(reason)}`, { timeout: 3000 }, context => control(context, { transition: true, cancellation: { reason } }));
