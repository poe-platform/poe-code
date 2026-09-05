import assert from "node:assert/strict";
import { test } from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { browserCommands } from "../../src/browser.js";
import { collectBytes, toByteSource, writeBytes } from "../../src/contracts/index.js";
import { ShellLimitError } from "../../src/shell/types.js";
import { ArrayLedger } from "../../src/shell/arrays/ledger.js";
import { setup } from "./helpers.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let turn = 0; turn < 32 && !predicate(); turn++) await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.equal(predicate(), true, "bounded microtask checkpoint was not reached");
}

function fixture(browser = false) {
  const result = setup();
  result.shell.use(browser ? browserCommands({ execution: { maxParallelProcesses: 2 } }) : standardCommands({ execution: { maxParallelProcesses: 2 } }));
  return result;
}

test("xargs keeps a slot until the actual invocation cleanup finishes", async () => {
  const { shell, commands } = fixture();
  const cleanup = deferred();
  const sibling = deferred();
  const starts: string[] = [];
  let cleaning = false;
  let settled = false;
  commands.register({ name: "held", async execute(context) {
    starts.push(context.args[0]!);
    if (context.args[0] === "one") context.registerCleanup!(() => { cleaning = true; return cleanup.promise; });
    else if (context.args[0] === "two") await sibling.promise;
    return { exitCode: 0 };
  } });
  const running = shell.exec("xargs -P2 -n1 held", { stdin: "one two three" });
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await until(() => cleaning || settled);
    assert.equal(cleaning, true);
    await until(() => starts.length === 2 || settled);
    assert.deepEqual(starts, ["one", "two"]);
    for (let turn = 0; turn < 100; turn++) await Promise.resolve();
    assert.equal(settled, false);
    assert.deepEqual(starts, ["one", "two"]);
    cleanup.resolve();
    await until(() => starts.length === 3 || settled);
    assert.equal(starts.length, 3);
  } finally { cleanup.resolve(); sibling.resolve(); await running.catch(() => {}); await shell.dispose(); }
  assert.equal((await running).exitCode, 0);
});

for (const reason of [undefined, null, false, 0, ""]) test(`caller cancellation ${String(reason)} drains all children and preserves reason`, async () => {
  const { shell, commands } = fixture();
  const controller = new AbortController();
  const cleanup = deferred();
  const release = deferred();
  const signals: AbortSignal[] = [];
  let cleaning = 0;
  let settled = false;
  commands.register({ name: "held", async execute(context) {
    signals.push(context.signal);
    context.registerCleanup!(() => { cleaning++; release.resolve(); return cleanup.promise; });
    await release.promise;
    context.signal.throwIfAborted();
    return { exitCode: 0 };
  } });
  const running = shell.exec("xargs -P2 -n1 held", { stdin: "one two three", signal: controller.signal });
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await until(() => signals.length === 2 || settled);
    assert.equal(signals.length, 2);
    controller.abort(reason);
    await until(() => cleaning === 2 || settled);
    assert.equal(cleaning, 2);
    assert.equal(settled, false);
    assert.equal(signals.every(signal => signal.aborted), true);
    cleanup.resolve();
    await assert.rejects(running, error => Object.is(error, controller.signal.reason));
  } finally { controller.abort(reason); release.resolve(); cleanup.resolve(); await running.catch(() => {}); await shell.dispose(); }
});

for (const reason of [undefined, null, false, 0, ""]) test(`actual shell keeps ordinary child error mapping: ${String(reason)}`, async () => {
  const { shell, commands } = fixture();
  const cleanup = deferred();
  let starts = 0;
  let cleaning = 0;
  let settled = false;
  commands.register({ name: "host-error", execute(context) {
    starts++;
    context.registerCleanup!(() => { cleaning++; return cleanup.promise; });
    throw reason;
  } });
  const running = shell.exec("xargs -P2 -n1 host-error", { stdin: "one two" });
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await until(() => cleaning === 2 || settled);
    assert.equal(cleaning, 2);
    assert.equal(starts, 2);
    assert.equal(settled, false);
    cleanup.resolve();
    const result = await running;
    assert.equal(result.exitCode, 123);
    assert.equal(result.stderr, `shell: line 1: ${String(reason)}\nshell: line 1: ${String(reason)}\n`);
  } finally { cleanup.resolve(); await running.catch(() => {}); await shell.dispose(); }
});

