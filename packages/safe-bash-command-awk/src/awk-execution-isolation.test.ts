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

for (const size of [255, 256, 310]) test(`BEGIN reads every record in a ${size}-byte file exactly once`, async () => {
  const input = "x".repeat(size - 3) + "\na\n";
  const { run } = await fixture(input);
  for (let invocation = 0; invocation < 2; invocation++) {
    const result = await run('BEGIN { x = 1 } { c++ } END { print x, c, NR, $0, NF }');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "1 2 2 a 1\n");
  }
});

test("BEGIN aggregation on batched input emits END only once", async () => {
  const { run } = await fixture("a:x:10\n".repeat(40));
  const result = await run('BEGIN { sum = 1 } /^a/ { sum += $3 } END { print "END_RAN", sum, NR }');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "END_RAN 401 40\n");
});

for (const matchedLast of [false, true]) test(`large sums preserve END record state with final match ${matchedLast}`, async () => {
  const matches = "a:x:900000000\n".repeat(3);
  const padding = Array.from({ length: 20 }, (_, i) => `b:pad_${i}:100000000\n`).join("");
  const { run } = await fixture(matchedLast ? padding + matches : matches + padding);
  const result = await run('/^a/ { sum += $3; cnt++ } END { print sum, cnt, $0, NF }');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, `2700000000 3 ${matchedLast ? "a:x:900000000" : "b:pad_19:100000000"} 3\n`);
});

test("batch aggregation preserves fractional sums", async () => {
  const { run } = await fixture("a:x:0.5\n".repeat(40));
  const result = await run('BEGIN { sum = 0.25 } /^a/ { sum += $3; cnt++ } END { print sum, cnt }');
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "20.25 40\n");
});

test("awk reads batched memory input without a global Buffer", async () => {
  const { run } = await fixture("a:x:10\n".repeat(40));
  const originalBuffer = globalThis.Buffer;
  Object.defineProperty(globalThis, "Buffer", { value: undefined, configurable: true, writable: true });
  try {
    const result = await run('BEGIN { sum = 1 } { sum += $3 } END { print sum, NR }');
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "401 40\n");
  } finally {
    Object.defineProperty(globalThis, "Buffer", { value: originalBuffer, configurable: true, writable: true });
  }
});

for (const trailingNewline of ["", "\n"]) {
  for (const matched of [true, false]) {
    test(`END reads the final unmatched record (matched=${matched}, newline=${!!trailingNewline})`, async () => {
      const input = [matched ? "alpha:10" : "beta:10", ...Array.from({ length: 39 }, (_, i) => `gamma_${i + 1}:30:extra`)].join("\n") + trailingNewline;
      const { run } = await fixture(input);
      const result = await run('/^alpha:/ { c += 1; first = $1 } END { print c+0, $0, $1, NF }');
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, `${matched ? 1 : 0} gamma_39:30:extra gamma_39 3\n`);
    });
  }
}
