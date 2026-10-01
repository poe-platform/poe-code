import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { Budget } from "safe-bash-io-engine/commands/text-programs/shared";
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

for (const content of [
  "foo mid baz end\n".repeat(40) + "foo mid baz baz end\n",
  ("foo " + "m".repeat(1000) + " baz end\n").repeat(66),
]) test(`pair execution never discards charged work (${content.length} bytes)`, async (t) => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", bytes(content));
  const command = createSedCommand();
  const args = ["s/^foo/WARM/;s/baz/qux/g", "/input"];
  const expected = content.replaceAll("foo", "WARM").replaceAll("baz", "qux");
  for (let invocation = 0; invocation < 2; invocation++) {
    const budgets = new Set<Budget>();
    const step = Budget.prototype.step;
    const spy = t.mock.method(Budget.prototype, "step", function (this: Budget, ...args: Parameters<Budget["step"]>) {
      budgets.add(this);
      return step.apply(this, args);
    });
    const result = await run(command, fs, args, "range");
    spy.mock.restore();
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(budgets.size, 1, "all parsing and execution work must use one execution budget");
  }
});

test("pair substitutions enforce finite step limits on cold and warm programs", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", bytes("foo mid baz end\n".repeat(40) + "foo mid baz baz end\n"));
  const command = createSedCommand({ maxSteps: 100 });
  const args = ["s/^foo/LIMIT/;s/baz/qux/g", "/input"];
  for (let invocation = 0; invocation < 2; invocation++) {
    const result = await run(command, fs, args, "range");
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /execution step limit exceeded/);
    assert.equal((await run(createSedCommand(), fs, args, "range")).exitCode, 0);
  }
});
