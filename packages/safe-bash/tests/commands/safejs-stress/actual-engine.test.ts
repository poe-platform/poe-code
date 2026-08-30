import assert from "node:assert/strict";
import { setImmediate, setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { safeJsCommands, type SafeJsCommandLimits, type SafeJsRunOptions, type SafeJsRuntime } from "../../../src/commands/safejs/index.js";
import { Shell } from "../../../src/shell/index.js";
import { deferred, execute } from "../safejs/helpers.js";
import { localRuntime, localSkip } from "../safejs/local-runtime.js";

function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }

for (const mode of ["inline", "file", "stdin"] as const) {
  test(`actual engine: ${mode} source and hostile literal argv never become guest code`, { skip: localSkip }, async () => {
    const fs = new MemoryFileSystem();
    await fs.mkdir("/work");
    const source = 'import { args, cwd, env } from "command"; import { writeFile } from "fs"; import { readText } from "stdio"; await writeFile("observed", cwd + ":" + env.KEY + ":" + await readText()); return args;';
    const args = ["", "--help", "-p", '"); throw "injected"; //', "$(touch /escape)", "\n; cat /host", "é😀", "__proto__"];
    await fs.writeFile("/work/source.ajs", Buffer.from(source));
    const argv = mode === "inline" ? ["-p", "-e", source, "--", ...args] : ["-p", mode === "stdin" ? "-" : "source.ajs", ...args];
    const stdin = mode === "stdin" ? { async *[Symbol.asyncIterator]() { for (const byte of Buffer.from(source)) yield Uint8Array.of(byte); } } : "guest é😀";
    const result = await execute(argv, { runtime: await localRuntime() }, stdin, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.toString()), args);
    assert.equal(Buffer.from(await fs.readFile("/work/observed")).toString(), `/work:virtual:${mode === "stdin" ? "" : "guest é😀"}`);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["work"]);
  });
}

test("actual engine: constructor/prototype input keys remain inert guest data", { skip: localSkip }, async () => {
  const env = Object.fromEntries([["constructor", "ctor"], ["prototype", "proto"]]);
  const result = await execute(["-p", "-e", 'import { env } from "command"; return [env["__proto__"], env["constructor"], env["prototype"]];'], { runtime: await localRuntime() }, "", { env });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.toString()), [null, "ctor", "proto"]);
  assert.equal(Reflect.get(Object.prototype, "polluted"), undefined);
});

for (const source of [
  'return ({}).constructor.constructor("return process")();',
  'import { readFile } from "node:fs"; return await readFile("/etc/passwd", "utf8");',
  'import { run } from "command"; return await run("touch /escape");',
  'return globalThis.process.env;',
]) {
  test(`actual engine: guest boundary denies ${source}`, { skip: localSkip }, async () => {
    const result = await execute(["-p", "-e", source], { runtime: await localRuntime() });
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout.length, 0);
    assert.notEqual(result.stderr, "");
    assert.deepEqual(await result.context.fs.readdir("/work"), []);
  });
}

for (const [resource, value, source] of [
  ["maxSteps", 40, "let total = 0; while (true) { total++; }"],
  ["maxCallDepth", 3, "function recur() { return recur(); } recur();"],
  ["stringLength", 128, 'return "x".repeat(256);'],
  ["arrayLength", 128, "let values = []; for (let index = 0; index < 256; index++) values.push(index); return values;"],
  ["dataSize", 4096, 'let values = []; for (let index = 0; index < 1024; index++) values.push("x".repeat(64)); return values;'],
] as const) {
  test(`actual engine: ${resource} budget rejects guest work`, { skip: localSkip }, async () => {
    const limits: Partial<SafeJsCommandLimits> = { [resource]: value };
    const result = await execute(["-p", "-e", source], { runtime: await localRuntime(), limits });
    assert.equal(result.exitCode, 124, result.stderr);
    assert.match(result.stderr, /budget exceeded/u);
    assert.equal(result.stdout.length, 0);
  });
}

test("actual engine: caught mixed byte/text input quota cannot recover success", { skip: localSkip }, async () => {
  const source = 'import { readBytes, readText } from "stdio"; await readBytes(1); try { await readText(); } catch (error) {} return "recovered";';
  const result = await execute(["-p", "-e", source], { runtime: await localRuntime(), limits: { maxInputBytes: 3 } }, Buffer.from("a😀"));
  assert.equal(result.exitCode, 124, result.stderr);
  assert.match(result.stderr, /maxInputBytes/u);
  assert.equal(result.stdout.length, 0);
});

test("actual engine: partial UTF-8 is a catchable decoding error, not replacement text", { skip: localSkip }, async () => {
  const source = 'import { readBytes, readText } from "stdio"; await readBytes(1); try { return await readText(); } catch (error) { return "invalid UTF-8"; }';
  const result = await execute(["-p", "-e", source], { runtime: await localRuntime() }, Buffer.from("😀"));
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), "invalid UTF-8\n");
});

test("actual engine: pending guest VFS read receives cancellation and blocks subsequent writes", { skip: localSkip, timeout: 2000 }, async () => {
  const runtime = await localRuntime();
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const entered = deferred();
  const blocked = deferred<Uint8Array>();
  let hostSignal: AbortSignal | undefined;
  fs.readFile = async (_path, options) => { hostSignal = options?.signal; entered.resolve(); return blocked.promise; };
  const controller = new AbortController();
  const reason = new Error("independent VFS cancellation");
  const task = execute(["-e", 'import { readFile, writeFile } from "fs"; await writeFile("before", "kept"); await readFile("pending", "utf8"); await writeFile("after", "wrong");'], { runtime }, "", { fs, signal: controller.signal });
  const rejected = assert.rejects(task, error => error === reason);
  await entered.promise;
  assert(hostSignal);
  assert.equal(hostSignal.aborted, false);
  controller.abort(reason);
  await rejected;
  assert.equal(hostSignal.aborted, true);
  blocked.reject(new Error("late VFS rejection"));
  await delay(10);
  assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name), ["before"]);
});

