import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { Runtime } from "../../../../src/shell/runtime.js";
import type { State } from "../../../../src/shell/runtime.js";
import { StateMonitor, stateMonitor } from "../../../../src/shell/arrays/state.js";
import { runtimeSetup } from "./helpers.js";

type ObservedState = {
  readonly boundary: "caller-abort" | "simple-exit";
  readonly variables: Readonly<State["variables"]>;
  readonly getopts: Readonly<Pick<NonNullable<State["getopts"]>, "cursor">> | undefined;
};

async function observe(action: (states: ObservedState[], closeObservation: () => void) => Promise<void>): Promise<void> {
  const originalBuiltin = Runtime.prototype.builtin;
  const originalSimple = Runtime.prototype.simple;
  const originalMutation = StateMonitor.prototype.mutation;
  const originalPublication = StateMonitor.prototype.publish;
  const originalRestoration = StateMonitor.prototype.restore;
  const observed = new Set<State>();
  const monitors = new Set<StateMonitor>();
  const continuations: Promise<void>[] = [];
  const lateAttempts: { kind: "mutation" | "publication" | "restoration"; name: string | undefined }[] = [];
  const indices = new Map<State, number>();
  const states: ObservedState[] = [];
  let live = true;
  let publiclySettled = false;
  const capture = (state: State, boundary: ObservedState["boundary"]): void => {
    if (!live || !observed.has(state)) return;
    const cursor = state.getopts?.cursor;
    const snapshot: ObservedState = Object.freeze({
      boundary,
      variables: Object.freeze({ ...state.variables }),
      getopts: cursor === undefined ? undefined : Object.freeze({ cursor: Object.freeze({
        ...cursor,
        ...(cursor.active === undefined ? {} : { active: Object.freeze({ ...cursor.active }) }),
      }) }),
    });
    const index = indices.get(state);
    if (index === undefined) { indices.set(state, states.length); states.push(snapshot); }
    else states[index] = snapshot;
  };
  Runtime.prototype.builtin = async function (...args) {
    if (args[0].command !== "getopts") return originalBuiltin.apply(this, args);
    observed.add(args[1]);
    const monitor = stateMonitor(args[1]);
    assert.ok(monitor);
    monitors.add(monitor);
    const onAbort = () => capture(args[1], "caller-abort");
    args[0].signal.addEventListener("abort", onAbort, { once: true });
    try {
      const pending = originalBuiltin.apply(this, args);
      continuations.push(pending.then(() => {}, () => {}));
      return await pending;
    }
    finally { args[0].signal.removeEventListener("abort", onAbort); }
  };
  Runtime.prototype.simple = async function (...args) {
    try { return await originalSimple.apply(this, args); }
    finally { capture(args[1], "simple-exit"); }
  };
  StateMonitor.prototype.mutation = function (...args) {
    if (publiclySettled && monitors.has(this)) lateAttempts.push({ kind: "mutation", name: args[0] });
    return originalMutation.apply(this, args);
  };
  StateMonitor.prototype.publish = function (...args) {
    if (publiclySettled && monitors.has(this)) lateAttempts.push({ kind: "publication", name: args[1] });
    return originalPublication.apply(this, args);
  };
  StateMonitor.prototype.restore = function (...args) {
    if (publiclySettled && monitors.has(this)) lateAttempts.push({ kind: "restoration", name: undefined });
    return originalRestoration.apply(this, args);
  };
  let failed = false;
  let failure: unknown;
  try {
    try { await action(states, () => { live = false; publiclySettled = true; }); }
    catch (error) { failed = true; failure = error; }
    let completed = 0;
    while (completed < continuations.length) {
      const pending = continuations.slice(completed);
      completed = continuations.length;
      await Promise.all(pending);
    }
  } finally {
    live = false;
    Runtime.prototype.builtin = originalBuiltin;
    Runtime.prototype.simple = originalSimple;
    StateMonitor.prototype.mutation = originalMutation;
    StateMonitor.prototype.publish = originalPublication;
    StateMonitor.prototype.restore = originalRestoration;
  }
  if (failed) throw failure;
  assert.deepEqual(lateAttempts, [], "post-settlement state mutation or publication");
}

