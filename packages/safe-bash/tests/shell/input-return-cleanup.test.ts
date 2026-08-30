import assert from "node:assert/strict";
import { test } from "node:test";
import type { ByteSource } from "../../src/contracts/index.js";
import { grepCommands } from "../../src/commands/grep.js";
import { createGrepAliasCommands } from "../../src/commands/grep-aliases/index.js";
import { ShellInput } from "../../src/shell/input.js";
import { Budget, defaultLimits } from "../../src/shell/runtime.js";
import { setup } from "./helpers.js";

function deferred<Value = void>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const bytes = new TextEncoder().encode("keep:01\n");
const failures: readonly { label: string; reason: unknown }[] = [
  { label: "Error", reason: new Error("external return sentinel") },
  { label: "undefined", reason: undefined },
  { label: "null", reason: null },
  { label: "false", reason: false },
  { label: "zero", reason: 0 },
  { label: "empty", reason: "" },
  { label: "NaN", reason: NaN },
  { label: "object", reason: { externalReturn: true } },
];

for (const style of ["throw", "reject"] as const) {
  for (const { label, reason } of failures) {
    test(`unread external return ${style} preserves ${label} identity`, { timeout: 2000 }, async () => {
      const { shell } = setup();
      let reads = 0, returns = 0;
      const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
        async next() { reads++; return { done: false, value: bytes }; },
        return() { returns++; if (style === "throw") throw reason; return Promise.reject(reason); },
      }; } };
      try {
        await assert.rejects(shell.exec("true", { stdin }), (error: unknown) => Object.is(error, reason));
        assert.equal(reads, 0);
        assert.equal(returns, 1);
      } finally { await shell.dispose(); }
    });
  }
  for (const definition of [...grepCommands(), ...createGrepAliasCommands()]) {
    test(`${definition.name} early stop preserves external return ${style}`, { timeout: 3000 }, async () => {
      const { shell, commands } = setup();
      commands.register(definition);
      const reason = new Error(`${definition.name} external return`);
      let returns = 0;
      const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
        async next() { return { done: false, value: bytes }; },
        return() { returns++; if (style === "throw") throw reason; return Promise.reject(reason); },
      }; } };
      try {
        await assert.rejects(shell.exec(`${definition.name} -q keep`, { stdin }), (error: unknown) => error === reason);
        assert.equal(returns, 1);
      } finally { await shell.dispose(); }
    });
  }
}

test("nonzero command result does not erase an awaited external return failure", { timeout: 2000 }, async () => {
  const { shell } = setup();
  const reason = new Error("return after nonzero result");
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: true, value: undefined }; },
    async return() { throw reason; },
  }; } };
  try { await assert.rejects(shell.exec("status 7", { stdin }), (error: unknown) => error === reason); }
  finally { await shell.dispose(); }
});

test("owning close shares a rejected completion and returns once", { timeout: 2000 }, async () => {
  const reason = new Error("idempotent external return");
  let returns = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: bytes }; },
    async return() { returns++; throw reason; },
  }; } };
  const owner = new ShellInput(source, new Budget(defaultLimits));
  const first = owner.close(), second = owner.close();
  assert.equal(first, second);
  await assert.rejects(first, (error: unknown) => error === reason);
  await assert.rejects(second, (error: unknown) => error === reason);
  await assert.rejects(owner.close(), (error: unknown) => error === reason);
  assert.equal(returns, 1);
});

test("EOF does not call an unnecessary rejecting return", { timeout: 2000 }, async () => {
  const { shell } = setup();
  let reads = 0, returns = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return reads++ === 0 ? { done: false, value: bytes } : { done: true, value: undefined }; },
    async return() { returns++; throw new Error("unnecessary return"); },
  }; } };
  try {
    const result = await shell.exec("pass", { stdin });
    assert.equal(result.stdout, "keep:01\n"); assert.equal(result.exitCode, 0); assert.equal(returns, 0);
  } finally { await shell.dispose(); }
});

