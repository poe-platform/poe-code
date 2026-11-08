import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { TestContext } from "node:test";
import type { FileSystem } from "poe-code/safe-fs";
import type { Shell, ShellResult } from "poe-code/safe-bash";
import type { JobState } from "../../src/shell/extensions/jobs/state.js";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type Optional = {
  jobsExtension(): Extension;
  trapExtension(options: {
    signalNames: Readonly<Record<string, number>>;
    signalHost: { subscribe(deliver: (signal: string | number) => boolean, scope: object): () => void };
  }): Extension;
};

const enabled = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (enabled !== undefined && enabled !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");
const signalNames = Object.freeze({ SIGUSR1: 30, SIGUSR2: 31 });

function deferred() {
  let complete!: () => void;
  const promise = new Promise<void>(resolve => { complete = resolve; });
  return { promise, resolve: complete };
}

async function runWait(context: TestContext, route: "inline" | "bash" | "sh", signalName: "USR1" | "USR2", disposition: "handled" | "ignored" | "unhandled", form?: { wait: string; destination?: boolean; second?: boolean; negate?: boolean }) {
  const released = deferred();
  const blocked = deferred();
  const registered = deferred();
  const controller = new AbortController();
  const owner: {
    shell?: Shell;
    probe?: JobState;
    running?: Promise<ShellResult>;
    safety?: ReturnType<typeof setTimeout>;
    interruptionDeadline?: ReturnType<typeof setTimeout>;
  } = {};
  let finished = false;
  context.after(async () => {
    clearTimeout(owner.safety);
    clearTimeout(owner.interruptionDeadline);
    released.resolve();
    if (!finished) controller.abort(new Error("compiled trapped-wait control cleanup"));
    await owner.running?.catch(() => undefined);
    await owner.shell?.dispose();
    await owner.probe?.close();
  });
  const published = await import("poe-code/safe-bash");
  const { createMemoryFileSystem } = await import("poe-code/safe-fs");
  const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
  const { createJobState } = await import(new URL("../../dist/shell/extensions/jobs/state.js", import.meta.url).href) as typeof import("../../src/shell/extensions/jobs/state.js");
  const subscriptions: { deliver(signal: string | number): boolean; closed: number }[] = [];
  const descriptors: { closes: number }[] = [];
  const events: string[] = [];
  let childrenReturned = 0;
  let chosen: string | undefined;
  let deadlineRelease = false;
  let continuation: { status: number; traps: number; childLive: boolean } | undefined;
  const memory = createMemoryFileSystem();
  await memory.writeFile("/gate", Buffer.from("release\n"));
  const filesystem: FileSystem = new Proxy(memory, { get(target, property) {
    if (property === "open") return async (...args: Parameters<NonNullable<FileSystem["open"]>>) => {
      const descriptor = await target.open(...args);
      const retained = { closes: 0 };
      descriptors.push(retained);
      return new Proxy(descriptor, { get(resource, member) {
        if (member === "close") return async () => { retained.closes++; await resource.close(); };
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
  const method = form ? "waitNext" : "wait";
  const originalWait = prototype[method];
  context.mock.method(prototype, method, function (this: JobState, targets: Parameters<JobState["wait"]>[0], options: Parameters<JobState["wait"]>[1]) {
    const signal = options?.signal;
    assert(signal instanceof AbortSignal);
    const previous = Object.getOwnPropertyDescriptor(signal, "addEventListener");
    const originalAdd = signal.addEventListener;
    Object.defineProperty(signal, "addEventListener", { configurable: true, value(...[type, listener, settings]: Parameters<AbortSignal["addEventListener"]>) {
      originalAdd.call(signal, type, listener, settings);
      if (type === "abort") { events.push("wait-listener-registered"); registered.resolve(); }
    } });
    try { return originalWait.call(this, targets, options); }
    finally {
      if (previous) Object.defineProperty(signal, "addEventListener", previous);
      else Reflect.deleteProperty(signal, "addEventListener");
    }
  });
  owner.shell = new published.Shell({ fs: filesystem, extensions: [optional.jobsExtension(), optional.trapExtension({ signalNames, signalHost: {
    subscribe(deliver) {
      const entry = { deliver, closed: 0 };
      subscriptions.push(entry);
      return () => { entry.closed++; };
    },
  } })] }).use(published.agentCommands());
  owner.shell.register({ name: "child_read", async execute({ stdin, signal }) {
    for await (const bytes of stdin) { assert(bytes.length > 0); signal.throwIfAborted(); }
    childrenReturned++;
    events.push("child-returned-seven");
    return { exitCode: 7 };
  } });
  owner.shell.register({ name: "parent_observe", execute({ args }) {
    continuation = { status: Number(args[0]), traps: Number(args[1]), childLive: childrenReturned === 0 };
    chosen = args[2];
    events.push("parent-continuation");
    clearTimeout(owner.interruptionDeadline);
    released.resolve();
    return { exitCode: 0 };
  } });
  const handler = 'trap_status=$?; traps=$((traps + 1)); printf "trap:%s\\n" "$trap_status"';
  const action = disposition === "handled" ? `trap '${handler}' ${signalName}; ` : disposition === "ignored" ? `trap '' ${signalName}; ` : "";
  const source = `traps=0; chosen=old; ${action}child_read </gate & child=$!; ${form?.second ? "child_read </gate & other=$!; " : ""}${form?.wait ?? 'wait "$child"'}; first=$?; parent_observe "$first" "$traps" "\${chosen-unset}"; wait "$child"; printf 'later:%s;traps:%s\\n' "$?" "$traps"${form?.second ? '; wait "$other"; printf "other:%s\\n" "$?"' : ""}`;
  await memory.writeFile("/trapped-wait.sh", Buffer.from(source));
  owner.safety = setTimeout(() => {
    controller.abort(new Error("compiled trapped-wait safety deadline"));
    released.resolve();
  }, 1500);
  owner.running = owner.shell.exec(route === "inline" ? source : `${route} /trapped-wait.sh`, { signal: controller.signal });
  void owner.running.catch(() => undefined);
  await Promise.race([Promise.all([blocked.promise, registered.promise]), owner.running.then(() => assert.fail("execution ended before actual wait registration"))]);
  assert.equal(childrenReturned, 0);
  const waitingParent = subscriptions[route === "inline" ? 0 : 1]!;
  assert.equal(waitingParent.closed, 0);
  events.push("named-signal-delivered");
  assert.equal(waitingParent.deliver(signalName), disposition !== "unhandled");
  if (disposition === "handled") owner.interruptionDeadline = setTimeout(() => { deadlineRelease = true; released.resolve(); }, 150);
  else released.resolve();
  const result = await owner.running;
  finished = true;
  clearTimeout(owner.safety);
  clearTimeout(owner.interruptionDeadline);
  await owner.shell.dispose();
  context.diagnostic(JSON.stringify({ route, signalName, disposition, events, continuation, deadlineRelease, descriptors, subscriptionCloses: subscriptions.map(entry => entry.closed) }));
  assert.ok(descriptors.length > 0);
  assert.ok(descriptors.every(entry => entry.closes === 1));
  assert.ok(subscriptions.every(entry => entry.closed === 1));
  assert.equal(waitingParent.deliver(signalName), false);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  const status = form?.negate ? 0 : disposition === "handled" ? 128 + signalNames[`SIG${signalName}`] : 7;
  assert.deepEqual(continuation, { status, traps: disposition === "handled" ? 1 : 0, childLive: disposition === "handled" });
  assert.equal(deadlineRelease, false);
  assert.equal(result.stdout, (disposition === "handled" ? `trap:${status}\nlater:7;traps:1\n` : "later:7;traps:0\n") + (form?.second ? "other:7\n" : ""));
  assert.equal(chosen, form?.destination ? "unset" : "old");
  assert.equal(childrenReturned, form?.second ? 2 : 1);
  assert.ok(events.indexOf("wait-listener-registered") < events.indexOf("named-signal-delivered"));
  if (disposition === "handled") assert.ok(events.indexOf("parent-continuation") < events.indexOf("child-returned-seven"));
}

describe("compiled trapped ordinary-wait opt-in", { skip: enabled !== "1" }, () => {
  for (const route of ["inline", "bash", "sh"] as const) for (const signalName of ["USR1", "USR2"] as const) {
    test(`${route}: ${signalName} interrupts admitted wait without consuming the live child`, { timeout: 3000 }, context => runWait(context, route, signalName, "handled"));
  }
  for (const disposition of ["ignored", "unhandled"] as const) {
    test(`inline: ${disposition} signal does not interrupt ordinary wait`, { timeout: 3000 }, context => runWait(context, "inline", "USR1", disposition));
  }
  for (const form of [
    { wait: "wait -n" },
    { wait: 'wait -n "$child"' },
    { wait: "wait -n -p chosen", destination: true },
    { wait: 'wait -n -p chosen "$child"', destination: true },
    { wait: 'wait -n -p chosen "$other" "$child"', destination: true, second: true },
    { wait: '! wait -n -p chosen "$child"', destination: true, negate: true },
  ]) test(`inline: trapped ${form.wait} retains child and destination`, { timeout: 3000 }, context => runWait(context, "inline", "USR1", "handled", form));
  for (const route of ["bash", "sh"] as const) {
    test(`${route}: trapped wait-next destination stays unset`, { timeout: 3000 }, context => runWait(context, route, "USR1", "handled", { wait: 'wait -n -p chosen "$child"', destination: true }));
  }
  test("default public host does not install trap or wait", async context => {
    const owner: { shell?: Shell } = {};
    context.after(async () => { await owner.shell?.dispose(); });
    const published = await import("poe-code/safe-bash");
    const { createMemoryFileSystem } = await import("poe-code/safe-fs");
    owner.shell = new published.Shell({ fs: createMemoryFileSystem() }).use(published.agentCommands());
    for (const source of ["trap '' USR1", "wait"]) {
      const result = await owner.shell.exec(source);
      assert.equal(result.exitCode, 127);
      assert.equal(result.stdout, "");
    }
    assert.equal("trapExtension" in published, false);
    assert.equal("jobsExtension" in published, false);
  });
});
