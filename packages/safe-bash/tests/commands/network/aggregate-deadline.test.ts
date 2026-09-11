import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { FsError, toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { registerYieldCheckpoint } from "../../../src/contracts/yield.js";
import { createCurlCommand } from "../../../src/commands/network/curl.js";
import { cloudflareWorkerNetworkLimits, defaultNetworkLimits, type HttpResponse, type NetworkLimits } from "../../../src/commands/network/types.js";

const url = "https://offline.invalid/start";

function clock(context: TestContext) {
  let now = 0;
  context.mock.timers.enable({ apis: ["setTimeout"] });
  context.mock.method(performance, "now", () => now);
  return {
    advance(milliseconds: number) { now += milliseconds; context.mock.timers.tick(milliseconds); },
  };
}

function gate<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>(accept => { resolve = accept; });
  return { promise, resolve };
}

function reply(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return { status: 200, statusText: "OK", headers: [], body: toByteSource("payload"), async dispose() {}, ...overrides };
}

function invocation(executionScope?: object, overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    command: "curl", args: [url], cwd: "/", env: {}, fs: new MemoryFileSystem(),
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal, ...(executionScope ? { executionScope } : {}), ...overrides,
  };
}

function limits(maxTotalTimeMs = 100): Partial<NetworkLimits> {
  return { maxTimeMs: 1_000, maxTotalTimeMs };
}

test("aggregate defaults and Worker profile are independent host deadlines", () => {
  assert.equal(defaultNetworkLimits.maxTotalTimeMs, 120_000);
  assert.equal(cloudflareWorkerNetworkLimits.maxTotalTimeMs, 10_000);
});

test("normal deadline cleanup preserves a completed transport's live signal", async context => {
  const time = clock(context);
  let signal: AbortSignal | undefined;
  let disposed = 0;
  const command = createCurlCommand({ authorize: () => true, limits: limits(), async transport(request) {
    signal = request.signal;
    return reply({ async dispose() { disposed++; } });
  } });
  assert.equal((await command.execute(invocation())).exitCode, 0);
  assert.equal(disposed, 1);
  assert.equal(signal?.aborted, false);
  time.advance(1_000);
  assert.equal(signal?.aborted, false);
});

test("deadline write-out preserves preclosed stdout EPIPE after required file output", async context => {
  const time = clock(context);
  const consumer = new AbortController();
  consumer.abort(new FsError("EPIPE"));
  const diagnostics: Uint8Array[] = [];
  const input = invocation(undefined, {
    args: ["-o", "/body", "-w", "%{http_code}", url],
    stdout: { async write() { assert.fail("closed stdout must not be written"); }, ownedOutput: {
      consumerClosed: consumer.signal,
      async write() { assert.fail("closed owned stdout must not be written"); },
    } },
    stderr: { async write(chunk) { diagnostics.push(chunk.slice()); } },
  });
  const command = createCurlCommand({ authorize: () => true, limits: limits(), async transport() { return reply(); } });
  assert.equal((await command.execute(input)).exitCode, 141);
  assert.equal(new TextDecoder().decode(await input.fs.readFile("/body")), "payload");
  assert.deepEqual(diagnostics, []);
  time.advance(1_000);
});

for (const invalid of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`aggregate rejects invalid host limit ${invalid}`, () => {
    assert.throws(() => createCurlCommand({ authorize: () => true, limits: limits(invalid) }), RangeError);
  });
}

test("URLs cannot reset the invocation deadline or admit a later URL after exhaustion", async context => {
  const time = clock(context);
  let requests = 0;
  const command = createCurlCommand({ authorize: () => true, limits: limits(), async transport() {
    requests++;
    time.advance(60);
    return reply();
  } });
  const result = await command.execute(invocation(undefined, { args: [url, url, url] }));
  assert.equal(result.exitCode, 28);
  assert.equal(requests, 2);
});

