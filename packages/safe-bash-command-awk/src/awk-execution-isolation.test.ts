import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandContext } from "safe-bash-contracts";
import { awkCommand } from "./awk.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function fixture(input = "a:10:1\nb:20:2\nc:30:3\n".repeat(16)) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/data", encoder.encode(input));
  const command = awkCommand();
  async function run(program: string, file = "/data", env = {}, maxBytes?: number) {
    let stdout = "", stderr = "", budgetReads = 0;
    const args = ["-F:", program, file];
    const context: CommandContext = {
      command: "awk", args, argumentValues: createCommandArguments(args), cwd: "/", env, fs,
      stdin: toByteSource(""), signal: new AbortController().signal,
      stdout: {
        async write(bytes) { stdout += decoder.decode(bytes); },
        ...{
          writeSync(bytes: Uint8Array) { stdout += decoder.decode(bytes); return true; },
          writeRangeSync(bytes: Uint8Array, length: number) { stdout += decoder.decode(bytes.subarray(0, length)); return true; },
        },
      },
      stderr: { async write(bytes) { stderr += decoder.decode(bytes); } },
    };
    Object.defineProperty(context, "inputBudget", { get() {
      budgetReads++;
      return maxBytes === undefined ? undefined : { maxBytes, check(bytes: number) {
        if (bytes > maxBytes) throw new Error("input byte limit exceeded");
      } };
    } });
    Object.assign(context, { _fastMemoryBackingFs: fs });
    const result = await command.execute(context);
    return { ...result, stdout, stderr, budgetReads };
  }
  return { fs, run, input };
}

test("repeated fast awk executions preserve direct stdout", async () => {
  const { run } = await fixture();
  for (let i = 0; i < 3; i++) {
    const result = await run('{ s += $3; n++ } END { print s, n }');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "96 48\n");
  }
});

test("repeated awk executions preserve output across flush boundaries", async () => {
  const { run, input } = await fixture("a:10:1\n".repeat(3000));
  for (let i = 0; i < 2; i++) {
    const result = await run('{ print $0 }');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, input);
  }
});

test("each fast awk execution observes filename, environment and END writes", async () => {
  const { run, fs } = await fixture();
  const program = 'END { print FILENAME, ENVIRON["TENANT"]; print ENVIRON["TENANT"] > "/out" }';
  for (const [file, tenant] of [["/data", "first"], ["data", "second"], ["/data", "third"]]) {
    const result = await run(program, file, { TENANT: tenant });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, `${file} ${tenant}\n`);
    assert.equal(decoder.decode(await fs.readFile("/out")), `${tenant}\n`);
  }
});

test("fast awk initializes the lazy input budget before reading a memory view", async () => {
  const { run } = await fixture();
  const result = await run('{ s += $3 } END { print s }', "/data", {}, 4);
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.budgetReads > 0);
  assert.equal(result.stdout, "");
});

test("fast awk evaluates random state for each invocation", async () => {
  const { run } = await fixture();
  const program = 'END { srand(ENVIRON["SEED"]); print rand() }';
  const first = await run(program, "/data", { SEED: "1" });
  const second = await run(program, "/data", { SEED: "2" });
  const repeat = await run(program, "/data", { SEED: "1" });
  assert.equal(first.exitCode, 0);
  assert.equal(second.exitCode, 0);
  assert.equal(repeat.exitCode, 0);
  assert.notEqual(first.stdout, second.stdout);
  assert.equal(first.stdout, repeat.stdout);
});