for (const terminal of [255, 126, 127]) test(`actual shell terminal ${terminal} drains sibling cleanup before settlement`, async () => {
  const { shell, commands } = fixture();
  const terminalRelease = deferred();
  const sibling = deferred();
  const cleanup = deferred();
  const signals: AbortSignal[] = [];
  let cleaned = false;
  let settled = false;
  commands.register({ name: "terminal", async execute(context) {
    signals.push(context.signal);
    if (context.args[0] === "one") { await terminalRelease.promise; return { exitCode: terminal }; }
    context.registerCleanup!(() => { cleaned = true; return cleanup.promise; });
    await sibling.promise;
    return { exitCode: 7 };
  } });
  const running = shell.exec("xargs -P2 -n1 terminal", { stdin: "one two three" });
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await until(() => signals.length === 2 || settled);
    assert.equal(signals.length, 2);
    terminalRelease.resolve();
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(signals[1]!.aborted, false);
    sibling.resolve();
    await until(() => cleaned || settled);
    assert.equal(cleaned, true);
    assert.equal(settled, false);
    cleanup.resolve();
    assert.equal((await running).exitCode, terminal === 255 ? 124 : terminal);
    assert.equal(signals.length, 2);
  } finally { terminalRelease.resolve(); sibling.resolve(); cleanup.resolve(); await running.catch(() => {}); await shell.dispose(); }
});

test("actual output backpressure retains invocation slots and raw bytes", async () => {
  const { shell, commands } = fixture();
  const release = deferred();
  const writes: number[][] = [];
  let starts = 0;
  let settled = false;
  commands.register({ name: "raw", async execute(context) {
    starts++;
    const bytes = Uint8Array.of(Number(context.args[0]), 255);
    await writeBytes(context.stdout, bytes, context.signal);
    bytes.fill(0);
    return { exitCode: 0 };
  } });
  const running = shell.exec("xargs -P2 -n1 raw", {
    stdin: "1 2 3", limits: { maxOutputBytes: 6 },
    stdout: { async write(bytes) { await release.promise; writes.push(Array.from(bytes)); } },
  });
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await until(() => starts === 2 || settled);
    assert.equal(starts, 2);
    assert.equal(settled, false);
    assert.deepEqual(writes, []);
    release.resolve();
    assert.equal((await running).exitCode, 0);
    assert.deepEqual(writes, [[1, 255], [2, 255], [3, 255]]);
  } finally { release.resolve(); await running.catch(() => {}); await shell.dispose(); }
});

