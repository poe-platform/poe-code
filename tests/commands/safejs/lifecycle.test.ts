import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { CommandRegistry, type ByteSource } from "../../../src/contracts/index.js";
import { createSafeJsCommands, safeJsCommands, type SafeJsCommandsOptions } from "../../../src/commands/safejs/index.js";
import { contractRuntime, deferred, execute, operation } from "./helpers.js";

test("plugin collision is explicit, replacement is opt-in, and no js alias is registered", async () => {
  const commands = new CommandRegistry();
  const host = { commands, use() {}, registerFileSystem() {} };
  await safeJsCommands().setup(host);
  assert.equal(commands.has("safejs"), true);
  assert.equal(commands.has("js"), false);
  assert.throws(() => safeJsCommands().setup(host), /already registered/u);
  const first = commands.get("safejs");
  await safeJsCommands({ replace: true }).setup(host);
  assert.notEqual(commands.get("safejs"), first);
});

for (const limits of [{ timeoutMs: 0 }, { maxInputBytes: -1 }, { maxSteps: NaN }, { dataSize: 1.5 }, { timeoutMs: 2_147_483_648 }]) {
  test(`invalid host limits reject before registration: ${JSON.stringify(limits)}`, () => {
    assert.throws(() => createSafeJsCommands({ limits }), RangeError);
  });
}

test("partially supplied runtime factories fail closed", () => {
  assert.throws(() => createSafeJsCommands({ runtime: {} } as SafeJsCommandsOptions), /runtime.run/u);
});

for (const mode of ["inline", "stdin"]) test(`source byte limit precedes interpreter effects: ${mode}`, async () => {
  let ran = false;
  const runtime = contractRuntime(async () => { ran = true; });
  const actual = await execute(mode === "inline" ? ["-e", "é😀"] : ["-"], { runtime, limits: { maxSourceBytes: 5 } }, "é😀");
  assert.equal(actual.exitCode, 124, actual.stderr);
  assert.match(actual.stderr, /maxSourceBytes/u);
  assert.equal(ran, false);
});

test("invalid UTF-8 source fails without invoking runner", async () => {
  const actual = await execute(["-"], { runtime: contractRuntime(async () => { throw new Error("unexpected runner"); }) }, Buffer.from([255]));
  assert.equal(actual.exitCode, 1);
  assert.doesNotMatch(actual.stderr, /unexpected runner/u);
});

test("input quota is cumulative and cannot be hidden by a caught host rejection", async () => {
  const runtime = contractRuntime(async (_source, options) => {
    assert.deepEqual(await operation(options, "stdio", "readBytes")(2), [1, 2]);
    try { await operation(options, "stdio", "readBytes")(2); } catch {}
    return "must not succeed";
  });
  const actual = await execute(["-p", "-e", "contract"], { runtime, limits: { maxInputBytes: 3 } }, Buffer.from([1, 2, 3, 4]));
  assert.equal(actual.exitCode, 124);
  assert.match(actual.stderr, /maxInputBytes/u);
  assert.equal(actual.stdout.length, 0);
});

test("output quota covers stdout plus stderr and cannot be hidden by guest recovery", async () => {
  const runtime = contractRuntime(async (_source, options) => {
    await operation(options, "stdio", "write")("é");
    try { await operation(options, "stdio", "error")("😀"); } catch {}
  });
  const actual = await execute(["-e", "contract"], { runtime, limits: { maxOutputBytes: 5 } });
  assert.equal(actual.exitCode, 124);
  assert.equal(actual.stdout.toString(), "é");
  assert.match(actual.stderr, /maxOutputBytes/u);
  assert.doesNotMatch(actual.stderr, /😀/u);
});

test("unawaited console/stdio writes are drained in issue order before command returns", async () => {
  const runtime = contractRuntime(async (_source, options) => {
    options.sink.log("first");
    void operation(options, "stdio", "write")("second");
    options.sink.log("third");
  });
  const output: string[] = [];
  const actual = await execute(["-e", "contract"], { runtime }, "", { stdout: { async write(bytes) { await delay(2); output.push(Buffer.from(bytes).toString()); } } });
  assert.equal(actual.exitCode, 0, actual.stderr);
  assert.deepEqual(output, ["first\n", "second", "third\n"]);
});

test("pending output before a runner error is drained instead of silently discarded", async () => {
  const runtime = contractRuntime(async (_source, options) => { options.sink.log("before"); throw new Error("runner failure"); });
  const output: string[] = [];
  const result = await execute(["-e", "contract"], { runtime }, "", { stdout: { async write(bytes) { await delay(5); output.push(Buffer.from(bytes).toString()); } } });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(output, ["before\n"]);
  assert.match(result.stderr, /runner failure/u);
});

test("parallel guest reads are serialized, and completed-invocation callbacks cannot write", async () => {
  let late: (() => unknown) | undefined;
  const runtime = contractRuntime(async (_source, options) => {
    const read = operation(options, "stdio", "readBytes");
    assert.deepEqual(await Promise.all([read(1), read(1), read(1)]), [[1], [2], [3]]);
    late = () => operation(options, "stdio", "write")("late");
  });
  const actual = await execute(["-e", "contract"], { runtime }, Buffer.from([1, 2, 3]));
  assert.equal(actual.exitCode, 0);
  assert(late);
  await assert.rejects(Promise.resolve().then(late));
  assert.equal(actual.stdout.length, 0);
});