test("sequential invocations share only the borrowed execution identity", async context => {
  const time = clock(context);
  let requests = 0;
  const scope = Object.freeze({});
  const command = createCurlCommand({ authorize: () => true, limits: limits(), async transport() {
    requests++;
    return reply();
  } });
  assert.equal((await command.execute(invocation(scope))).exitCode, 0);
  time.advance(100);
  assert.equal((await command.execute(invocation(scope))).exitCode, 28);
  assert.equal(requests, 1);
  assert.equal((await command.execute(invocation(Object.freeze({})))).exitCode, 0);
  assert.equal((await command.execute(invocation())).exitCode, 0);
  time.advance(100);
  assert.equal((await command.execute(invocation())).exitCode, 0);
});

test("help and rejected arguments do not start a scope deadline", async context => {
  const time = clock(context);
  const scope = Object.freeze({});
  const command = createCurlCommand({ authorize: () => true, limits: limits(), async transport() { return reply(); } });
  assert.equal((await command.execute(invocation(scope, { args: ["--help"] }))).exitCode, 0);
  assert.equal((await command.execute(invocation(scope, { args: ["--unsupported"] }))).exitCode, 2);
  time.advance(500);
  assert.equal((await command.execute(invocation(scope))).exitCode, 0);
});

test("parallel calls share the first admission deadline but distinct scopes do not", async context => {
  const time = clock(context);
  const pending = gate<HttpResponse>();
  const admissions = [gate<AbortSignal>(), gate<AbortSignal>(), gate<AbortSignal>()];
  let requests = 0;
  const scope = Object.freeze({});
  const command = createCurlCommand({ authorize: () => true, limits: limits(), transport(request) {
    admissions[requests++]!.resolve(request.signal);
    return pending.promise;
  } });
  const first = command.execute(invocation(scope));
  const firstSignal = await admissions[0]!.promise;
  time.advance(60);
  const second = command.execute(invocation(scope));
  const secondSignal = await admissions[1]!.promise;
  const independent = command.execute(invocation(Object.freeze({})));
  const independentSignal = await admissions[2]!.promise;
  time.advance(40);
  const aborted = [firstSignal.aborted, secondSignal.aborted, independentSignal.aborted];
  pending.resolve(reply());
  const outcomes = await Promise.all([first, second, independent]);
  assert.deepEqual(aborted, [true, true, false]);
  assert.deepEqual(outcomes.map(result => result.exitCode), [28, 28, 0]);
});

for (const phase of ["authorization", "body", "output"] as const) {
  test(`aggregate bounds pending ${phase} and releases the response`, async context => {
    const time = clock(context);
    const pending = gate<void>();
    const entered = gate<AbortSignal>();
    let signal!: AbortSignal;
    let disposed = 0;
    const command = createCurlCommand({ limits: limits(), async authorize(request) {
      signal = request.signal;
      if (phase === "authorization") { entered.resolve(signal); await pending.promise; }
      return true;
    }, async transport() {
      return reply({ body: (async function* () {
        if (phase === "body") { entered.resolve(signal); await pending.promise; }
        yield Uint8Array.of(0, 255, 128);
      })(), async dispose() { disposed++; } });
    } });
    const result = command.execute(invocation(undefined, { stdout: { async write() {
      if (phase === "output") { entered.resolve(signal); await pending.promise; }
    } } }));
    const active = await entered.promise;
    time.advance(100);
    const aborted = active.aborted;
    pending.resolve();
    const outcome = await result;
    assert.equal(aborted, true);
    assert.equal(outcome.exitCode, 28);
    assert.equal(disposed, phase === "authorization" ? 0 : 1);
  });
}

test("late transport acquisition is disposed once before timeout settlement", async context => {
  const time = clock(context);
  const pending = gate<HttpResponse>();
  const entered = gate<AbortSignal>();
  let disposed = 0;
  let settled = false;
  const command = createCurlCommand({ authorize: () => true, limits: limits(), transport(request) {
    entered.resolve(request.signal);
    return pending.promise;
  } });
  const result = Promise.resolve(command.execute(invocation())).then(value => { settled = true; return value; });
  const signal = await entered.promise;
  time.advance(100);
  await Promise.resolve();
  assert.equal(settled, false);
  pending.resolve(reply({ async dispose() { disposed++; } }));
  const outcome = await result;
  assert.equal(signal.aborted, true);
  assert.equal(outcome.exitCode, 28);
  assert.equal(disposed, 1);
});

