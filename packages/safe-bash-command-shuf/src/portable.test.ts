import assert from "node:assert/strict";
import { test } from "node:test";
import { createBytePipe, createCommandArguments, type CommandContext } from "safe-bash-contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { Diagnostic, parse } from "./args.js";

test("shuf parses integer options and preserves diagnostic bytes without Buffer", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer")!;
  const context = (args: string[]): CommandContext => ({
    command: "shuf", cwd: "/", fs: createMemoryFileSystem(),
    stdin: createBytePipe().readable,
    stdout: createBytePipe().writable, stderr: createBytePipe().writable,
    signal: new AbortController().signal,
    args: createCommandArguments(args).args,
    env: { LANG: "C.UTF-8" },
  });
  Object.defineProperty(globalThis, "Buffer", { configurable: true, value: undefined });
  try {
    const result = parse(context(["-i", "2-5", "-n", "3"]));
    assert.deepEqual(result.range, { low: 2n, size: 4n });
    assert.equal(result.count, 3n);
    for (const args of [["-n", "invalid"], ["-i", "invalid"], ["--unknown"], ["-é"]]) {
      assert.throws(() => parse(context(args)), (error: unknown) => {
        assert.ok(error instanceof Diagnostic);
        assert.ok(error.bytes instanceof Uint8Array);
        assert.equal(new TextDecoder().decode(error.bytes), error.message);
        assert.ok(error.message.startsWith("shuf: "));
        return true;
      });
    }
  } finally {
    Object.defineProperty(globalThis, "Buffer", descriptor);
  }
});