test("D01 readonly OPTIND stops before OPTARG/name but retains hidden progress", async () => observe(async states => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('OPTARG=old; opt=old; readonly OPTIND; getopts ab opt -ab; say "$?:$OPTIND:$OPTARG:$opt"; getopts ab opt -ab; say "$?:$OPTIND:$OPTARG:$opt"');
  assert.equal(result.stdout, "1:1:old:old\n1:1:old:old\n");
  assert.deepEqual(states[0]!.getopts?.cursor, { index: 2 });
  assert.equal(result.stderr.match(/OPTIND: readonly variable/gu)?.length, 2);
}));

test("D01/N13 readonly OPTARG retains value and attribute for set, no-arg and EOF", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('opt=old; readonly OPTARG=old; getopts a:b opt -a value -b; say "$?:$OPTIND:$OPTARG:$opt"; getopts a:b opt -a value -b; say "$?:$OPTIND:$OPTARG:$opt"; getopts a:b opt -a value -b; say "$?:$OPTIND:$OPTARG:$opt"; unset OPTARG; say "$?:$OPTARG"');
  assert.equal(result.stdout, "1:3:old:old\n1:4:old:old\n1:4:old:old\n1:old\n");
  assert.equal(result.stderr.match(/OPTARG: (?:cannot unset: )?readonly variable/gu)?.length, 4);
});

test("late name validation preserves OPTIND/OPTARG and does not execute name syntax", async () => {
  const { shell, fs } = runtimeSetup();
  const result = await shell.exec('OPTARG=old; getopts a: "bad[1]" -a value; say "$?:$OPTIND:$OPTARG"; OPTIND=1; getopts a __proto__ -a; say "$__proto__"; OPTIND=1; getopts a "$(say bad-name)" -a; say "$?:$OPTIND"');
  assert.equal(result.stdout, "1:3:value\na\n1:2\n");
  assert.match(result.stderr, /bad\[1\].*not a valid identifier/u);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("readonly result name fails after checked index/argument, including EOF", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('readonly opt=old; OPTARG=old; getopts ab opt -ab; say "$?:$OPTIND:${OPTARG+x}:$opt"; getopts ab opt -ab; say "$?:$OPTIND:${OPTARG+x}:$opt"; getopts ab opt -ab; say "$?:$OPTIND:${OPTARG+x}:$opt"');
  assert.equal(result.stdout, "1:1::old\n1:2::old\n1:2::old\n");
});

for (const setter of ['export OPTIND=1', 'read OPTIND <<< 1', 'OPTIND=1 :', 'f() { local OPTIND=1; }; f']) {
  test(`D01 failed setter does not reset cursor: ${setter}`, async () => observe(async states => {
    const { shell } = runtimeSetup();
    await shell.exec(`getopts abc opt -abc; readonly OPTIND; ${setter}; getopts abc opt -abc`);
    assert.deepEqual(states[0]!.getopts?.cursor, { index: 1, active: { argument: 0, offset: 3 } });
  }));
}

for (const reason of [new Error("sink refusal"), false, 0, "", null, undefined]) {
  test(`parser sink rejection preserves only hidden state, existing mapping ${String(reason)}`, async () => {
    const { shell } = runtimeSetup();
    const writes: string[] = [];
    const result = await shell.exec('OPTARG=old; opt=old; getopts a opt -za; say "$?:$OPTIND:$OPTARG:$opt"; getopts a opt -za; say "$opt:$OPTIND"', { stderr: { async write(chunk) {
      const text = new TextDecoder().decode(chunk);
      writes.push(text);
      if (writes.length === 1) throw reason;
    } } });
    assert.equal(result.stdout, "1:1:old:old\na:2\n");
    assert.equal(writes[0], "shell: illegal option -- z\n");
    assert.equal(writes.length, 2);
    assert.equal(result.exitCode, 0);
  });
}

test("EPIPE diagnostic failure uses existing141 mapping, not usage2", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec("getopts a opt -z", { stderr: { async write() { throw Object.assign(new Error("closed"), { code: "EPIPE" }); } } });
  assert.equal(result.exitCode, 141);
});