test("selected execution rejection outranks an external close rejection", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  let primary: unknown;
  const secondary = new Error("secondary return");
  commands.register({ name: "overbudget", async execute(context) {
    try { await context.stdout.write(bytes); }
    catch (error) { primary = error; throw error; }
    return { exitCode: 0 };
  } });
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: bytes }; },
    async return() { throw secondary; },
  }; } };
  try {
    await assert.rejects(shell.exec("overbudget", { stdin, limits: { maxOutputBytes: 0 } }), (error: unknown) => {
      assert.equal(error, primary); assert.match(String(error), /maxOutputBytes/u); return true;
    });
  } finally { await shell.dispose(); }
});

test("a reported primary read failure is not replaced by a secondary return failure", { timeout: 2000 }, async () => {
  const { shell } = setup();
  let returns = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { throw new Error("primary source read"); },
    async return() { returns++; throw new Error("secondary source return"); },
  }; } };
  try {
    const result = await shell.exec("pass", { stdin });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /primary source read/u);
    assert.doesNotMatch(result.stderr, /secondary source return/u);
    assert.equal(returns, 1);
  } finally { await shell.dispose(); }
});

test("caller abort during an awaited return wins and observes its late rejection", { timeout: 2000 }, async () => {
  const { shell } = setup();
  const controller = new AbortController(), entered = deferred(), returned = deferred<IteratorResult<Uint8Array>>();
  let returns = 0;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: bytes }; },
    return() { returns++; entered.resolve(); return returned.promise; },
  }; } };
  const execution = assert.rejects(shell.exec("true", { stdin, signal: controller.signal }), (error: unknown) => error === 0);
  try {
    await entered.promise; controller.abort(0); await execution;
    assert.equal(returns, 1);
    returned.reject(new Error("late external return")); await turn(); await turn();
  } finally { returned.resolve({ done: true, value: undefined }); await execution; await shell.dispose(); }
});

test("disposal still interrupts an unregistered external return wait", { timeout: 2000 }, async () => {
  const { shell } = setup();
  const entered = deferred(), returned = deferred<IteratorResult<Uint8Array>>();
  let completed = false;
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: bytes }; },
    async return() { entered.resolve(); const result = await returned.promise; completed = true; return result; },
  }; } };
  const execution = assert.rejects(shell.exec("true", { stdin }), /Shell is disposed/u);
  try {
    await entered.promise; await shell.dispose(); await execution; assert.equal(completed, false);
  } finally { returned.resolve({ done: true, value: undefined }); await execution; await shell.dispose(); }
});

test("pending opaque next does not force awaiting a rejected return", { timeout: 2000 }, async () => {
  const { shell } = setup();
  const controller = new AbortController(), reading = deferred(), pending = deferred<IteratorResult<Uint8Array>>();
  let returns = 0;
  const reason = { caller: "pending source" };
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { reading.resolve(); return pending.promise; },
    async return() { returns++; throw new Error("abandoned return"); },
  }; } };
  const execution = assert.rejects(shell.exec("pass", { stdin, signal: controller.signal }), (error: unknown) => error === reason);
  try {
    await reading.promise; controller.abort(reason); await execution; assert.equal(returns, 1);
    pending.reject(new Error("abandoned next")); await turn(); await turn();
  } finally { pending.resolve({ done: true, value: undefined }); await execution; await shell.dispose(); }
});

test("opaque generator queued return remains outside the public abort barrier", { timeout: 2000 }, async () => {
  const { shell } = setup();
  const controller = new AbortController(), reading = deferred(), releaseRead = deferred(), releaseFinally = deferred();
  let finalized = false;
  const stdin = (async function* () {
    try { reading.resolve(); await releaseRead.promise; yield bytes; }
    finally { await releaseFinally.promise; finalized = true; }
  })();
  const reason = new Error("caller while generator next pending");
  const execution = assert.rejects(shell.exec("pass", { stdin, signal: controller.signal }), (error: unknown) => error === reason);
  try {
    await reading.promise; controller.abort(reason); await execution; await shell.dispose(); assert.equal(finalized, false);
  } finally { releaseRead.resolve(); releaseFinally.resolve(); await execution; await stdin.return(); await shell.dispose(); }
  assert.equal(finalized, true);
});

