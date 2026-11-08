import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, shellValueFromBytes, toByteSource, type ShellValue } from "safe-bash-contracts";
import { createExprCommand, type ExprCommandsOptions } from "./index.js";

async function run(values: readonly ShellValue[], options: ExprCommandsOptions = {}) {
  const carrier = createCommandArguments(values);
  const stdout: number[] = [], stderr: number[] = [];
  const result = await createExprCommand(options).execute({
    command: "expr", args: carrier.args, argumentValues: carrier, cwd: "/", env: { LC_ALL: "C" },
    fs: createMemoryFileSystem(), stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(chunk) { stdout.push(...chunk); } },
    stderr: { async write(chunk) { stderr.push(...chunk); } },
  });
  return { ...result, stdout, stderr: new TextDecoder().decode(Uint8Array.from(stderr)) };
}

const first = shellValueFromBytes(Uint8Array.of(255));
const second = shellValueFromBytes(Uint8Array.of(254));
test("expr retains distinct byte operands with identical decoded presentations", async () => {
  assert.deepEqual(await run([first]), { exitCode: 0, stdout: [255, 10], stderr: "" });
  assert.deepEqual(await run([first, "=", second]), { exitCode: 1, stdout: [48, 10], stderr: "" });
  assert.deepEqual(await run(["length", first]), { exitCode: 0, stdout: [49, 10], stderr: "" });
  assert.deepEqual(await run(["substr", first, "1", "1"]), { exitCode: 0, stdout: [255, 10], stderr: "" });
});
test("expr admits raw byte lengths before copying active operands", async () => {
  assert.deepEqual(await run([first], { limits: { maxArgumentBytes: 1, maxStringBytes: 2 } }), { exitCode: 0, stdout: [255, 10], stderr: "" });
  assert.equal((await run([shellValueFromBytes(Uint8Array.of(255, 254))], { limits: { maxArgumentBytes: 1 } })).exitCode, 3);
});
