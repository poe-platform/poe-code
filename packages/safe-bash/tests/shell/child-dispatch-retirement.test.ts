import assert from "node:assert/strict";
import { test } from "node:test";
import { InvocationScope, throwCleanupFailures } from "../../src/shell/cleanup.js";
import { ArrayLedger } from "../../src/shell/arrays/ledger.js";
import { IndexedBinding } from "../../src/shell/arrays/bindings.js";
import { StateMonitor } from "../../src/shell/arrays/state.js";
import { setup } from "./helpers.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

test("settled children retire from a still-open parent without reopening admission", async () => {
  const root = new InvocationScope();
  const child = root.child();
  let cleaned = 0;
  child.register(() => { cleaned++; });
  await child.close();
  let revisited = 0;
  const drain = child.drainWork.bind(child);
  child.drainWork = () => { revisited++; return drain(); };
  await root.drainWork();
  assert.equal(revisited, 0);
  assert.equal(cleaned, 1);
  assert.throws(() => child.register(() => {}));
  assert.throws(() => child.child());
  assert.throws(() => child.run(async () => {}));
  await root.child().close();
  await root.close();
  assert.equal(cleaned, 1);
});

for (const reason of [undefined, null, false, 0, ""]) {
  test(`retired child preserves cleanup failure ${String(reason)} for root`, async () => {
    const root = new InvocationScope();
    const child = root.child();
    child.register(() => { throw reason; });
    await child.close();
    await child.cleanup(() => { throw reason; });
    await root.child().close();
    await root.close();
    assert.deepEqual(root.failures, [reason, reason]);
    assert.throws(() => throwCleanupFailures(root.failures), error => error instanceof AggregateError && error.errors.length === 2 && error.errors.every(value => Object.is(value, reason)));
  });
}

test("child cleanup and admitted work remain joined during parent close", async () => {
  const root = new InvocationScope();
  const child = root.child();
  const release = deferred();
  const cleaning = deferred();
  let finished = false;
  child.register(async () => { cleaning.resolve(); await release.promise; });
  const operation = child.run(async () => { await release.promise; });
  const closing = root.close().then(() => { finished = true; });
  await cleaning.promise;
  assert.equal(finished, false);
  assert.throws(() => child.run(async () => {}));
  release.resolve();
  await Promise.all([operation, closing]);
  assert.equal(finished, true);
});

test("work admitted synchronously while close starts is still joined", async () => {
  const root = new InvocationScope();
  const release = deferred();
  let finished = false;
  const operation = root.run(() => {
    void root.close().then(() => { finished = true; });
    return release.promise;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  release.resolve();
  await operation;
  await root.close();
  assert.equal(finished, true);
});

test("four settled invocations plateau active snapshot bookkeeping before root returns", async context => {
  const ledgers = new Set<ArrayLedger>();
  const reserve = ArrayLedger.prototype.reserve;
  context.mock.method(ArrayLedger.prototype, "reserve", function(this: ArrayLedger, ...args: Parameters<typeof reserve>) {
    ledgers.add(this);
    return Reflect.apply(reserve, this, args);
  });
  const samples: number[][] = [];
  const { shell, commands } = setup();
  commands.register({ name: "fanout", async execute(command) {
    for (let index = 0; index < 4; index++) {
      assert.equal((await command.invoke!("true", [])).exitCode, 0);
      samples.push([0, 1, 2, 3].map(counter => [...ledgers].reduce((total, ledger) => total + ledger.snapshot().used[counter]!, 0)));
    }
    assert.deepEqual(samples[2], samples[1]);
    assert.deepEqual(samples[3], samples[1]);
    return { exitCode: 0 };
  } });
  const result = await shell.exec("fanout");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(samples.length, 4);
  for (const ledger of ledgers) assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
});

test("settled child monitor callbacks do not remain captured by the root", async context => {
  let childClosures = 0;
  let beforeRootReturn = 0;
  const close = StateMonitor.prototype.closeValues;
  context.mock.method(StateMonitor.prototype, "closeValues", function(this: StateMonitor) {
    if (this.raw.depth > 0) childClosures++;
    return Reflect.apply(close, this, []);
  });
  const { shell, commands } = setup();
  commands.register({ name: "fanout", async execute(command) {
    for (let index = 0; index < 4; index++) await command.invoke!("true", []);
    beforeRootReturn = childClosures;
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("fanout")).exitCode, 0);
  assert.ok(beforeRootReturn >= 4);
  assert.equal(childClosures, beforeRootReturn);
});

test("child snapshots release saved local binding references without altering parent restoration", async context => {
  const savedBindings = new Set<IndexedBinding>();
  const retain = IndexedBinding.prototype.retain;
  context.mock.method(IndexedBinding.prototype, "retain", function(this: IndexedBinding) {
    if (this.get(0) === "root") savedBindings.add(this);
    return Reflect.apply(retain, this, []);
  });
  const samples: number[] = [];
  const { shell, commands } = setup();
  commands.register({ name: "fanout", async execute(command) {
    const before = [...savedBindings].reduce((sum, binding) => sum + binding.references, 0);
    for (let index = 0; index < 4; index++) {
      await command.invoke!("true", []);
      samples.push([...savedBindings].reduce((sum, binding) => sum + binding.references, 0));
    }
    assert.deepEqual(samples, [before, before, before, before]);
    return { exitCode: 0 };
  } });
  const result = await shell.exec('values=(root); f() { local -a values; values=(local); fanout; say "${values[@]}"; }; f; say "${values[@]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "local\nroot\n");
  assert.equal(samples.length, 4);
});

test("child array mutations and returned output survive independent snapshot retirement", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "fanout", async execute(command) {
    await command.invoke!("change", []);
    await command.invoke!("read_parent", []);
    return { exitCode: 0 };
  } });
  const result = await shell.exec('values=(root second); change() { values[0]=child; say "${values[@]}"; }; read_parent() { say "${values[@]}"; }; fanout; say "${values[@]}"');
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "child second\nroot second\nroot second\n");
});

