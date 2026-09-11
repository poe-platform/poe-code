import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { CommandResult, InvocationCleanup } from "../../src/contracts/index.js";
import { InvocationScope, throwCleanupFailures } from "../../src/shell/cleanup.js";
import { setup } from "./helpers.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

function observeCallbacks(context: TestContext) {
  const active = new Map<object, { root: boolean; site: string }>();
  const register = InvocationScope.prototype.register;
  context.mock.method(InvocationScope.prototype, "register", function (this: InvocationScope, cleanup: InvocationCleanup) {
    const token = {};
    const site = new Error().stack?.split("\n").find(line => line.includes("state.ts:") || line.includes("runtime.ts:") || line.includes("shell.ts:"))?.trim() ?? "other";
    const retire = register.call(this, async () => {
      try { await cleanup(); }
      finally { active.delete(token); }
    });
    active.set(token, { root: this.parent === undefined, site });
    if (typeof retire !== "function") return retire;
    return (() => {
      (retire as () => void)();
      active.delete(token);
    }) as ReturnType<InvocationScope["register"]>;
  });
  return {
    sample() { return { root: [...active.values()].filter(entry => entry.root).length, all: active.size }; },
    sites() {
      const sites: Record<string, number> = {};
      for (const { root, site } of active.values()) if (root) sites[site] = (sites[site] ?? 0) + 1;
      return sites;
    },
  };
}