test("per-URL max-time stays smaller than a huge aggregate and does not overflow timers", async context => {
  const time = clock(context);
  const pending = gate<HttpResponse>();
  const entered = gate<AbortSignal>();
  const command = createCurlCommand({ authorize: () => true, limits: limits(Number.MAX_SAFE_INTEGER), transport(request) {
    entered.resolve(request.signal);
    return pending.promise;
  } });
  const result = command.execute(invocation(undefined, { args: ["--max-time", "0.05", url] }));
  const signal = await entered.promise;
  time.advance(49);
  assert.equal(signal.aborted, false);
  time.advance(1);
  pending.resolve(reply());
  assert.equal((await result).exitCode, 28);
});

for (const phase of ["write-out", "diagnostic", "dump-header"] as const) {
  test(`aggregate also bounds ${phase} backpressure`, async context => {
    const time = clock(context);
    const entered = gate<void>();
    const pending = gate<void>();
    let signal!: AbortSignal;
    let disposed = 0;
    const command = createCurlCommand({ authorize: () => true, limits: limits(), async transport(request) {
      signal = request.signal;
      return reply({ status: phase === "diagnostic" ? 500 : 200, body: toByteSource(""), async dispose() { disposed++; } });
    } });
    let settled = false;
    const sink = { async write() { entered.resolve(); await pending.promise; } };
    const args = phase === "write-out" ? ["-w", "%{http_code}", url]
      : phase === "diagnostic" ? ["-f", url] : ["-D", "-", url];
    const result = Promise.resolve(command.execute(invocation(undefined, {
      args, ...(phase === "diagnostic" ? { stderr: sink } : { stdout: sink }),
    }))).then(value => { settled = true; return value; });
    await entered.promise;
    assert.equal(disposed, phase === "dump-header" ? 0 : 1);
    assert.equal(signal.aborted, false);
    time.advance(100);
    for (let turn = 0; turn < 50; turn++) await Promise.resolve();
    const bounded = settled;
    pending.resolve();
    const outcome = await result;
    assert.equal(bounded, true, "opaque output cannot keep curl pending beyond the network deadline");
    assert.equal(signal.aborted, phase === "dump-header");
    assert.equal(disposed, 1);
    assert.equal(outcome.exitCode, 28);
  });
}

test("redirect hops use the original authorization policy and aggregate deadline", async context => {
  const time = clock(context);
  const authorizations: { url: string; redirectFrom?: string }[] = [];
  let disposed = 0;
  const command = createCurlCommand({ limits: limits(), authorize(request) {
    authorizations.push(request);
    return true;
  }, async transport() {
    time.advance(60);
    return reply({ status: 302, headers: [["Location", "/next"]], async dispose() { disposed++; } });
  } });
  const outcome = await command.execute(invocation(undefined, { args: ["-L", url] }));
  assert.equal(outcome.exitCode, 28);
  assert.equal(authorizations.length, 2);
  assert.equal(authorizations[1]!.redirectFrom, url);
  assert.equal(disposed, 2);
});

test("retry delay consumes aggregate time without readmitting a request", async context => {
  const time = clock(context);
  const entered = gate<void>();
  let requests = 0;
  const command = createCurlCommand({ authorize: () => true, limits: limits(), async transport() {
    requests++;
    return reply({ status: 503, async dispose() { entered.resolve(); } });
  } });
  const result = command.execute(invocation(undefined, { args: ["--retry", "2", url] }));
  await entered.promise;
  for (let turn = 0; turn < 10; turn++) await Promise.resolve();
  time.advance(100);
  assert.equal((await result).exitCode, 28);
  assert.equal(requests, 1);
});

for (const reason of [null, false, 0, "", new Error("caller")]) {
  test(`caller cancellation preserves identity over aggregate timeout: ${String(reason)}`, async context => {
    const time = clock(context);
    const entered = gate<void>();
    const pending = gate<HttpResponse>();
    const controller = new AbortController();
    const command = createCurlCommand({ authorize: () => true, limits: limits(), transport() {
      entered.resolve();
      return pending.promise;
    } });
    const result = Promise.resolve(command.execute(invocation(undefined, { signal: controller.signal })))
      .then(value => ({ value }), error => ({ error }));
    await entered.promise;
    time.advance(100);
    controller.abort(reason);
    pending.resolve(reply());
    const outcome = await result;
    assert.ok("error" in outcome);
    assert.equal(outcome.error, reason);
  });
}