test("repeated parallel waves retire child bookkeeping while their parent remains open", async context => {
  const { shell, commands } = fixture();
  const ledgers = new Set<ArrayLedger>();
  const reserve = ArrayLedger.prototype.reserve;
  context.mock.method(ArrayLedger.prototype, "reserve", function(this: ArrayLedger, ...args: Parameters<typeof reserve>) {
    ledgers.add(this);
    return Reflect.apply(reserve, this, args);
  });
  const samples: number[][] = [];
  commands.register({ name: "waves", async execute(command) {
    for (let wave = 0; wave < 4; wave++) {
      assert.equal((await command.invoke!("xargs", ["-P2", "-n1", "true"], { stdin: toByteSource("one two") })).exitCode, 0);
      samples.push([0, 1, 2, 3].map(counter => [...ledgers].reduce((total, ledger) => total + ledger.snapshot().used[counter]!, 0)));
    }
    assert.deepEqual(samples[2], samples[1]);
    assert.deepEqual(samples[3], samples[1]);
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("waves");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(samples.length, 4);
    for (const ledger of ledgers) assert.deepEqual(ledger.snapshot().used.slice(0, 4), [0, 0, 0, 0]);
  } finally { await shell.dispose(); }
});

for (const cancel of [false, true]) test(`parallel inline input joins delayed file completion, cancellation=${cancel}`, async context => {
  const { shell, fs } = fixture();
  const release = deferred();
  const controller = new AbortController();
  let finishing = false;
  let settled = false;
  let signal: AbortSignal | undefined;
  Object.defineProperty(fs, "capabilities", { value: { ...fs.capabilities, randomAccessWrite: false } });
  const writeStream = fs.writeStream.bind(fs);
  context.mock.method(fs, "writeStream", async (...args: Parameters<typeof writeStream>) => {
    signal = args[2]?.signal;
    try { await writeStream(...args); }
    finally { finishing = true; await release.promise; }
  });
  const running = shell.exec("xargs -P2 -n1 say >out <<EOF\none two\nEOF", { signal: controller.signal });
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await until(() => finishing || settled);
    assert.equal(finishing, true);
    assert.equal(signal?.aborted, false);
    assert.equal(settled, false);
    if (cancel) controller.abort(false);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(settled, false);
    release.resolve();
    if (cancel) await assert.rejects(running, error => error === false);
    else {
      assert.equal((await running).exitCode, 0);
      assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "one\ntwo\n");
    }
  } finally { release.resolve(); await running.catch(() => {}); await shell.dispose(); }
});

for (const reason of [undefined, null, false, 0, ""]) test(`child cleanup failure ${String(reason)} survives parallel drain`, async () => {
  const { shell, commands } = fixture();
  commands.register({ name: "cleanup-fails", execute(context) {
    if (context.args[0] === "one") context.registerCleanup!(() => { throw reason; });
    return { exitCode: 0 };
  } });
  try { await assert.rejects(shell.exec("xargs -P2 -n1 cleanup-fails", { stdin: "one two" }), error => Object.is(error, reason)); }
  finally { await shell.dispose(); }
});

test("parallel children share one command budget", async () => {
  const { shell, commands } = fixture();
  let calls = 0;
  commands.register({ name: "counted", execute() { calls++; return { exitCode: 0 }; } });
  try {
    await assert.rejects(shell.exec("xargs -P2 -n1 counted", { stdin: "one two three", limits: { maxCommands: 3 } }), error => error instanceof ShellLimitError && error.limit === "maxCommands");
    assert.equal(calls, 2);
  } finally { await shell.dispose(); }
});

test("caller cancellation during budget-failure cleanup keeps root precedence", async () => {
  const { shell, commands } = fixture();
  const controller = new AbortController();
  const trigger = deferred();
  const release = deferred();
  const cleanup = deferred();
  let starts = 0;
  let cleaning = 0;
  let settled = false;
  commands.register({ name: "budget-held", async execute(context) {
    starts++;
    context.registerCleanup!(() => { cleaning++; release.resolve(); return cleanup.promise; });
    if (context.args[0] === "one") { await trigger.promise; await writeBytes(context.stdout, Uint8Array.of(1, 2, 3), context.signal); }
    else await release.promise;
    return { exitCode: 0 };
  } });
  const running = shell.exec("xargs -P2 -n1 budget-held", { stdin: "one two three", signal: controller.signal, limits: { maxOutputBytes: 2 } });
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await until(() => starts === 2 || settled);
    assert.equal(starts, 2);
    trigger.resolve();
    await until(() => cleaning === 2 || settled);
    assert.equal(cleaning, 2);
    assert.equal(settled, false);
    controller.abort(0);
    cleanup.resolve();
    await assert.rejects(running, error => error === 0);
    assert.equal(starts, 2);
  } finally { trigger.resolve(); release.resolve(); cleanup.resolve(); await running.catch(() => {}); await shell.dispose(); }
});