for (const [kind, command] of [["redirect", ": >out"], ["pipeline", ": | :"], ["subshell", "(:)"]] as const) {
  test(`completed ${kind} callbacks retire during one execution`, async context => {
    const observed = observeCallbacks(context);
    const { shell, commands, fs } = setup();
    const samples: ReturnType<typeof observed.sample>[] = [];
    let sites: Record<string, number> = {};
    commands.register({ name: "probe", execute() {
      samples.push(observed.sample());
      sites = observed.sites();
      return { exitCode: 0 };
    } });
    try {
      const rounds = [16, 48, 64].map(count => `for index in ${Array.from({ length: count }, (_, index) => index).join(" ")}; do ${command}; done; probe`);
      const result = await shell.exec(`probe; ${rounds.join("; ")}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      if (kind === "redirect") assert.equal((await fs.stat("/out")).size, 0);
      assert.deepEqual(observed.sample(), { root: 0, all: 0 });
      context.diagnostic(JSON.stringify({ samples, sites }));
      assert.deepEqual(samples.slice(1), [samples[0], samples[0], samples[0]]);
    } finally { await shell.dispose(); }
  });
}

test("completed local-signal invocation owners retire before their parent returns", async context => {
  const observed = observeCallbacks(context);
  const { shell, commands } = setup();
  const samples: ReturnType<typeof observed.sample>[] = [];
  commands.register({ name: "child", execute() { return { exitCode: 0 }; } });
  commands.register({ name: "parent", async execute(command) {
    const local = new AbortController();
    samples.push(observed.sample());
    for (let index = 0; index < 16; index++) assert.equal((await command.invoke!("child", [], { signal: local.signal })).exitCode, 0);
    samples.push(observed.sample());
    for (let index = 16; index < 64; index++) assert.equal((await command.invoke!("child", [], { signal: local.signal })).exitCode, 0);
    samples.push(observed.sample());
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("parent");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(observed.sample(), { root: 0, all: 0 });
    context.diagnostic(JSON.stringify({ samples }));
    assert.deepEqual(samples.slice(1), [samples[0], samples[0]]);
  } finally { await shell.dispose(); }
});

test("public command cleanup registration does not expose internal retirement", async () => {
  const { shell, commands } = setup();
  let calls = 0;
  commands.register({ name: "owned", execute(command) {
    assert.equal(command.registerCleanup!(() => { calls++; }), undefined);
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("owned");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(calls, 1);
  } finally { await shell.dispose(); }
});

test("retirement removes one registration without invoking or deduplicating callbacks", async () => {
  const scope = new InvocationScope();
  let calls = 0;
  const cleanup = () => { calls++; };
  const retire = scope.register(cleanup);
  scope.register(cleanup);
  scope.register(cleanup);
  try {
    assert.equal(typeof retire, "function");
    (retire as unknown as () => void)();
    (retire as unknown as () => void)();
    assert.equal(calls, 0);
    await scope.close();
    assert.equal(calls, 2);
    (retire as unknown as () => void)();
    assert.equal(calls, 2);
    assert.throws(() => scope.register(cleanup));
  } finally { await scope.close(); }
});

test("retirement cannot cancel snapshotted cleanup or bypass finalizers and tracked work", { timeout: 2000 }, async () => {
  const scope = new InvocationScope();
  const child = scope.child();
  const started = deferred();
  const releaseCleanup = deferred();
  const releaseWork = deferred();
  let secondCalls = 0;
  let finalized = false;
  let settled = false;
  const retireFirst = scope.register(async () => {
    assert.equal(typeof retireSecond, "function");
    (retireSecond as () => void)();
    started.resolve();
    await releaseCleanup.promise;
  });
  const retireSecond: unknown = scope.register(() => { secondCalls++; });
  child.registerFinalizer(() => { finalized = true; });
  void child.run(() => releaseWork.promise);
  const closing = scope.close();
  void closing.then(() => { settled = true; });
  try {
    assert.equal(typeof retireFirst, "function");
    await started.promise;
    (retireFirst as unknown as () => void)();
    assert.equal(scope.close(), closing);
    assert.equal(secondCalls, 1);
    assert.equal(finalized, false);
    assert.equal(settled, false);
    releaseCleanup.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(settled, false);
  } finally {
    releaseCleanup.resolve();
    releaseWork.resolve();
    await closing;
  }
  assert.equal(finalized, true);
  assert.deepEqual(scope.failures, []);
});

for (const reasons of [[undefined], [null], [false], [0], [""], [undefined, null, false, 0, ""]]) {
  test(`cleanup drains every callback and preserves falsey failures: ${reasons.map(String).join(",")}`, async () => {
    const scope = new InvocationScope();
    const calls: number[] = [];
    reasons.forEach((reason, index) => scope.register(() => { calls.push(index); throw reason; }));
    await scope.close();
    assert.deepEqual(calls, reasons.map((_, index) => index));
    assert.deepEqual(scope.failures, reasons);
    assert.throws(() => throwCleanupFailures(scope.failures), error => {
      if (reasons.length === 1) return Object.is(error, reasons[0]);
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, reasons);
      return true;
    });
  });
}

for (const completion of [{ kind: "normal" }, { kind: "abort", reason: false }, { kind: "abort", reason: null }] as const) {
  test(`redirect ${completion.kind} retains cooperative host work until completion`, { timeout: 2000 }, async context => {
    const observed = observeCallbacks(context);
    const { shell, fs } = setup();
    const caller = new AbortController();
    const entered = deferred();
    const release = deferred();
    let settled = false;
    const writeStream = fs.writeStream.bind(fs);
    Object.assign(fs, { capabilitiesFor: async () => ({ ...fs.capabilities, randomAccessWrite: false }) });
    context.mock.method(fs, "writeStream", async (...args: Parameters<typeof fs.writeStream>) => {
      await writeStream(...args);
      entered.resolve();
      await release.promise;
    });
    const execution = shell.exec("say payload >out", { signal: caller.signal });
    const checked = execution.then(result => {
      assert.equal(completion.kind, "normal");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    }, error => {
      assert.equal(completion.kind, "abort");
      assert.equal(error, "reason" in completion ? completion.reason : undefined);
    }).finally(() => { settled = true; });
    try {
      await entered.promise;
      if (completion.kind === "abort") caller.abort(completion.reason);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(settled, false);
      assert.ok(observed.sample().all > 0);
    } finally { release.resolve(); }
    try {
      await checked;
      assert.equal(Buffer.from(await fs.readFile("/out")).toString("utf8"), "payload\n");
      assert.deepEqual(observed.sample(), { root: 0, all: 0 });
    } finally { await shell.dispose(); }
  });
}

for (const reason of [false, null]) {
  test(`caller ${reason} waits for local-child cooperative cleanup without a finish cycle`, { timeout: 2000 }, async () => {
    const { shell, commands } = setup();
    const caller = new AbortController();
    const local = new AbortController();
    const entered = deferred();
    const draining = deferred();
    const release = deferred();
    let cleaned = false;
    let settled = false;
    commands.register({ name: "child", execute(command) {
      command.registerCleanup!(async () => { draining.resolve(); await release.promise; cleaned = true; throw undefined; });
      entered.resolve();
      return new Promise<CommandResult>(() => {});
    } });
    commands.register({ name: "parent", execute(command) { return command.invoke!("child", [], { signal: local.signal }); } });
    const execution = shell.exec("parent", { signal: caller.signal });
    const checked = execution.then(() => assert.fail("expected caller cancellation"), error => { assert.equal(error, reason); }).finally(() => { settled = true; });
    try {
      await entered.promise;
      caller.abort(reason);
      await draining.promise;
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(settled, false);
      assert.equal(cleaned, false);
    } finally { release.resolve(); }
    try { await checked; assert.equal(cleaned, true); }
    finally { await shell.dispose(); }
  });
}
