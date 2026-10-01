import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createSedCommand } from "./index.js";

async function run(command: CommandDefinition, fs: ReturnType<typeof createMemoryFileSystem>, args: string[], mode: "range" | "sync" | "async") {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "", charges = 0;
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env: {}, fs,
    _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true,
    _chargeFastFsOp() { charges++; },
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: {
      ...(mode === "async" ? {} : {
        _scratch4k: new Uint8Array(4096),
        writeSync(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); return true; },
      }),
      ...(mode === "range" ? { writeRangeSync(bytes: Uint8Array, length: number) { stdout += new TextDecoder().decode(bytes.subarray(0, length)); return true; } } : {}),
      async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); },
    },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
  } as Parameters<CommandDefinition["execute"]>[0]);
  return { ...result, stdout, stderr, charges };
}
const bytes = (text: string) => new TextEncoder().encode(text);

for (const mode of ["range", "sync", "async"] as const) test(`pair substitutions remain isolated from general commands and other tenants: ${mode}`, async () => {
  const fs = createMemoryFileSystem(), other = createMemoryFileSystem();
  const input = Array.from({ length: 50 }, (_, i) => `foo:line${i}:baz:tail\n`).join("");
  await fs.writeFile("/big", bytes(input));
  await other.writeFile("/secret", bytes("SECRET_TENANT_B_DATA\n"));
  const command = createSedCommand();
  for (let i = 0; i < 3; i++) {
    const result = await run(command, fs, ["s/^foo:/FOO:/g; s/:baz:/:BAZ:/g", "/big"], mode);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, input.replaceAll("foo:", "FOO:").replaceAll(":baz:", ":BAZ:"));
    assert.equal((await run(command, other, ["s/x/y/", "/secret"], mode)).stdout, "SECRET_TENANT_B_DATA\n");
  }
});
