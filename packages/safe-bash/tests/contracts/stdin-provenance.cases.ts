import assert from "node:assert/strict";
import test from "node:test";
import { collectBytes, composeMiddleware, toByteSource, type ByteSource, type CommandContext, type CommandInvokeOptions } from "../../src/contracts/index.js";
import { directExecutor, executionCommands } from "../../src/commands/execution.js";
import { findCommands } from "../../src/commands/find.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";

function context(stdinIsDefault: boolean | undefined, stdin: ByteSource): CommandContext {
  return {
    command: "child", args: [], stdin,
    ...(stdinIsDefault === undefined ? {} : { stdinIsDefault }),
    stdout: { async write() {} }, stderr: { async write() {} },
    cwd: "/", env: {}, fs: createMemoryFileSystem(), signal: new AbortController().signal,
  };
}

for (const provenance of [true, false, undefined]) {
  test(`transparent delegation preserves stdin provenance ${provenance} without reading`, async () => {
    const stdin: ByteSource = { [Symbol.asyncIterator]() { throw new Error("must not acquire stdin"); } };
    const parent = context(provenance, stdin);
    const calls: CommandInvokeOptions[] = [];
    const forwarded = { ...parent, invoke: async (_command: string, _args: readonly string[], options?: CommandInvokeOptions) => {
      assert.ok(options);
      calls.push(options);
      assert.equal(options.stdin, stdin);
      assert.equal(options.stdinIsDefault, provenance);
      assert.equal(Object.hasOwn(options, "stdinIsDefault"), provenance !== undefined);
      return { exitCode: 0 };
    } };
    const execute = directExecutor(() => { throw new Error("unexpected fallback"); });
    await composeMiddleware([async (child, next) => {
      assert.equal(child.stdinIsDefault, provenance);
      return next();
    }], execute)(forwarded);
    await executionCommands(execute).find(command => command.name === "env")!.execute({ ...forwarded, command: "env", args: ["child"] });
    for (const terminator of [";", "+"]) {
      await findCommands(execute)[0]!.execute({ ...forwarded, command: "find", args: ["/", "-exec", "child", "{}", terminator] });
    }
    assert.equal(calls.length, 4);
  });

  test(`xargs replaces argument stream with implicit child default from ${provenance}`, async () => {
    const parent = context(provenance, toByteSource("one two"));
    let calls = 0;
    const execute = directExecutor(() => { throw new Error("unexpected fallback"); });
    const result = await executionCommands(execute).find(command => command.name === "xargs")!.execute({
      ...parent, command: "xargs", args: ["-n", "1", "child"],
      invoke: async (_command, _args, options) => {
        calls++;
        assert.ok(options?.stdin);
        assert.notEqual(options.stdin, parent.stdin);
        assert.equal(options.stdinIsDefault, true);
        assert.equal((await collectBytes(options.stdin, { maxBytes: 1 })).length, 0);
        return { exitCode: 0 };
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(calls, 2);
    assert.equal(parent.stdinIsDefault, provenance);
  });
}

test("supplied empty and exhausted streams retain nondefault provenance", async () => {
  async function* chunks(): ByteSource { yield new Uint8Array(); yield new Uint8Array([65]); }
  for (const stdin of [toByteSource(""), chunks()]) {
    const child = context(false, stdin);
    await collectBytes(child.stdin, { maxBytes: 1 });
    assert.equal(child.stdinIsDefault, false);
    await collectBytes(child.stdin, { maxBytes: 1 });
    assert.equal(child.stdinIsDefault, false);
  }
});