for (const reason of [false, 0, "", null, undefined]) {
  test(`caller abort during parser diagnostic keeps reason identity and prevents late stores: ${String(reason)}`, { timeout: 2000 }, async () => observe(async (states, closeObservation) => {
    const { shell } = runtimeSetup();
    const controller = new AbortController();
    let complete!: () => void;
    const pending = new Promise<void>(resolve => { complete = resolve; });
    const execution = shell.exec('OPTARG=old; opt=old; getopts a opt -za', { signal: controller.signal, stderr: { write() { controller.abort(reason); return pending; } } });
    try {
      await assert.rejects(execution, error => error === controller.signal.reason);
      closeObservation();
    } finally { complete(); }
    await setImmediate();
    assert.equal(states[0]!.variables.OPTIND, "1");
    assert.equal(states[0]!.variables.OPTARG, "old");
    assert.equal(states[0]!.variables.opt, "old");
    assert.deepEqual(states[0]!.getopts?.cursor, { index: 1, active: { argument: 0, offset: 2 } });
    await shell.dispose();
  }));
}

for (const target of ["OPTIND", "OPTARG", "opt", "cursor.index", "cursor.active", "publication", "restoration"] as const) {
  test(`observer rejects a post-settlement getopts mutation attempt: ${target}`, { timeout: 2000 }, async context => {
    const { shell } = runtimeSetup();
    const controller = new AbortController();
    let complete!: () => void;
    const released = new Promise<void>(resolve => { complete = resolve; });
    let state: State | undefined;
    let mutation!: () => boolean;
    let attempted = false;
    let mutationSucceeded = false;
    let mutationRejected = false;
    let closeRestoration: (() => void) | undefined;
    const builtin = Runtime.prototype.builtin;
    context.mock.method(Runtime.prototype, "builtin", async function (this: Runtime, ...args: Parameters<Runtime["builtin"]>) {
      if (args[0].command !== "getopts") return builtin.apply(this, args);
      state = args[1];
      try { return await builtin.apply(this, args); }
      finally {
        await released;
        await setImmediate();
        await setImmediate();
        attempted = true;
        try { mutationSucceeded = mutation(); }
        catch { mutationRejected = true; }
      }
    });
    try {
      await assert.rejects(observe(async (_states, closeObservation) => {
        try {
          await assert.rejects(shell.exec('OPTARG=old; opt=old; getopts a opt -za', { signal: controller.signal, stderr: { write() {
            assert.ok(state);
            const variables = state.variables;
            const cursor = state.getopts!.cursor;
            const monitor = stateMonitor(state)!;
            const restoration = target === "restoration" ? monitor.restoration() : undefined;
            closeRestoration = () => restoration?.close();
            mutation = target === "cursor.index" ? () => Reflect.set(cursor, "index", 99)
              : target === "cursor.active" ? () => Reflect.set(cursor, "active", { argument: 99, offset: 99 })
                : target === "publication" ? () => { monitor.publish({ generation: 0, version: 0, epoch: 0 }, "OPTARG", () => { Reflect.set(variables, "OPTARG", "late"); }); return true; }
                  : target === "restoration" ? () => { monitor.restore(restoration!, () => {}); return true; }
                  : () => Reflect.set(variables, target, "late");
            controller.abort(0);
            return released;
          } } }), error => Object.is(error, 0));
          closeObservation();
        } finally { complete(); }
        await setImmediate();
      }), /post-settlement state mutation or publication/u);
      assert.equal(attempted, true);
      assert.equal(mutationSucceeded || mutationRejected, true);
    } finally { complete(); closeRestoration?.(); await shell.dispose(); }
  });
}

