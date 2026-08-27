import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, FsError, createBytePipe, collectBytes } from "../../../src/contracts/index.js";
import { createExprCommand, createExprCommands, exprCommands, type ExprLimits } from "../../../src/commands/expr/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { standardCommands } from "../../../src/commands/index.js";
import { run, deferred } from "./helpers.js";

test("factories register exactly expr with explicit replacement", async () => {
  assert.deepEqual(createExprCommands().map(command => command.name), ["expr"]);
  const commands = new CommandRegistry([createExprCommand()]);
  const original = commands.get("expr");
  const host = { commands, use() {}, registerFileSystem() {} };
  assert.throws(() => exprCommands().setup(host), /already registered/u);
  assert.equal(commands.get("expr"), original);
  await exprCommands({ replace: true }).setup(host);
  assert.notEqual(commands.get("expr"), original);
});

test("evaluated BRE uses matching and rejects invalid patterns on empty subjects", async () => {
  assert.equal((await run(["abc", ":", "a.*"])).stdout, "3\n");
  assert.equal((await run(["match", "abc", "\\(a\\)"])).stdout, "a\n");
  const result = await run(["", ":", "["]);
  assert.equal(result.exitCode, 2); assert.equal(result.stdout, "");
  assert.equal(result.stderr, "expr: Invalid regular expression\n");
});

test("UTF-8 argv uses bytes in C and scalars in C.UTF-8, never UTF-16 units", async () => {
  for (const locale of ["C", "C.UTF-8"]) {
    const overrides = { env: { LC_ALL: locale } };
    assert.equal((await run(["length", "a😀é"], {}, overrides)).stdout, locale === "C" ? "8\n" : "4\n");
    assert.equal((await run(["index", "a😀z", "z"], {}, overrides)).stdout, locale === "C" ? "6\n" : "3\n");
    assert.equal((await run(["substr", "a😀z", "2", "1"], {}, overrides)).stdoutHex, locale === "C" ? "f00a" : "f09f98800a");
  }
  assert.equal((await run(["substr", "é", "1", "1"])).stdoutHex, "c30a");
  assert.equal((await run(["é", ">", "z"])).stdout, "1\n");
});

test("unsupported locales and unrepresentable argv are explicit errors", async () => {
  for (const args of [["length", "abc"], ["a", "<", "b"]]) {
    const actual = await run(args, {}, { env: { LC_ALL: "en_US.UTF-8" } });
    assert.equal(actual.exitCode, 2); assert.match(actual.stderr, /locale|collation/u);
  }
  assert.equal((await run(["2", "+", "3"], {}, { env: { LC_ALL: "en_US.UTF-8" } })).stdout, "5\n");
  for (const value of ["a\0b", "\ud800", "\udfff"]) assert.equal((await run([value])).exitCode, 2);
});

const limits: readonly [Partial<ExprLimits>, readonly string[], string][] = [
  [{ maxArgumentBytes: 3 }, ["éé"], "aggregate argument bytes"],
  [{ maxNumericDigits: 3 }, ["1234", "+", "0"], "numeric digits"],
  [{ maxNumericDigits: 3 }, ["999", "+", "1"], "arithmetic result digits"],
  [{ maxNumericDigits: 3 }, ["99", "*", "99"], "arithmetic result digits"],
  [{ maxNumericDigits: 1 }, ["length", "0123456789"], "numeric result digits"],
  [{ maxNodes: 2 }, ["1", "+", "2"], "AST node"],
  [{ maxDepth: 3 }, ["length", "length", "length", "x"], "depth"],
  [{ maxDepth: 3 }, ["(", "(", "(", "x", ")", ")", ")"], "depth"],
  [{ maxDepth: 3 }, ["1", "+", "1", "+", "1", "+", "1"], "depth"],
  [{ maxSteps: 3 }, ["1234"], "evaluation work"],
  [{ maxStringBytes: 3 }, ["abcd"], "string allocation"],
  [{ maxOutputBytes: 3 }, ["abc"], "output bytes"],
  [{ maxSteps: 1000 }, ["index", "a".repeat(100), "b".repeat(100)], "evaluation work"],
];
for (const [settings, args, label] of limits) test(`bounded ${label} ${JSON.stringify(settings)}`, async () => {
  const result = await run(args, { limits: settings });
  assert.equal(result.exitCode, 3); assert.equal(result.stdout, ""); assert.match(result.stderr, new RegExp(label));
});

test("factory limit validation and long input preflight", async () => {
  for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createExprCommand({ limits: { maxSteps: value } }), RangeError);
  }
  assert.throws(() => createExprCommand({ limits: { maxDepth: 257 } }), RangeError);
  assert.throws(() => createExprCommand({ regex: { requestTimeoutMs: 0 } }), RangeError);
  assert.equal((await run(["9".repeat(100_000), "+", "1"])).exitCode, 3);
  assert.equal((await run(Array.from({ length: 20_000 }, () => ""))).exitCode, 3);
  const text = "a".repeat(65_536);
  assert.equal((await run([text])).stdout, `${text}\n`);
  assert.equal((await run(["9".repeat(2000), "<", "z"])).stdout, "1\n");
  assert.equal((await run(["123"], { limits: { maxNumericDigits: 1 } })).stdout, "123\n");
  assert.equal((await run(["length", "a"], { limits: { maxStringBytes: 1 } })).stdout, "1\n");
});