test("sequential borrowers retain the cursor until one final rejecting owner close", { timeout: 2000 }, async () => {
  const { shell, commands } = setup();
  const primary = new Error("final owning close");
  let reads = 0, returns = 0;
  const observed: number[] = [];
  const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
    async next() { return { done: false, value: Uint8Array.from([65 + reads++]) }; },
    async return() { returns++; throw primary; },
  }; } };
  commands.register({ name: "one", async execute(context) {
    for await (const chunk of context.stdin) { await context.stdout.write(chunk); break; }
    observed.push(returns);
    return { exitCode: 0 };
  } });
  const output: number[] = [];
  try {
    await assert.rejects(shell.exec("one; one", { stdin, stdout: { async write(chunk) { output.push(...chunk); } } }), (error: unknown) => error === primary);
    assert.deepEqual(output, [65, 66]); assert.deepEqual(observed, [0, 0]); assert.equal(reads, 2); assert.equal(returns, 1);
  } finally { await shell.dispose(); }
});

for (const primary of [false, true]) {
  for (const [index, { label, reason }] of failures.entries()) {
    test(`Shell stdin cleanup characterization: primary=${primary}, ${label}`, { timeout: 2000 }, async () => {
      const { shell } = setup();
      const entered = deferred(), release = deferred();
      const secondary = primary ? failures[(index + 1) % failures.length]!.reason : reason;
      let reads = 0, returns = 0, diagnostics = 0, settled = false;
      const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
        async next() { reads++; return { done: false, value: bytes }; },
        async return() { returns++; entered.resolve(); await release.promise; throw secondary; },
      }; } };
      const operation = shell.exec(primary ? "true\n'" : "status 7", {
        stdin, stderr: { async write() { diagnostics++; throw reason; } },
      });
      void operation.then(() => { settled = true; }, () => { settled = true; });
      try {
        await entered.promise;
        await turn();
        assert.equal(settled, false);
        assert.equal(returns, 1);
        assert.equal(reads, 0);
        release.resolve();
        await assert.rejects(operation, error => Object.is(error, reason));
        assert.equal(diagnostics, primary ? 1 : 0);
        assert.equal(returns, 1);
      } finally { release.resolve(); await operation.catch(() => {}); await shell.dispose(); }
    });
  }
}

for (const { label, reason } of failures) {
  test(`Shell stdin cleanup characterization: invocation-owned cancellation, ${label}`, { timeout: 2000 }, async () => {
    const { shell, commands } = setup();
    const controller = new AbortController();
    const ownedEntered = deferred(), ownedRelease = deferred();
    const inputEntered = deferred(), inputRelease = deferred();
    let ownedCalls = 0, inputCalls = 0, inputCleaned = false, settled = false;
    let inputCleanup: Promise<IteratorResult<Uint8Array>> | undefined;
    commands.register({ name: "owned-stop", async execute(context) {
      context.registerCleanup!(async () => { ownedCalls++; ownedEntered.resolve(); await ownedRelease.promise; });
      return { exitCode: 7 };
    } });
    const stdin: ByteSource = { [Symbol.asyncIterator]() { return {
      async next() { return { done: false, value: bytes }; },
      return() {
        inputCalls++;
        inputCleanup = (async () => {
          inputEntered.resolve(); await inputRelease.promise; inputCleaned = true;
          throw new Error("late opaque input return");
        })();
        return inputCleanup;
      },
    }; } };
    const operation = shell.exec("owned-stop", { stdin, signal: controller.signal });
    void operation.then(() => { settled = true; }, () => { settled = true; });
    try {
      await ownedEntered.promise;
      controller.abort(reason);
      await inputEntered.promise;
      await turn();
      assert.equal(settled, false);
      assert.equal(ownedCalls, 1);
      assert.equal(inputCalls, 1);
      ownedRelease.resolve();
      await assert.rejects(operation, error => Object.is(error, controller.signal.reason));
      assert.equal(inputCleaned, false);
    } finally {
      ownedRelease.resolve(); inputRelease.resolve();
      await operation.catch(() => {}); await inputCleanup?.catch(() => {}); await shell.dispose();
    }
    assert.equal(inputCleaned, true);
    assert.equal(ownedCalls, 1);
    assert.equal(inputCalls, 1);
  });
}