test("root still reports failure from a child closed before a later sibling succeeds", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "fail-cleanup", execute(command) {
    command.registerCleanup!(() => { throw false; });
    return { exitCode: 0 };
  } });
  commands.register({ name: "fanout", async execute(command) {
    await command.invoke!("fail-cleanup", []);
    await command.invoke!("true", []);
    return { exitCode: 0 };
  } });
  await assert.rejects(shell.exec("fanout"), error => Object.is(error, false));
});

test("unawaited admitted child cleanup is joined before parent returns", async () => {
  const { shell, commands } = setup();
  const cleaning = deferred();
  const release = deferred();
  let settled = false;
  commands.register({ name: "child", execute(command) {
    command.registerCleanup!(async () => { cleaning.resolve(); await release.promise; });
    return { exitCode: 0 };
  } });
  commands.register({ name: "fanout", async execute(command) {
    void command.invoke!("child", []);
    await cleaning.promise;
    return { exitCode: 0 };
  } });
  const pending = shell.exec("fanout").then(result => { settled = true; return result; });
  await cleaning.promise;
  assert.equal(settled, false);
  release.resolve();
  assert.equal((await pending).exitCode, 0);
});

test("failed child environment setup retires before a successful sibling", async context => {
  let closures = 0;
  let retired = 0;
  const close = StateMonitor.prototype.closeValues;
  context.mock.method(StateMonitor.prototype, "closeValues", function(this: StateMonitor) {
    closures++;
    return Reflect.apply(close, this, []);
  });
  const { shell, commands } = setup({ env: { KEEP: "parent" } });
  commands.register({ name: "fanout", async execute(command) {
    for (let index = 0; index < 4; index++) {
      const before = closures;
      await assert.rejects(command.invoke!("true", [], { env: { "invalid=key": "x" } }), TypeError);
      assert.ok(closures > before);
      await command.invoke!("envget", ["KEEP"]);
    }
    retired = closures;
    return { exitCode: 0 };
  } });
  const result = await shell.exec("fanout");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "parentparentparentparent");
  assert.equal(closures, retired + 1);
});

for (const reason of [false, 0]) {
  test(`array restoration and child cleanup join parent cancellation ${reason}`, async () => {
    const { shell, commands } = setup();
    const controller = new AbortController();
    const entered = deferred();
    const cleaning = deferred();
    const release = deferred();
    let cleaned = 0;
    let settled = false;
    commands.register({ name: "hold", execute(command) {
      command.registerCleanup!(async () => { cleaned++; cleaning.resolve(); await release.promise; });
      return new Promise<{ exitCode: number }>((_resolve, reject) => {
        command.signal.addEventListener("abort", () => reject(command.signal.reason), { once: true });
        entered.resolve();
      });
    } });
    commands.register({ name: "fanout", execute(command) { return command.invoke!("child", []); } });
    const pending = shell.exec('values=(root); child() { local -a values; values=(child); hold; }; parent() { local -a values; values=(parent); fanout; }; parent', { signal: controller.signal }).then(
      result => { settled = true; return { kind: "return" as const, result }; },
      (error: unknown) => { settled = true; return { kind: "throw" as const, error }; },
    );
    await entered.promise;
    controller.abort(reason);
    await cleaning.promise;
    assert.equal(settled, false);
    release.resolve();
    const outcome = await pending;
    assert.equal(outcome.kind, "throw");
    assert.ok(outcome.kind === "throw" && Object.is(outcome.error, reason));
    assert.equal(cleaned, 1);
  });
}