test("cleanup failure is not hidden by a terminal child status", async () => {
  const { shell, commands } = fixture();
  const release = deferred();
  let starts = 0;
  let settled = false;
  commands.register({ name: "terminal-cleanup", async execute(context) {
    starts++;
    await release.promise;
    if (context.args[0] === "two") context.registerCleanup!(() => { throw false; });
    return { exitCode: 255 };
  } });
  const running = shell.exec("xargs -P2 -n1 terminal-cleanup", { stdin: "one two three" });
  void running.then(() => { settled = true; }, () => { settled = true; });
  try {
    await until(() => starts === 2 || settled);
    assert.equal(starts, 2);
    release.resolve();
    await assert.rejects(running, error => error === false);
    assert.equal(starts, 2);
  } finally { release.resolve(); await running.catch(() => {}); await shell.dispose(); }
});

for (const limit of [14, 13]) test(`verbose output shares the child byte budget: ${limit}`, async () => {
  const { shell, commands } = fixture();
  commands.register({ name: "raw", async execute(context) {
    await writeBytes(context.stdout, Uint8Array.of(255), context.signal);
    return { exitCode: 0 };
  } });
  try {
    const running = shell.exec("xargs -t -P2 -n1 raw", { stdin: "a b", limits: { maxOutputBytes: limit } });
    if (limit === 13) await assert.rejects(running, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    else {
      const result = await running;
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "raw a\nraw b\n");
      assert.equal(result.stdout.length, 2);
    }
  } finally { await shell.dispose(); }
});

for (const limit of [4, 3]) test(`parallel stdout/stderr use one output allowance: ${limit}`, async () => {
  const { shell, commands } = fixture();
  commands.register({ name: "emit", async execute(context) {
    await writeBytes(context.stdout, Uint8Array.of(255), context.signal);
    await writeBytes(context.stderr, Uint8Array.of(254), context.signal);
    return { exitCode: 0 };
  } });
  try {
    const running = shell.exec("xargs -P2 -n1 emit", { stdin: "one two", limits: { maxOutputBytes: limit } });
    if (limit === 3) await assert.rejects(running, error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    else {
      const result = await running;
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout.length, 2);
      assert.equal(result.stderr.length, 2);
    }
  } finally { await shell.dispose(); }
});

test("parallel children share the original CPU deadline", async context => {
  const { shell, commands } = fixture();
  let now = 0;
  context.mock.method(performance, "now", () => now);
  let calls = 0;
  commands.register({ name: "advance", execute() { calls++; now += 3; return { exitCode: 0 }; } });
  try {
    await assert.rejects(shell.exec("xargs -P2 -n1 advance", { stdin: "one two three four", limits: { maxCpuMs: 5 } }), error => error instanceof ShellLimitError && error.limit === "maxCpuMs");
    assert.equal(calls, 2);
  } finally { await shell.dispose(); }
});

for (const browser of [false, true]) test(`actual ${browser ? "browser" : "standard"} invocation preserves middleware and empty stdin`, async () => {
  const { shell, commands } = fixture(browser);
  const seen: string[] = [];
  shell.use(async (context, next) => { seen.push(context.command); return next(); });
  commands.register({ name: "literal", async execute(context) {
    assert.equal(context.stdinIsDefault, true);
    assert.equal((await collectBytes(context.stdin, { maxBytes: 1 })).byteLength, 0);
    await writeBytes(context.stdout, new TextEncoder().encode(JSON.stringify(context.args)), context.signal);
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec("xargs -P2 -n1 literal", { stdin: "'$(bad)' ';'" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, '["$(bad)"][";"]');
    assert.deepEqual(seen, ["xargs", "literal", "literal"]);
  } finally { await shell.dispose(); }
});

for (const input of ["<<<'one two'", "<<EOF\none two\nEOF"]) test(`inline input retains output completion: ${input}`, async () => {
  const { shell, fs } = fixture();
  try {
    const result = await shell.exec(`xargs -P2 -n1 say >out ${input}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "one\ntwo\n");
  } finally { await shell.dispose(); }
});
