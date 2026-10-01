import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createRgCommand } from "./index.js";

async function run(command: CommandDefinition, fs: ReturnType<typeof createMemoryFileSystem>, args: string[], env: Record<string, string> = {}) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "", charges = 0;
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env, fs,
    _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true,
    _chargeFastFsOp() { charges++; },
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: {
      _scratch4k: new Uint8Array(4096),
      writeSync(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); return true; },
      writeRangeSync(bytes: Uint8Array, length: number) { stdout += new TextDecoder().decode(bytes.subarray(0, length)); return true; },
      async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); },
    },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
  } as Parameters<CommandDefinition["execute"]>[0]);
  return { ...result, stdout, stderr, charges };
}
const bytes = (text: string) => new TextEncoder().encode(text);

test("count cache distinguishes middle bytes and filesystem tenants", async () => {
  const command = createRgCommand();
  for (const content of ["a_foo_z\n".repeat(10), "a_bar_z\n".repeat(3)]) {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/dir");
    await fs.writeFile("/dir/file", bytes(content));
    for (const pattern of ["a_foo_z", "a_bar_z", "a_foo_z"]) {
      const result = await run(command, fs, ["-c", pattern, "/dir"]);
      const matches = content.includes(pattern);
      assert.equal(result.exitCode, matches ? 0 : 1, result.stderr);
      assert.equal(result.stdout, matches ? `/dir/file:${content.split("\n").length - 1}\n` : "");
    }
  }
});

test("repeated 64-file counts honor maxFiles and charge reads", async () => {
  const fs = createMemoryFileSystem();
  for (let d = 0; d < 8; d++) {
    await fs.mkdir(`/src/d${d}`, { recursive: true });
    for (let f = 0; f < 8; f++) await fs.writeFile(`/src/d${d}/f${f}`, bytes("needle\n"));
  }
  const command = createRgCommand();
  const first = await run(command, fs, ["-c", "needle", "/src"]);
  assert.equal(first.exitCode, 0, first.stderr);
  const limited = await run(createRgCommand({ maxFiles: 1 }), fs, ["-c", "needle", "/src"]);
  assert.notEqual(limited.exitCode, 0, "cached tree must still enforce maxFiles");
  for (let i = 0; i < 2; i++) {
    const result = await run(command, fs, ["-c", "needle", "/src"]);
    assert.equal(result.stdout, first.stdout);
    assert.ok(result.charges >= 64, `expected read charges, got ${result.charges}`);
  }
});
