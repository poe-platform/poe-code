import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { Runtime } from "../../../../src/shell/runtime.js";
import type { State } from "../../../../src/shell/runtime.js";
import { StateMonitor, stateMonitor } from "../../../../src/shell/arrays/state.js";
import { runtimeSetup } from "./helpers.js";

for (const bounded of [false, true]) {
  for (const destination of ["OPTARG", "ref"]) {
    for (const mode of ["silent", "verbose", "suppressed"]) {
      for (const args of ["-j", "-b", "-byes", "-a", "--"]) {
        test(`getopts OPTARG destination: ${destination}, ${mode}, ${args}, bounded=${bounded}`, async () => {
          const source = `OPTARG=old; ${destination === "ref" ? "declare -n ref=OPTARG;" : ""}
${mode === "suppressed" ? "OPTERR=0;" : ""}
getopts '${mode === "silent" ? ":ab:" : "ab:"}' ${destination} ${args}
printf '%s|%s|%s\\n' "$?" "\${OPTARG-unset}" "$OPTIND"`;
          const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source, "shell"], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
          assert.equal(native.status, 0, native.stderr);
          const { shell } = runtimeSetup(bounded ? { limits: { maxExpansionBytes: 4096 } } : {});
          try {
            const result = await shell.exec(source);
            assert.equal(result.stdout, native.stdout);
            assert.equal(result.stderr, native.stderr);
            assert.equal(result.exitCode, native.status);
          } finally { await shell.dispose(); }
        });
      }
    }
  }
}

for (const optstring of ["ab:", ":ab:"]) {
  for (const args of ["-j", "-b"]) {
    for (const [setup, command] of [
      ["OPTARG=old", "OPTARG=temporary getopts"],
      ["readonly OPTARG=old", "getopts"],
    ]) {
      test(`getopts error publishes OPTARG with ${setup}, ${optstring}, ${args}`, async () => {
        const source = `${setup}; ${command} '${optstring}' OPTARG ${args}; printf '%s|%s|%s\\n' "$?" "\${OPTARG-unset}" "$OPTIND"`;
        const native = spawnSync("bash", ["--noprofile", "--norc", "-c", source, "shell"], { encoding: "utf8", env: { ...process.env, LC_ALL: "C" } });
        assert.equal(native.status, 0, native.stderr);
        const { shell } = runtimeSetup();
        try {
          const result = await shell.exec(source);
          assert.equal(result.stdout, native.stdout);
          assert.equal(result.stderr, native.stderr);
          assert.equal(result.exitCode, native.status);
        } finally { await shell.dispose(); }
      });
    }
  }
}

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

test("readonly OPTIND diagnoses each scan without blocking OPTARG/name or hidden progress", async () => observe(async states => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('OPTARG=old; opt=old; readonly OPTIND; getopts ab opt -ab; say "$?:$OPTIND:$OPTARG:$opt"; getopts ab opt -ab; say "$?:$OPTIND:$OPTARG:$opt"');
  assert.equal(result.stdout, "0:1::a\n0:1::b\n");
  assert.deepEqual(states[0]!.getopts?.cursor, { index: 2 });
  assert.equal(result.stderr.match(/OPTIND: readonly variable/gu)?.length, 2);
}));

test("readonly OPTARG retains its value until EOF removes the binding and attribute", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('opt=old; readonly OPTARG=old; getopts a:b opt -a value -b; say "$?:$OPTIND:$OPTARG:$opt"; getopts a:b opt -a value -b; say "$?:$OPTIND:$OPTARG:$opt"; getopts a:b opt -a value -b; say "$?:$OPTIND:${OPTARG-unset}:$opt"; OPTARG=new; say "$?:$OPTARG"');
  assert.equal(result.stdout, "0:3:old:a\n0:4:old:b\n1:4:unset:?\n0:new\n");
  assert.equal(result.stderr, "shell: line 1: OPTARG: readonly variable\n".repeat(2));
});

for (const [declaration, expected, diagnostics] of [
  ["readonly OPTIND", "0:b:value:1\n0:a:unset:1\n1:?:unset:1\n1:?:unset:1\n", ["OPTIND", "OPTIND", "OPTIND", "OPTIND"]],
  ["readonly OPTARG=old", "0:b:old:3\n0:a:old:4\n1:?:unset:4\n1:?:unset:4\n", ["OPTARG", "OPTARG"]],
  ["readonly OPTIND OPTARG=old", "0:b:old:1\n0:a:old:1\n1:?:unset:1\n1:?:unset:1\n", ["OPTIND", "OPTARG", "OPTIND", "OPTARG", "OPTIND", "OPTIND"]],
] as const) {
  test(`getopts returns options and EOF with ${declaration}`, async () => {
    const { shell } = runtimeSetup();
    try {
      const result = await shell.exec(`${declaration}; set -- -b value -a; for n in 1 2 3 4; do getopts ab: o; printf '%s:%s:%s:%s\\n' "$?" "\${o-unset}" "\${OPTARG-unset}" "$OPTIND"; done`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, diagnostics.map(name => `shell: line 1: ${name}: readonly variable\n`).join(""));
    } finally { await shell.dispose(); }
  });

  test(`while getopts visits every option with ${declaration}`, async () => {
    const { shell } = runtimeSetup();
    try {
      const result = await shell.exec(`${declaration}; set -- -ab value; while getopts ab: o; do say "$o"; done; say "end:$o"`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "a\nb\nend:?\n");
    } finally { await shell.dispose(); }
  });
}

for (const [args, diagnostic] of [["-z", "illegal option -- z"], ["-b", "option requires an argument -- b"]]) {
  test(`verbose getopts error removes readonly OPTARG for ${args}`, async () => {
    const { shell } = runtimeSetup();
    try {
      const result = await shell.exec(`readonly OPTARG=old; getopts ab: o ${args}; say "$?:$o:\${OPTARG-unset}:$OPTIND"; OPTARG=new; say "$OPTARG"`);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "0:?:unset:2\nnew\n");
      assert.equal(result.stderr, `shell: ${diagnostic}\n`);
    } finally { await shell.dispose(); }
  });
}

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
  assert.equal(result.stdout, "2:1::old\n2:2::old\n1:2::old\n");
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

for (const bounded of [false, true]) {
  for (const [spec, args, expected, diagnostic] of [
    ["ab:", "rest", "1|unset|keep", ""],
    ["ab:", "--", "1|unset|keep", ""],
    ["ab:", "-x", "0|unset|keep", "shell: illegal option -- x\n"],
    ["ab:", "-b", "0|unset|keep", "shell: option requires an argument -- b\n"],
    ["ab:", "-bYES", "0|YES|YES", ""],
    ["ab:", "-a", "0|unset|unset", ""],
    [":ab:", "-x", "0|x|x", ""],
    [":ab:", "-b", "0|b|b", ""],
  ]) {
    test(`getopts OPTARG nameref with ${spec} ${args} (${bounded ? "bounded" : "unlimited"})`, async () => {
      const { shell } = runtimeSetup(bounded ? { limits: { maxExpansionBytes: 4096 } } : {});
      try {
        const result = await shell.exec(`saved=keep
declare -n OPTARG=saved
getopts ${spec} o ${args}
say "$?|\${OPTARG-unset}|\${saved-unset}"
OPTARG=rebound
say "$saved"`);
        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, diagnostic);
        assert.equal(result.stdout, `${expected}\n${expected.endsWith("|keep") ? "keep" : "rebound"}\n`);
      } finally { await shell.dispose(); }
    });
  }
}