test("stdio rejects non-byte arrays, oversized chunks and invalid read sizes", async () => {
  const runtime = contractRuntime(async (_source, options) => {
    for (const value of [[256], [-1], [1.5], ["1"], "bytes", Array(65537).fill(0)]) {
      await assert.rejects(Promise.resolve().then(() => operation(options, "stdio", "writeBytes")(value)), TypeError);
    }
    for (const size of [0, -1, 1.5, 65537, "2"]) {
      await assert.rejects(Promise.resolve().then(() => operation(options, "stdio", "readBytes")(size)), TypeError);
    }
  });
  assert.equal((await execute(["-e", "contract"], { runtime })).exitCode, 0);
});

for (const phase of ["runner", "input", "output", "stderr", "source"] as const) test(`parent cancellation interrupts blocked ${phase} and observes late rejection`, { timeout: 2000 }, async () => {
  const entered = deferred();
  const blocked = deferred<never>();
  const controller = new AbortController();
  const reason = new Error(`cancel ${phase}`);
  let returned = 0;
  const source: ByteSource = { [Symbol.asyncIterator]() { return {
    next() { entered.resolve(); return blocked.promise; },
    async return() { returned++; return { done: true, value: undefined }; },
  }; } };
  const runtime = contractRuntime(async (_source, options) => {
    if (phase === "runner") { entered.resolve(); return blocked.promise; }
    if (phase === "output" || phase === "stderr") { await operation(options, "stdio", phase === "stderr" ? "error" : "write")("write"); return; }
    await operation(options, "stdio", "readText")();
  });
  const task = execute(phase === "source" ? ["-"] : ["-e", "contract"], { runtime }, source,
    { signal: controller.signal, ...(phase === "output" || phase === "stderr" ? { [phase === "stderr" ? "stderr" : "stdout"]: { async write() { entered.resolve(); await blocked.promise; } } } : {}) });
  const rejection = assert.rejects(task, error => error === reason);
  await entered.promise;
  controller.abort(reason);
  await rejection;
  blocked.reject(new Error("late rejection"));
  await delay(5);
  if (phase === "source" || phase === "input") assert.equal(returned, 1);
});

for (const phase of ["runner", "input", "output", "stderr", "source"] as const) test(`deadline interrupts uncooperative ${phase}`, { timeout: 2000 }, async () => {
  const never = new Promise<never>(() => {});
  const source: ByteSource = { [Symbol.asyncIterator]() { return { next: () => never, return: () => never }; } };
  const runtime = contractRuntime(async (_source, options) => {
    if (phase === "runner") return never;
    if (phase === "output" || phase === "stderr") { await operation(options, "stdio", phase === "stderr" ? "error" : "write")("write"); return; }
    await operation(options, "stdio", "readText")();
  });
  const actual = await execute(phase === "source" ? ["-"] : ["-e", "contract"], { runtime, limits: { timeoutMs: 15 } }, source,
    phase === "output" || phase === "stderr" ? { [phase === "stderr" ? "stderr" : "stdout"]: { async write() { await never; } } } : {});
  assert.equal(actual.exitCode, 124, actual.stderr);
  if (phase !== "stderr") assert.match(actual.stderr, /timeoutMs/u);
});

test("uncooperative diagnostic sinks cannot hang a failed invocation", { timeout: 2000 }, async () => {
  const runtime = contractRuntime(async () => { throw new Error("guest error"); });
  const result = await execute(["-e", "contract"], { runtime, limits: { timeoutMs: 15 } }, "", { stderr: { write: () => new Promise(() => {}) } });
  assert.equal(result.exitCode, 1);
});

test("empty-only sources yield enough for timeout and cleanup", { timeout: 2000 }, async () => {
  let returned = false;
  const input: ByteSource = { async *[Symbol.asyncIterator]() { try { for (;;) yield new Uint8Array(); } finally { returned = true; } } };
  const runtime = contractRuntime(async (_source, options) => operation(options, "stdio", "readText")());
  const result = await execute(["-e", "contract"], { runtime, limits: { timeoutMs: 15 } }, input);
  assert.equal(result.exitCode, 124);
  assert.equal(returned, true);
});

test("return and console JSON are bounded during expansion of repeated references", async () => {
  const value = Array(1000).fill({ text: "x".repeat(1000) });
  for (const consoleOutput of [false, true]) {
    const runtime = contractRuntime(async (_source, options) => { if (consoleOutput) options.sink.log(value); return value; });
    const actual = await execute(["-p", "-e", "contract"], { runtime, limits: { maxOutputBytes: 4096 } });
    assert.equal(actual.exitCode, 124);
    assert.match(actual.stderr, /maxOutputBytes/u);
    assert.equal(actual.stdout.length, 0);
  }
});

test("JSON return rendering does not invoke accessors or toJSON host callbacks", async () => {
  let invoked = false;
  for (const value of [{ get property() { invoked = true; return 1; } }, { toJSON() { invoked = true; return 1; } }]) {
    const actual = await execute(["-p", "-e", "contract"], { runtime: contractRuntime(async () => value) });
    assert.equal(actual.exitCode, 1);
    assert.equal(invoked, false);
  }
});

test("console formatting is bounded string/JSON joining, not Node percent interpolation", async () => {
  const runtime = contractRuntime(async (_source, options) => { options.sink.log("%s", "é", { value: 1 }); return { missing: undefined, array: [undefined] }; });
  const result = await execute(["-p", "-e", "contract"], { runtime });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), '%s é {"value":1}\n{"array":[null]}\n');
});
