import assert from "node:assert/strict";
import test from "node:test";
import type { CommandContext } from "safe-bash-contracts";
import { createCallerCommand } from "./index.js";

test("caller bounds arguments and output before writing", async () => {
  const frames = [{ line: 12, name: "outer", file: "/script" }];
  const context = { args: ["0"], signal: new AbortController().signal,
    stdout: { write() { assert.fail("output must be admitted first"); } },
  } as unknown as CommandContext;
  await assert.rejects(async () => createCallerCommand({ frames, limits: { maxArgumentBytes: 0 } }).execute(context), /argument limit/);
  await assert.rejects(async () => createCallerCommand({ frames, limits: { maxOutputBytes: 1 } }).execute(context), /output limit/);
});

test("caller rejects invalid and absent frames without output", async () => {
  const command = createCallerCommand({ frames: [{ line: 1, file: "NULL" }] });
  for (const args of [["0"], ["1"], ["9223372036854775807"], ["--", "-1"]]) {
    const context = { args, signal: new AbortController().signal } as CommandContext;
    assert.equal((await command.execute(context)).exitCode, 1);
  }
});

async function invoke(args: string[], maxOutputBytes?: number) {
  let stdout = "";
  let stderr = "";
  const decoder = new TextDecoder();
  const context = { args, signal: new AbortController().signal,
    stdout: { write(bytes: Uint8Array) { stdout += decoder.decode(bytes); } },
    stderr: { write(bytes: Uint8Array) { stderr += decoder.decode(bytes); } },
  } as unknown as CommandContext;
  const command = createCallerCommand({ frames: [{ line: 12, name: "outer", file: "/script" }],
    ...(maxOutputBytes === undefined ? {} : { limits: { maxOutputBytes } }),
  });
  const result = await command.execute(context);
  return { stdout, stderr, exitCode: result.exitCode };
}

test("caller accepts an option terminator and signed decimal frame indexes", async () => {
  for (const args of [["--", "0"], ["+0"], [" 0 "], ["00"], ["0", "ignored"], ["--", "-0"]]) {
    assert.deepEqual(await invoke(args), { stdout: "12 outer /script\n", stderr: "", exitCode: 0 });
  }
  assert.deepEqual(await invoke(["--"]), { stdout: "12 /script\n", stderr: "", exitCode: 0 });
});

test("caller distinguishes invalid operands from unavailable frames", async () => {
  for (const [operand, reason] of [["-1", "invalid option"], ["abc", "invalid number"],
    ["1.0", "invalid number"], ["", "invalid number"], ["0x0", "invalid hex number"],
    ["00x0", "invalid octal number"], ["0X0", "invalid number"], ["9223372036854775808", "invalid number"]]) {
    assert.deepEqual(await invoke([operand!]), { stdout: "", exitCode: 2,
      stderr: `caller: ${operand}: ${reason}\ncaller: usage: caller [expr]\n` });
  }
  for (const args of [["1"], ["08"], ["--", "-1"], ["9223372036854775807"]]) {
    assert.deepEqual(await invoke(args), { stdout: "", stderr: "", exitCode: 1 });
  }
});

test("caller admits diagnostics before writing", async () => {
  await assert.rejects(invoke(["bad"], 1), /output limit/);
});
