import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createAwkCommand } from "./index.js";

async function run(command: CommandDefinition, fs: ReturnType<typeof createMemoryFileSystem>, args: string[], env: Record<string, string> = {}, stdin = "") {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "", charges = 0;
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env, fs,
    _fastMemoryBackingFs: fs, _hasInfiniteFsOpsLimit: true,
    _chargeFastFsOp() { charges++; },
    stdin: toByteSource(stdin), signal: new AbortController().signal,
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

test("repeated sums preserve stdout and numbers beyond signed 32 bits", async () => {
  const fs = createMemoryFileSystem(), command = createAwkCommand();
  await fs.writeFile("/data", bytes("alpha:x:999999999:y\n".repeat(20)));
  for (let i = 0; i < 3; i++) {
    const result = await run(command, fs, ["-F:", '/^alpha/ { sum += $3; cnt++ } END { printf "%.0f %.0f\\n", cnt, sum }', "/data"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "20 19999999980\n");
    assert.equal((await run(command, fs, ["-F:", '/^alpha/ { sum += 10; cnt++ } END { print cnt, sum }', "/data"])).stdout, "20 200\n");
  }
});

test("file effects execute once and context is fresh for each invocation", async () => {
  const fs = createMemoryFileSystem(), command = createAwkCommand();
  const data = bytes("alpha:x:10:y\n");
  await fs.writeFile("/one", data); await fs.writeFile("/two", data);
  for (const file of ["/one", "/two"]) {
    const result = await run(command, fs, ["-F:", 'NR==1 { print $1 >> "/out"; print FILENAME, ENVIRON["TENANT"] }', file], { TENANT: file });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, `${file} ${file}\n`);
  }
  assert.equal(new TextDecoder().decode(await fs.readFile("/out")), "alpha\nalpha\n");
  for (const tenant of ["a", "b", "c"]) {
    assert.equal((await run(command, fs, ["-F:", '{ print ENVIRON["TENANT"] }', "/one"], { TENANT: tenant })).stdout, `${tenant}\n`);
  }
});

test("random seeds observe the current environment rather than memoized output", async () => {
  const fs = createMemoryFileSystem(), command = createAwkCommand();
  await fs.writeFile("/data", bytes("alpha:x\n"));
  const args = ["-F:", 'BEGIN { srand(ENVIRON["SEED"]) } { print rand() }', "/data"];
  const first = await run(command, fs, args, { SEED: "1" });
  const second = await run(command, fs, args, { SEED: "2" });
  const replay = await run(command, fs, args, { SEED: "1" });
  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal(second.exitCode, 0, second.stderr);
  assert.notEqual(first.stdout, second.stdout);
  assert.equal(replay.stdout, first.stdout);
});

test("file and stdin both succeed at the 18-step record budget on repeated runs", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/data", bytes("a\n"));
  const command = createAwkCommand({ maxSteps: 18 });
  for (let invocation = 0; invocation < 2; invocation++) {
    for (const operands of [["/data"], ["-"], []]) {
      const result = await run(command, fs, ["{print}", ...operands], {}, "a\n");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "a\n");
      assert.equal(result.stderr, "");
    }
  }
});
