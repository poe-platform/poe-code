import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, getCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { createStdbufCommand, type StdbufCommandsOptions } from "./index.js";
import { shellValueFromBytes } from "safe-bash-contracts/value";

function fixture(args: readonly string[], overrides: Partial<CommandContext> = {}) {
  let stdout = "";
  let stderr = "";
  let invoked = false;
  const argumentValues = createCommandArguments(args);
  const context: CommandContext = {
    command: "stdbuf", args: argumentValues.args, argumentValues,
    cwd: "/", env: {}, fs: createMemoryFileSystem(), stdin: toByteSource(""),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
    async invoke() { invoked = true; return { exitCode: 0 }; },
    ...overrides,
  };
  return {
    context,
    async run(options?: StdbufCommandsOptions) {
      const result = await createStdbufCommand(options).execute(context);
      return { ...result, stdout, stderr, invoked };
    },
  };
}

for (const args of [
  ["-oL"], ["-o0", "-e0"], ["-i", "4K", "--output=2MiB", "--error", "L"],
  ["--input=0", "-o", "+1KB", "--"], ["-o18446744073709551615"], ["-o0Q"],
  ["-oK"], ["-oKB"], ["-oKiB"], ["-o", " \t1"], ["-o1k"], ["--out=L", "--in=0"],
]) test(`accepts buffering modes ${args.join(" ")}`, async () => {
  const result = await fixture([...args, "echo", "hi"]).run();
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.invoked, true);
});

for (const args of [
  [], ["echo"], ["-oL"], ["-iL", "echo"], ["-o", "" , "echo"],
  ["-o"], ["--output"], ["--unknown", "echo"], ["-x0", "echo"],
  ["-o-1", "echo"], ["-o1.5K", "echo"], ["-o1B", "echo"],
  ["-o18446744073709551616", "echo"], ["-o16E", "echo"],
  ["-o1m", "echo"], ["-o1g", "echo"], ["-o+K", "echo"], ["-o1 ", "echo"],
]) test(`rejects invalid invocation ${JSON.stringify(args)} without running a child`, async () => {
  const result = await fixture(args).run();
  assert.equal(result.exitCode, 125);
  assert.equal(result.invoked, false);
  assert.ok(result.stderr.startsWith("stdbuf: "));
});

test("forwards owned byte arguments, streams, signal, and child status", async () => {
  const argumentValues = createCommandArguments(["-oL", "probe", shellValueFromBytes(Uint8Array.of(255, 254)), "--help", "a; echo injected"]);
  const invocation = fixture([], { args: argumentValues.args, argumentValues, stdinIsDefault: false });
  const context: CommandContext = { ...invocation.context, async invoke(command, args, options) {
    assert.equal(command, "probe");
    assert.deepEqual(args, argumentValues.args.slice(2));
    assert.deepEqual(getCommandArguments({ args, argumentValues: options!.argumentValues! }).bytes(0), Uint8Array.of(255, 254));
    assert.equal(options!.stdin, context.stdin);
    assert.equal(options!.stdout, context.stdout);
    assert.equal(options!.stderr, context.stderr);
    assert.equal(options!.signal, context.signal);
    assert.equal(options!.stdinIsDefault, false);
    assert.equal(options!.externalInvocation, true);
    return { exitCode: 42 };
  } };
  assert.equal((await createStdbufCommand().execute(context)).exitCode, 42);
});

test("argument byte limits reject before invoking the child", async () => {
  const invocation = fixture(["-oL", "echo", "é"]);
  assert.equal((await invocation.run({ limits: { maxArgumentBytes: 8 } })).exitCode, 125);
  assert.equal((await invocation.run({ limits: { maxArgumentBytes: 9 } })).exitCode, 0);
  assert.throws(() => createStdbufCommand({ limits: { maxArgumentBytes: 0 } }), RangeError);
});

test("cancellation and child failures retain their identity", async () => {
  const reason = new Error("cancelled");
  const controller = new AbortController();
  controller.abort(reason);
  await assert.rejects(fixture(["-oL", "echo"], { signal: controller.signal }).run(), error => error === reason);
  await assert.rejects(fixture(["-oL", "echo"], { async invoke() { throw reason; } }).run(), error => error === reason);
});

for (const option of ["--help", "--version"]) test(`${option} succeeds without invoking a child`, async () => {
  const result = await fixture([option]).run();
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.ok(result.stdout.includes("stdbuf"));
  assert.equal(result.invoked, false);
});

test("argument limit is checked before invoking a command", async () => {
  let invoked = false;
  const context: CommandContext = {
    command: "stdbuf", args: ["-o0", "echo", "large"], cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal,
    async invoke() { invoked = true; return { exitCode: 0 }; },
  };
  assert.equal((await createStdbufCommand({ limits: { maxArgumentBytes: 4 } }).execute(context)).exitCode, 125);
  assert.equal(invoked, false);
});
