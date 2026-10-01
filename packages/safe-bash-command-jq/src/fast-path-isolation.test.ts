import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createJqCommand } from "./index.js";

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

for (const nested of [false, true]) for (const condition of [".active == true", ".active"]) test(`select preserves ${condition} semantics across repeated file runs (nested=${nested})`, async () => {
  const fs = createMemoryFileSystem();
  const active = nested ? [true, [], {}, false, null, undefined] : [true, 1, 0, "true", "", false, null, undefined];
  await fs.writeFile("/items", bytes(active.map((value, id) => JSON.stringify({ id, active: value, padding: "x".repeat(80) })).join("\n") + "\n"));
  const expected = (condition.includes("==") ? [0] : nested ? [0, 1, 2] : [0, 1, 2, 3, 4]).map(id => JSON.stringify({ id }) + "\n").join("");
  const command = createJqCommand();
  for (let i = 0; i < 3; i++) {
    const result = await run(command, fs, ["-c", `select(${condition}) | {id}`, "/items"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});
