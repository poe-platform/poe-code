import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { createEnableCommand } from "./index.js";

test("enable bounds arguments, builtin inventory and output", async () => {
  const context = { args: [], signal: new AbortController().signal,
    stdout: { write() { assert.fail("output must be admitted first"); } },
  } as unknown as CommandContext;
  const builtins = new Set(["test"]);
  await assert.rejects(async () => createEnableCommand({ builtins, limits: { maxOutputBytes: 1 } }).execute(context), /output limit/);
  await assert.rejects(async () => createEnableCommand({ builtins, limits: { maxBuiltins: 0 } }).execute(context), /builtin limit/);
  await assert.rejects(async () => createEnableCommand({ builtins, limits: { maxArgumentBytes: 1 } }).execute({ ...context, args: ["test"] }), /argument limit/);
});

test("enable reports invalid names while applying valid operands", async () => {
  const disabled = new Set<string>();
  let stderr = "";
  const context = { args: ["-n", "missing", "test"], signal: new AbortController().signal,
    stderr: { write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
  } as unknown as CommandContext;
  const result = await createEnableCommand({ builtins: new Set(["test"]), disabled }).execute(context);
  assert.equal(result.exitCode, 1);
  assert.equal(stderr, "enable: missing: not a shell builtin\n");
  assert.deepEqual([...disabled], ["test"]);
});