for (const reason of [undefined, null, false, 0, ""]) {
  test(`falsey response cleanup failure is not replaced by timeout: ${String(reason)}`, async context => {
    const time = clock(context);
    const command = createCurlCommand({ authorize: () => true, limits: limits(), async transport() {
      time.advance(100);
      return reply({ async dispose() { throw reason; } });
    } });
    const outcome = await Promise.resolve(command.execute(invocation())).then(value => ({ value }), error => ({ error }));
    assert.ok("error" in outcome);
    assert.equal(outcome.error, reason);
  });
}

test("completion clears its timers and preserves binary payload and timeout diagnostics", async context => {
  const time = clock(context);
  const timer = context.mock.method(globalThis, "setTimeout");
  const clear = context.mock.method(globalThis, "clearTimeout");
  const signals: AbortSignal[] = [];
  const chunks: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const command = createCurlCommand({ authorize: () => true, limits: limits(), async transport(request) {
    signals.push(request.signal);
    return reply({ body: toByteSource(Uint8Array.of(0, 255, 128)) });
  } });
  const scope = Object.freeze({});
  assert.equal((await command.execute(invocation(scope, { stdout: { async write(chunk) { chunks.push(chunk.slice()); } } }))).exitCode, 0);
  for (const call of timer.mock.calls) assert.ok(clear.mock.calls.some(cleared => cleared.arguments[0] === call.result));
  assert.deepEqual(Buffer.concat(chunks), Buffer.from([0, 255, 128]));
  time.advance(100);
  assert.equal((await command.execute(invocation(scope, { stderr: { async write(chunk) { errors.push(chunk.slice()); } } }))).exitCode, 28);
  assert.equal(Buffer.concat(errors).toString(), "curl: (28) Operation timed out\n");
  assert.equal(signals.length, 1);
});

test("curl body checkpoints retain the caller's shared CPU control signal", async () => {
  const controller = new AbortController();
  const fatal = new Error("shared CPU budget exhausted");
  let checkpoints = 0;
  registerYieldCheckpoint(controller.signal, () => { checkpoints++; controller.abort(fatal); });
  const command = createCurlCommand({ authorize: () => true, async transport() {
    return reply({ body: (async function* () {
      for (let index = 0; index < 300; index++) yield Uint8Array.of(97);
    })() });
  } });
  const outcome = await Promise.resolve(command.execute(invocation(undefined, { signal: controller.signal })))
    .then(value => ({ value }), error => ({ error }));
  assert.ok("error" in outcome);
  assert.equal(outcome.error, fatal);
  assert.equal(checkpoints, 1);
});

test("exhausted scopes bound stalled timeout diagnostics without readmitting the network", async context => {
  const time = clock(context);
  const scope = Object.freeze({});
  let requests = 0;
  const command = createCurlCommand({ authorize: () => true, limits: limits(), async transport() { requests++; return reply(); } });
  await command.execute(invocation(scope));
  time.advance(100);
  const entered = gate<void>();
  const pending = gate<void>();
  let settled = false;
  const result = Promise.resolve(command.execute(invocation(scope, { stderr: { async write() {
    entered.resolve();
    await pending.promise;
  } } }))).then(value => { settled = true; return value; });
  await entered.promise;
  time.advance(1);
  for (let turn = 0; turn < 30; turn++) await Promise.resolve();
  const bounded = settled;
  pending.resolve();
  assert.equal((await result).exitCode, 28);
  assert.equal(bounded, true);
  assert.equal(requests, 1);
});

test("monotonic expiry blocks transport admission even before the timer turn", async context => {
  let now = 0;
  context.mock.method(performance, "now", () => now);
  let requests = 0;
  const command = createCurlCommand({ limits: limits(), authorize() { now += 100; return true; }, async transport() {
    requests++;
    return reply();
  } });
  assert.equal((await command.execute(invocation())).exitCode, 28);
  assert.equal(requests, 0);
});

