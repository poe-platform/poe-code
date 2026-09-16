import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { Shell } from "../../../../src/shell/shell.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { FileSystem } from "../../../../src/contracts/filesystem.js";
import { basicCommands } from "../../../../src/commands/basic.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { createJobState } from "../../../../src/shell/extensions/jobs/state.js";
import type { JobState } from "../../../../src/shell/extensions/jobs/state.js";
import { trapExtension } from "../../../../src/shell/extensions/trap/index.js";
import type { ShellExtension } from "../../../../src/shell/extensions.js";
import { ShellLimitError } from "../../../../src/shell/types.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

interface Scenario {
  readonly kind: "mixed" | "nested";
  readonly reverse?: boolean;
  readonly next?: boolean;
  readonly ignored?: boolean;
  readonly cancel?: boolean;
}

async function control(context: TestContext, scenario: Scenario) {
  const firstGate = deferred(), secondGate = deferred();
  const firstBlocked = deferred(), secondBlocked = deferred();
  const firstAdmitted = deferred(), secondAdmitted = deferred();
  const controller = new AbortController();
  const owner: { shell?: Shell; probe?: JobState; running?: ReturnType<Shell["exec"]>; safety?: ReturnType<typeof setTimeout>; negative?: ReturnType<typeof setTimeout> } = {};
  let finished = false;
  context.after(async () => {
    clearTimeout(owner.safety);
    clearTimeout(owner.negative);
    firstGate.resolve(); secondGate.resolve();
    if (!finished) controller.abort(new Error("owned pending/nested cleanup"));
    await owner.running?.catch(() => undefined);
    await owner.shell?.dispose().catch(() => undefined);
    await owner.probe?.close();
  });
  const subscriptions: { deliver(signal: string): boolean; closed: number }[] = [];
  const descriptors: { closes: number }[] = [];
  const events: string[] = [];
  const completed = new Set<number>();
  let negativeRelease = false;
  let observed: { outer: number; first: number; second: number; nested: string; chosen: string; firstLive: boolean; secondLive: boolean } | undefined;
  const memory = new MemoryFileSystem();
  await memory.writeFile("/first", Buffer.from("first\n"));
  await memory.writeFile("/second", Buffer.from("second\n"));
  const fs: FileSystem = new Proxy(memory, { get(target, property) {
    if (property === "open") return async (...args: Parameters<MemoryFileSystem["open"]>) => {
      const resource = await target.open(...args);
      const record = { closes: 0 };
      descriptors.push(record);
      return new Proxy(resource, { get(descriptor, member) {
        if (member === "close") return async () => { record.closes++; await descriptor.close(); };
        if (member === "read") return async (...operation: Parameters<typeof descriptor.read>) => {
          const first = args[0] === "/first";
          (first ? firstBlocked : secondBlocked).resolve();
          const signal = operation[2]?.signal;
          let abort!: () => void;
          try {
            await new Promise<void>((resolve, reject) => {
              abort = () => { reject(signal?.reason); };
              if (signal?.aborted) abort();
              else signal?.addEventListener("abort", abort, { once: true });
              void (first ? firstGate : secondGate).promise.then(resolve);
            });
            signal?.throwIfAborted();
            return await descriptor.read(...operation);
          } finally { signal?.removeEventListener("abort", abort); }
        };
        const value: unknown = Reflect.get(descriptor, member, descriptor);
        return typeof value === "function" ? value.bind(descriptor) : value;
      } });
    };
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  owner.probe = createJobState({ maxJobs: 1, maxWaiters: 1 });
  const prototype = Object.getPrototypeOf(owner.probe) as JobState;
  for (const method of ["wait", "waitNext"] as const) {
    const original = prototype[method];
    context.mock.method(prototype, method, function (this: JobState, targets: Parameters<JobState["wait"]>[0], options: Parameters<JobState["wait"]>[1]) {
      const signal = options?.signal;
      assert(signal instanceof AbortSignal);
      const target = targets?.[0];
      const jobId = target && "handle" in target ? target.handle.jobId : undefined;
      const previous = Object.getOwnPropertyDescriptor(signal, "addEventListener");
      const originalAdd = signal.addEventListener;
      Object.defineProperty(signal, "addEventListener", { configurable: true, value(...[type, listener, settings]: Parameters<AbortSignal["addEventListener"]>) {
        originalAdd.call(signal, type, listener, settings);
        if (type === "abort") {
          events.push(`admitted:${method}:${jobId}`);
          if (jobId === 1) firstAdmitted.resolve();
          if (jobId === 2) secondAdmitted.resolve();
        }
      } });
      try { return original.call(this, targets, options); }
      finally {
        if (previous) Object.defineProperty(signal, "addEventListener", previous);
        else Reflect.deleteProperty(signal, "addEventListener");
      }
    });
  }
  owner.shell = new Shell({ fs, extensions: [jobsExtension(), trapExtension({ signalNames: { SIGUSR1: 30, SIGUSR2: 31 }, signalHost: {
    subscribe(deliver) { const entry = { deliver, closed: 0 }; subscriptions.push(entry); return () => { entry.closed++; }; },
  } })] });
  for (const command of basicCommands()) owner.shell.register(command);
  owner.shell.register({ name: "child", async execute({ stdin, signal, args }) {
    for await (const chunk of stdin) { assert(chunk.length > 0); signal.throwIfAborted(); }
    completed.add(Number(args[0]));
    return { exitCode: Number(args[0]) };
  } });
  owner.shell.register({ name: "observe", execute({ args }) {
    observed = { outer: Number(args[0]), first: Number(args[1]), second: Number(args[2]), nested: args[3]!, chosen: args[4]!, firstLive: !completed.has(7), secondLive: !completed.has(9) };
    clearTimeout(owner.negative);
    firstGate.resolve(); secondGate.resolve();
    return { exitCode: 0 };
  } });
  const nestedWait = scenario.next ? 'wait -n -p chosen "$second"' : 'wait "$second"';
  const firstAction = `first_count=$((first_count + 1))${scenario.kind === "nested" ? `; ${nestedWait}; nested=$?` : ""}`;
  const source = `first_count=0; second_count=0; nested=old; chosen=old; trap '${firstAction}' USR1; trap '${scenario.ignored ? "" : "second_count=$((second_count + 1))"}' USR2; child 7 </first & first=$!; ${scenario.kind === "nested" ? "child 9 </second & second=$!; " : ""}wait "$first"; outer=$?; observe "$outer" "$first_count" "$second_count" "$nested" "\${chosen-unset}"; wait "$first"; printf 'first:%s\\n' "$?"${scenario.kind === "nested" ? '; wait "$second"; printf "second:%s\\n" "$?"' : ""}`;
  owner.safety = setTimeout(() => { controller.abort(new Error("owned pending/nested safety")); firstGate.resolve(); secondGate.resolve(); }, 1700);
  owner.running = owner.shell.exec(source, { signal: controller.signal });
  void owner.running.catch(() => undefined);
  await Promise.race([Promise.all([firstBlocked.promise, firstAdmitted.promise]), owner.running.then(() => assert.fail("ended before outer wait admission"))]);
  const deliver = (signal: string) => { events.push(`deliver:${signal}`); assert.equal(subscriptions[0]!.deliver(signal), true); };
  if (scenario.kind === "mixed") {
    deliver(scenario.reverse ? "USR2" : "USR1");
    deliver(scenario.reverse ? "USR1" : "USR2");
  } else {
    deliver("USR1");
    await Promise.race([Promise.all([secondBlocked.promise, secondAdmitted.promise]), owner.running.then(() => assert.fail("ended before nested wait admission"))]);
    deliver("USR2");
    if (scenario.ignored) secondGate.resolve();
    if (scenario.cancel) controller.abort(0);
  }
  owner.negative = setTimeout(() => { negativeRelease = true; firstGate.resolve(); secondGate.resolve(); }, 150);
  const outcome = await owner.running.then(value => ({ kind: "return" as const, value }), reason => ({ kind: "throw" as const, reason: reason as unknown }));
  finished = true;
  clearTimeout(owner.safety); clearTimeout(owner.negative);
  await owner.shell.dispose().catch(() => undefined);
  context.diagnostic(JSON.stringify({ scenario, source, events, observed, negativeRelease, outcome, descriptors, subscriptionCloses: subscriptions.map(entry => entry.closed) }));
  assert.equal(descriptors.length, scenario.kind === "mixed" ? 1 : 2);
  assert.ok(descriptors.every(entry => entry.closes === 1));
  assert.ok(subscriptions.every(entry => entry.closed === 1));
  assert.equal(subscriptions[0]!.deliver("USR1"), false);
  assert.equal(negativeRelease, false);
  if (scenario.cancel) {
    assert.equal(outcome.kind, "throw");
    if (outcome.kind === "throw") assert.equal(outcome.reason, 0);
    assert.equal(observed, undefined);
    return;
  }
  assert.equal(outcome.kind, "return");
  if (outcome.kind !== "return") return;
  assert.equal(outcome.value.exitCode, 0);
  assert.equal(outcome.value.stderr, "");
  assert.equal(observed?.outer, scenario.reverse ? 159 : 158);
  assert.equal(observed?.first, 1, "one delivery must not run the first action twice");
  assert.equal(observed?.second, scenario.ignored ? 0 : 1, "one delivery must not run the second action twice");
  assert.equal(observed?.firstLive, true);
  if (scenario.kind === "nested") {
    assert.equal(observed?.nested, scenario.ignored ? "9" : "159");
    assert.equal(observed?.chosen, scenario.next ? "unset" : "old");
    assert.equal(observed?.secondLive, !scenario.ignored);
  }
  assert.equal(outcome.value.stdout, `first:7\n${scenario.kind === "nested" ? "second:9\n" : ""}`);
}

test("distinct pending signals each run once: USR1 then USR2", { timeout: 3000 }, context => control(context, { kind: "mixed" }));
test("distinct pending signals each run once: USR2 then USR1", { timeout: 3000 }, context => control(context, { kind: "mixed", reverse: true }));
test("ordinary wait nested in a trap action has independent interruption", { timeout: 3000 }, context => control(context, { kind: "nested" }));
test("next wait nested in a trap action retains destination and children", { timeout: 3000 }, context => control(context, { kind: "nested", next: true }));
test("ignored signal leaves trap-action wait pending until child release", { timeout: 3000 }, context => control(context, { kind: "nested", ignored: true }));
test("falsey root cancellation wins inside a trap-action wait", { timeout: 3000 }, context => control(context, { kind: "nested", cancel: true }));

function signalFixture(context: TestContext, options: { readonly extensions?: readonly ShellExtension[]; readonly cleanupFailure?: { readonly reason: unknown } } = {}) {
  const owner: { shell?: Shell } = {};
  context.after(async () => { await owner.shell?.dispose().catch(() => undefined); });
  const subscriptions: { deliver(signal: string): boolean; closes: number }[] = [];
  owner.shell = new Shell({ fs: new MemoryFileSystem(), extensions: [trapExtension({
    signalNames: { SIGUSR1: 30, SIGUSR2: 31 },
    signalHost: { subscribe(deliver) {
      const entry = { deliver, closes: 0 };
      subscriptions.push(entry);
      return () => { entry.closes++; if (options.cleanupFailure) throw options.cleanupFailure.reason; };
    } },
  }), ...(options.extensions ?? [])] });
  for (const command of basicCommands()) owner.shell.register(command);
  owner.shell.register({ name: "deliver", execute({ args }) {
    for (const name of args) assert.equal(subscriptions[0]!.deliver(name), true);
    return { exitCode: 0 };
  } });
  return { shell: owner.shell, subscriptions };
}

test("new same-name deliveries wait for the running action instead of disappearing or reentering", { timeout: 3000 }, async context => {
  const { shell, subscriptions } = signalFixture(context);
  let calls = 0;
  shell.register({ name: "requeue", execute() {
    if (++calls === 1) {
      assert.equal(subscriptions[0]!.deliver("USR1"), true);
      assert.equal(subscriptions[0]!.deliver("USR1"), true);
    }
    return { exitCode: 0 };
  } });
  const result = await shell.exec(`trap 'printf start; requeue; printf end' USR1; deliver USR1; printf after`);
  assert.equal(result.stdout, "startendstartendafter");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(calls, 2);
  assert.equal(subscriptions[0]!.closes, 1);
});

for (const action of ["replace", "ignore", "remove"] as const) test(`pending redelivery uses current ${action} handler state after running action`, { timeout: 3000 }, async context => {
  const { shell, subscriptions } = signalFixture(context);
  const update = action === "replace" ? 'trap "printf replacement" USR1' : action === "ignore" ? 'trap "" USR1' : "trap - USR1";
  const result = await shell.exec(`trap 'printf original; deliver USR1; ${update}; printf end' USR1; deliver USR1; printf after`);
  assert.equal(result.stdout, `originalend${action === "replace" ? "replacement" : ""}after`);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(subscriptions[0]!.closes, 1);
});

test("different named actions may run nested without consuming a running action's new delivery", { timeout: 3000 }, async context => {
  const { shell, subscriptions } = signalFixture(context);
  const result = await shell.exec(`trap 'printf A; deliver USR2; printf Z' USR1; trap 'printf B; trap "printf replacement" USR1; deliver USR1; printf C' USR2; deliver USR1; printf after`);
  assert.equal(result.stdout, "ABCZreplacementafter");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(subscriptions[0]!.closes, 1);
});

for (const reason of [undefined, null, false, 0, ""]) test(`pending action preserves exact falsey failure over subscription cleanup: ${String(reason)}`, { timeout: 3000 }, async context => {
  const secondary = new Error("secondary signal subscription cleanup");
  const failure: ShellExtension = { name: "pending-failure", create: () => ({ builtins: [], checkpoint(point) { if (point === "loop-body-complete") throw reason; } }) };
  const { shell, subscriptions } = signalFixture(context, { extensions: [failure], cleanupFailure: { reason: secondary } });
  let output = "";
  const outcome = await shell.exec(`trap 'printf A; for item in only; do :; done; printf forbidden' USR1; trap 'printf B' USR2; deliver USR1 USR2; printf forbidden`, {
    stdout: { async write(bytes) { output += Buffer.from(bytes).toString(); } },
  }).then(value => ({ kind: "return" as const, value }), error => ({ kind: "throw" as const, error: error as unknown }));
  assert.equal(outcome.kind, "throw");
  if (outcome.kind === "throw") assert.equal(outcome.error, reason);
  assert.equal(output, "BA");
  assert.equal(subscriptions[0]!.closes, 1);
  assert.equal(subscriptions[0]!.deliver("USR1"), false);
});

test("root cancellation wins over action failure and pending redelivery", { timeout: 3000 }, async context => {
  const controller = new AbortController();
  const failure: ShellExtension = { name: "pending-cancel", create: () => ({ builtins: [{ name: "cancel-action", execute() { controller.abort(0); throw false; } }] }) };
  const { shell, subscriptions } = signalFixture(context, { extensions: [failure], cleanupFailure: { reason: new Error("secondary cleanup") } });
  let output = "";
  const outcome = await shell.exec(`trap 'deliver USR1; cancel-action; printf forbidden' USR1; deliver USR1; printf forbidden`, {
    signal: controller.signal, stdout: { async write(bytes) { output += Buffer.from(bytes).toString(); } },
  }).then(value => ({ kind: "return" as const, value }), error => ({ kind: "throw" as const, error: error as unknown }));
  assert.equal(outcome.kind, "throw");
  if (outcome.kind === "throw") assert.equal(outcome.error, 0);
  assert.equal(output, "");
  assert.equal(subscriptions[0]!.closes, 1);
});

test("repeated accepted redelivery remains bounded by the invocation command budget", { timeout: 3000 }, async context => {
  const { shell, subscriptions } = signalFixture(context);
  await assert.rejects(shell.exec(`trap 'deliver USR1; :' USR1; deliver USR1`, { limits: { maxCommands: 20 } }), error => error instanceof ShellLimitError);
  assert.equal(subscriptions[0]!.closes, 1);
  assert.equal(subscriptions[0]!.deliver("USR1"), false);
});