test("direct success and errors do not even access stdin", async () => {
  for (const args of [["1"], ["1", "/", "0"], ["--help"], ["1", "|", "match", "x", "["]]) {
    const specimen = await run(["1"]);
    const context = { ...specimen.context, args };
    Object.defineProperty(context, "stdin", { get() { throw new Error("stdin getter accessed"); } });
    await createExprCommand().execute(context);
  }
});

test("awaits sink backpressure and preserves complete byte output", async () => {
  const started = deferred(), release = deferred();
  let settled = false;
  const running = run(["abc"], {}, { stdout: { async write(chunk) {
    assert.deepEqual(chunk, new Uint8Array(Buffer.from("abc\n"))); started.resolve(); await release.promise;
  } } }).then(value => { settled = true; return value; });
  await started.promise; await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false); release.resolve(); assert.equal((await running).exitCode, 0);
});

test("byte pipe backpressure, C partial bytes, and exact abort reason", async () => {
  const controller = new AbortController();
  const pipe = createBytePipe({ highWaterMark: 1, signal: controller.signal });
  const running = run(["substr", "é", "1", "1"], {}, { stdout: pipe.writable });
  const collecting = collectBytes(pipe.readable, { maxBytes: 2 });
  assert.equal((await running).exitCode, 0); await pipe.close();
  assert.equal(Buffer.from(await collecting).toString("hex"), "c30a");
  const reason = new FsError("ENOENT", { message: "exact caller reason" });
  controller.abort(reason);
  await assert.rejects(run(["1"], {}, { signal: controller.signal }), error => error === reason);
});

test("abort during pending output observes late rejection", async () => {
  const controller = new AbortController(), started = deferred(), release = deferred();
  const reason = new FsError("EPIPE", { message: "caller abort" });
  const running = run(["1"], {}, { signal: controller.signal, stdout: { async write() {
    started.resolve(); await release.promise; throw new Error("late sink failure");
  } } });
  const rejected = assert.rejects(running, error => error === reason);
  await started.promise; controller.abort(reason); await rejected;
  release.resolve(); await new Promise<void>(resolve => setImmediate(resolve));
});

test("work yields for timer cancellation without consuming stdin", async () => {
  const controller = new AbortController(), reason = new Error("stop index");
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await assert.rejects(run(["index", "a".repeat(1000), "b".repeat(1000)], {}, { signal: controller.signal }), error => error === reason);
  } finally { clearTimeout(timer); }
});

test("sink failure is status 3 and diagnostic failure is not swallowed", async () => {
  const result = await run(["1"], {}, { stdout: { async write() { throw new Error("sink failure"); } } });
  assert.equal(result.exitCode, 3); assert.match(result.stderr, /output failure/u);
  const reason = new Error("diagnostic sink failure");
  await assert.rejects(run([], {}, { stderr: { async write() { throw reason; } } }), error => error === reason);
});

test("actual Shell registry, piping and VFS redirection preserve byte output", async () => {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(standardCommands()).use(exprCommands());
  try {
    assert.equal((await shell.exec("expr 9007199254740993 + 2 | cat")).stdout, "9007199254740995\n");
    assert.equal((await shell.exec("expr substr é 1 1 > /partial")).exitCode, 0);
    assert.equal(Buffer.from(await fs.readFile("/partial")).toString("hex"), "c30a");
    assert.equal((await shell.exec("expr 0")).exitCode, 1);
    assert.equal((await shell.exec("expr 1 / 0")).exitCode, 2);
  } finally { await shell.dispose(); }
});

test("Shell input ownership is compared to its baseline, not direct-command ownership", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(standardCommands()).use(exprCommands());
  async function observed(source: string) {
    const calls = { iterator: 0, next: 0, returned: 0 };
    const stdin = { [Symbol.asyncIterator]() {
      calls.iterator++;
      return { async next() { calls.next++; return { done: true, value: undefined } as const; },
        async return() { calls.returned++; return { done: true, value: undefined } as const; } };
    } };
    const result = await shell.exec(source, { stdin });
    assert.equal(result.exitCode, 0); return calls;
  }
  try { assert.deepEqual(await observed("expr 1"), await observed("true")); }
  finally { await shell.dispose(); }
});

test("literal argv dispatch uses the actual Shell invoker and middleware", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(exprCommands());
  let nested = 0;
  shell.use(async (context, next) => {
    if (context.command === "expr" && context.args[0] === "dispatch") {
      const args = context.args, env = context.env, cwd = context.cwd;
      const result = await context.invoke!("expr", ["+", "a | b"]);
      assert.equal(context.args, args); assert.equal(context.env, env); assert.equal(context.cwd, cwd);
      return result;
    }
    nested++; return next();
  });
  try {
    assert.equal((await shell.exec("expr dispatch")).stdout, "a | b\n"); assert.equal(nested, 1);
  } finally { await shell.dispose(); }
});