test("wall-clock jumps cannot expire or extend the aggregate monotonic deadline", async context => {
  const time = clock(context);
  let wall = 0;
  context.mock.method(Date, "now", () => wall);
  const scope = Object.freeze({});
  const command = createCurlCommand({ authorize: () => true, limits: limits(), async transport() { return reply(); } });
  assert.equal((await command.execute(invocation(scope))).exitCode, 0);
  wall = Number.MAX_SAFE_INTEGER;
  assert.equal((await command.execute(invocation(scope))).exitCode, 0);
  wall = 0;
  time.advance(100);
  assert.equal((await command.execute(invocation(scope))).exitCode, 28);
});

test("command factories do not share host budget authority through the same identity", async context => {
  const time = clock(context);
  const scope = Object.freeze({});
  const options = { authorize: () => true, limits: limits(), async transport() { return reply(); } };
  const first = createCurlCommand(options);
  const second = createCurlCommand(options);
  assert.equal((await first.execute(invocation(scope))).exitCode, 0);
  time.advance(100);
  assert.equal((await first.execute(invocation(scope))).exitCode, 28);
  assert.equal((await second.execute(invocation(scope))).exitCode, 0);
  assert.deepEqual(Reflect.ownKeys(scope), []);
});

for (const reason of [null, false, 0, "", new Error("caller during timeout reporting")]) {
  test(`caller cancellation wins during expired-scope reporting: ${String(reason)}`, async context => {
    const time = clock(context);
    const timers = context.mock.method(globalThis, "setTimeout");
    const cleared = context.mock.method(globalThis, "clearTimeout");
    const scope = Object.freeze({});
    let requests = 0;
    const command = createCurlCommand({ authorize: () => true, limits: limits(), async transport() { requests++; return reply(); } });
    await command.execute(invocation(scope));
    time.advance(100);
    const controller = new AbortController();
    const entered = gate<void>();
    const pending = gate<void>();
    const result = Promise.resolve(command.execute(invocation(scope, {
      signal: controller.signal,
      stderr: { async write() { entered.resolve(); await pending.promise; } },
    }))).then(value => ({ value }), error => ({ error }));
    await entered.promise;
    time.advance(1);
    controller.abort(reason);
    const outcome = await result;
    pending.resolve();
    assert.ok("error" in outcome);
    assert.equal(outcome.error, reason);
    assert.equal(requests, 1);
    assert.equal(timers.mock.calls.at(-1)!.arguments[1], 0);
    for (const call of timers.mock.calls) assert.ok(cleared.mock.calls.some(clear => clear.arguments[0] === call.result));
  });
}

for (const reason of [undefined, null, false, 0, ""]) {
  test(`expired-scope diagnostic preserves a falsey sink failure: ${String(reason)}`, async context => {
    const time = clock(context);
    const scope = Object.freeze({});
    const command = createCurlCommand({ authorize: () => true, limits: limits(), async transport() { return reply(); } });
    await command.execute(invocation(scope));
    time.advance(100);
    const outcome = await Promise.resolve(command.execute(invocation(scope, { stderr: { async write() { throw reason; } } })))
      .then(value => ({ value }), error => ({ error }));
    assert.ok("error" in outcome);
    assert.equal(outcome.error, reason);
  });
}

for (const timeoutFirst of [false, true]) {
  test(`caller cancellation wins after entering late acquisition cleanup: timeout first ${timeoutFirst}`, async context => {
    const time = clock(context);
    const entered = gate<void>();
    const pending = gate<HttpResponse>();
    const controller = new AbortController();
    const reason = timeoutFirst ? false : new Error("caller-primary");
    let disposed = 0;
    let settled = false;
    const command = createCurlCommand({ authorize: () => true, limits: limits(), transport() {
      entered.resolve();
      return pending.promise;
    } });
    const result = Promise.resolve(command.execute(invocation(undefined, { args: ["-s", url], signal: controller.signal })))
      .then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    await entered.promise;
    if (timeoutFirst) time.advance(100);
    else controller.abort(reason);
    await new Promise<void>(resolve => setImmediate(resolve));
    const premature = settled;
    if (timeoutFirst) controller.abort(reason);
    pending.resolve(reply({ async dispose() { disposed++; if (!timeoutFirst) throw 0; } }));
    const outcome = await result;
    assert.equal(premature, false);
    assert.equal(disposed, 1);
    assert.ok("error" in outcome);
    assert.equal(outcome.error, reason);
  });
}