for (const reason of [false, 0, "", null, undefined]) {
  test(`observer rejects the independently reviewed late restoration mutant: ${String(reason)}`, { timeout: 2000 }, async context => {
    const { shell } = runtimeSetup();
    const controller = new AbortController();
    let complete!: () => void;
    const released = new Promise<void>(resolve => { complete = resolve; });
    let state: State | undefined;
    let inject!: () => void;
    let closeRestoration: (() => void) | undefined;
    const writes: boolean[] = [];
    const builtin = Runtime.prototype.builtin;
    context.mock.method(Runtime.prototype, "builtin", function (this: Runtime, ...args: Parameters<Runtime["builtin"]>) {
      if (args[0].command === "getopts") state = args[1];
      return builtin.apply(this, args);
    });
    try {
      await assert.rejects(observe(async (states, closeObservation) => {
        try {
          await assert.rejects(shell.exec('OPTARG=old; opt=old; getopts a opt -za', { signal: controller.signal, stderr: { write() {
            assert.ok(state);
            const variables = state.variables;
            const getopts = state.getopts;
            assert.ok(getopts);
            const monitor = stateMonitor(state)!;
            const restoration = monitor.restoration();
            restoration.epoch = 0;
            closeRestoration = () => restoration.close();
            inject = () => monitor.restore(restoration, () => {
              writes.push(Reflect.set(variables, "OPTIND", "999"));
              writes.push(Reflect.set(variables, "OPTARG", "late"));
              writes.push(Reflect.set(variables, "opt", "late"));
              writes.push(Reflect.set(getopts, "cursor", { index: 999 }));
            });
            controller.abort(reason);
            return released;
          } } }), error => error === controller.signal.reason);
          closeObservation();
          complete();
          inject();
          await setImmediate();
          assert.equal(states[0]!.variables.OPTIND, "1");
          assert.equal(states[0]!.variables.OPTARG, "old");
          assert.equal(states[0]!.variables.opt, "old");
          assert.deepEqual(states[0]!.getopts?.cursor, { index: 1, active: { argument: 0, offset: 2 } });
        } finally { complete(); }
      }), /post-settlement state mutation or publication/u);
      assert.deepEqual(writes, [true, true, true, true]);
    } finally { complete(); closeRestoration?.(); await shell.dispose(); }
  });
}

for (const reason of [new Error("prefix cancelled"), false, 0, "", null, undefined]) {
test(`D01 prefix restoration restores exact binding and hidden state on abort${reason instanceof Error ? "" : `: ${String(reason)}`}`, async () => observe(async (states, closeObservation) => {
  const { shell } = runtimeSetup();
  const controller = new AbortController();
  await assert.rejects(shell.exec('getopts abc opt -abc; getopts abc opt -abc; OPTIND=1 getopts a opt -z', { signal: controller.signal, stderr: { async write() { controller.abort(reason); } } }), error => error === controller.signal.reason);
  closeObservation();
  await setImmediate();
  assert.equal(states[0]!.boundary, "simple-exit");
  assert.equal(states[0]!.variables.OPTIND, "1");
  assert.deepEqual(states[0]!.getopts?.cursor, { index: 1, active: { argument: 0, offset: 3 } });
}));
}

test("silent mode and OPTERR suppression perform zero parser writes", async () => {
  const { shell } = runtimeSetup();
  for (const source of ['getopts :a opt -z', 'getopts :a: opt -a', 'OPTERR=0; getopts a opt -z']) {
    let writes = 0;
    const result = await shell.exec(source, { stdout: { async write() { throw new Error("unexpected stdout"); } }, stderr: { async write() { writes++; throw new Error("unexpected stderr, including empty writes"); } } });
    assert.equal(result.exitCode, 0);
    assert.equal(writes, 0);
    assert.equal(result.stdoutBytes.length, 0);
    assert.equal(result.stderrBytes.length, 0);
  }
});