test("actual engine: asynchronous sink backpressure delays later virtual writes", { skip: localSkip, timeout: 2000 }, async () => {
  const entered = deferred();
  const released = deferred();
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const output: Uint8Array[] = [];
  const task = execute(["-e", 'import { writeBytes } from "stdio"; import { writeFile } from "fs"; await writeBytes([0, 255, 128]); await writeFile("after", "written");'], { runtime: await localRuntime() }, "", { fs, stdout: { async write(bytes) { entered.resolve(); await released.promise; output.push(bytes.slice()); } } });
  await entered.promise;
  await setImmediate();
  await assert.rejects(fs.lstat("/work/after"), { code: "ENOENT" });
  released.resolve();
  assert.equal((await task).exitCode, 0);
  assert.deepEqual(Buffer.concat(output), Buffer.from([0, 255, 128]));
  assert.equal(Buffer.from(await fs.readFile("/work/after")).toString(), "written");
});

test("actual engine: Shell early-close pipeline stops producer without hanging", { skip: localSkip, timeout: 2000 }, async () => {
  const source = 'import { write } from "stdio"; for (let index = 0; index < 1000; index++) { await write("line\\n"); }';
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { pipeHighWaterMark: 1 } }).use(standardCommands()).use(safeJsCommands({ runtime: await localRuntime() }));
  const result = await shell.exec(`safejs -e ${quote(source)} | head -n 1`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "line\n");
});

test("actual engine: concurrent invocations isolate argv/env/budgets and reject retained capabilities", { skip: localSkip }, async () => {
  const real = await localRuntime();
  const captured: SafeJsRunOptions<object>[] = [];
  const runtime: SafeJsRuntime<object> = { ...real, async run(source, options) { captured.push(options); return real.run(source, options); } };
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => execute(["-p", "-e", 'import { args, env } from "command"; env.KEY = args[0]; return env.KEY;', String(index)], { runtime })));
  assert.deepEqual(results.map(result => result.exitCode), Array(8).fill(0));
  assert.deepEqual(results.map(result => result.stdout.toString()), Array.from({ length: 8 }, (_, index) => `${index}\n`));
  assert.equal(new Set(captured.map(options => options.budget)).size, 8);
  assert.equal(new Set(captured.map(options => options.modules)).size, 8);
  for (const options of captured) {
    assert(options.signal.aborted);
    assert.equal(Reflect.get(options, "snapshot"), undefined);
    assert.equal(Reflect.get(options, "hostCallResumeProvider"), undefined);
    const write = options.modules.stdio?.write;
    assert.equal(typeof write, "function");
    await assert.rejects(async () => (write as (text: string) => unknown)("late"));
  }
});

test("actual engine: action-producing loop stops on step budget, not output capacity", { skip: localSkip }, async () => {
  const result = await execute(["-e", 'import { write } from "stdio"; while (true) { await write("x"); }'], { runtime: await localRuntime(), limits: { maxSteps: 140, maxOutputBytes: 65536 } });
  assert.equal(result.exitCode, 124, result.stderr);
  assert.match(result.stderr, /budget exceeded for steps/u);
  assert(result.stdout.length > 0 && result.stdout.length < 140);
  assert.equal(result.stdout.toString(), "x".repeat(result.stdout.length));
});

test("actual engine: synchronous loop respects engine deadline with large step allowance", { skip: localSkip, timeout: 2000 }, async () => {
  const result = await execute(["-e", "let total = 0; while (true) { total++; }"], { runtime: await localRuntime(), limits: { maxSteps: 1_000_000_000, timeoutMs: 20 } });
  assert.equal(result.exitCode, 124, result.stderr);
  assert.match(result.stderr, /deadline|timeoutMs/u);
  assert.equal(result.stdout.length, 0);
});

test("actual engine: all stdio and exit actions retain non-replayable journal policies", { skip: localSkip }, async () => {
  const real = await localRuntime();
  let hostCalls: { moduleId: string; operation: string; policy: string }[] = [];
  const runtime: SafeJsRuntime<object> = { ...real, async run(source, options) {
    const result = await real.run(source, options);
    const snapshot = Reflect.get(result, "snapshot") as { hostCalls: typeof hostCalls };
    hostCalls = snapshot.hostCalls;
    return result;
  } };
  const source = 'import { readBytes, readText, write, writeBytes, error, errorBytes } from "stdio"; import { setExitCode } from "command"; await readBytes(1); await readText(); await write("a"); await writeBytes([0, 255]); await error("b"); await errorBytes([1]); setExitCode(9);';
  const result = await execute(["-e", source], { runtime }, "data");
  assert.equal(result.exitCode, 9, result.stderr);
  assert.deepEqual(result.stdout, Buffer.from([97, 0, 255]));
  assert.equal(result.stderr, "b\u0001");
  const calls = hostCalls.filter(call => call.moduleId === "stdio" || call.moduleId === "command");
  assert.deepEqual(calls.map(call => [call.operation, call.policy]), ["readBytes", "readText", "write", "writeBytes", "error", "errorBytes", "setExitCode"].map(name => [name, "read-side-effect"]));
});
