import assert from "node:assert/strict";
import test from "node:test";
import { type CommandContext, type CommandInvokeOptions, toByteSource } from "../../../src/contracts/index.js";
import { directExecutor, executionCommands } from "../../../src/commands/execution.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "../helpers.js";

function context(args: readonly string[]): CommandContext {
  return {
    command: "env", args, cwd: "/", env: { PUBLIC: "parent", DROP: "remove", PWD: "/" },
    fs: createMemoryFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
  };
}

const cases = [
  { args: ["-i", "A=1", "B=2", "child", "a;b"], expected: { A: "1", B: "2" } },
  { args: ["-i", "child"], expected: {} },
  { args: ["-u", "DROP", "child"], expected: { PUBLIC: "parent", PWD: "/" } },
  { args: ["PUBLIC=child", "child"], expected: { PUBLIC: "child", DROP: "remove", PWD: "/" } },
  { args: ["-i", "A=1", "B=2", "env", "-u", "A"], expected: { A: "1", B: "2" } },
];

for (const vector of cases) test(`env requests exact exported environment: ${vector.args.join(" ")}`, async () => {
  const parent = context(vector.args), before = { ...parent.env };
  let calls = 0;
  const supplied: CommandContext = { ...parent, invoke: async (name, args, options) => {
    calls++;
    assert.equal(name, vector.args.includes("child") ? "child" : "env");
    assert.deepEqual(args, vector.args.includes("a;b") ? ["a;b"] : name === "env" ? ["-u", "A"] : []);
    assert.equal(options?.replaceEnv, true);
    assert.deepEqual({ ...options.env }, vector.expected);
    assert.notEqual(options.env, parent.env);
    assert.equal(options.stdin, parent.stdin);
    assert.equal(options.stdout, parent.stdout);
    assert.equal(options.stderr, parent.stderr);
    assert.equal(options.cwd, parent.cwd);
    return { exitCode: 7 };
  } };
  const command = executionCommands(() => { throw new Error("must use invoke"); })[0]!;
  assert.equal((await command.execute(supplied)).exitCode, 7);
  assert.equal(calls, 1);
  assert.deepEqual(parent.env, before);
});

for (const origin of [true, false, undefined]) test(`env replacement retains stdin provenance ${origin}`, async () => {
  const parent = context(["-i", "child"]);
  const input = { [Symbol.asyncIterator]() { throw new Error("must not acquire input"); } };
  const supplied = { ...parent, stdin: input, ...(origin === undefined ? {} : { stdinIsDefault: origin }),
    invoke: async (_name: string, _args: readonly string[], options?: CommandInvokeOptions) => {
      assert.equal(options?.replaceEnv, true);
      assert.equal(options.stdin, input);
      assert.equal(options.stdinIsDefault, origin);
      assert.equal(Object.hasOwn(options, "stdinIsDefault"), origin !== undefined);
      return { exitCode: 0 };
    },
  };
  assert.equal((await executionCommands(() => { throw new Error("fallback"); })[0]!.execute(supplied)).exitCode, 0);
});

test("generic direct execution does not request replacement", async () => {
  const parent = context([]);
  const supplied = { ...parent, command: "child", invoke: async (_name: string, _args: readonly string[], options?: CommandInvokeOptions) => {
    assert.equal(Object.hasOwn(options!, "replaceEnv"), false);
    assert.equal(options?.env, parent.env);
    return { exitCode: 0 };
  } };
  assert.equal((await directExecutor(() => { throw new Error("fallback"); })(supplied)).exitCode, 0);
});

test("nested registry fallback still receives the exact cleared map", async () => {
  assert.equal((await run("env", ["-i", "A=1", "B=2", "env", "-u", "A"], { env: { INHERITED: "secret" } })).stdout, "B=2\n");
});

test("env replacement preserves cwd and parent on invocation failure", async () => {
  const parent = context(["-C", "/child", "-i", "child"]);
  await parent.fs.mkdir("/child");
  const supplied = { ...parent, invoke: async (_name: string, _args: readonly string[], options?: CommandInvokeOptions) => {
    assert.equal(options?.cwd, "/child");
    assert.deepEqual({ ...options.env }, {});
    return { exitCode: 23 };
  } };
  assert.equal((await executionCommands(() => { throw new Error("fallback"); })[0]!.execute(supplied)).exitCode, 23);
  assert.equal(parent.cwd, "/");
  assert.equal(parent.env.PUBLIC, "parent");
});

test("preaborted env never invokes a child", async () => {
  const controller = new AbortController(); controller.abort(new Error("stop"));
  const parent = { ...context(["-i", "child"]), signal: controller.signal, invoke: async () => { throw new Error("unexpected invocation"); } };
  await assert.rejects(Promise.resolve().then(() => executionCommands(() => ({ exitCode: 0 }))[0]!.execute(parent)), /stop/);
});
