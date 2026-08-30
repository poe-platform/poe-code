import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createStandardCommands } from "../../../src/commands/index.js";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { chunks, fixture, run } from "../helpers.js";

const native = JSON.parse(await readFile(new URL("native.json", import.meta.url), "utf8")) as { observations: { name: string; args: string[]; stdin: string; stdout: string; stderr: string; exitCode: number }[] };
for (const row of native.observations) test(`sort GNU9.7 byte equality: ${row.name}`, async () => {
  for (const width of [1, 1024]) {
    const actual = await run("sort", row.args, { stdin: chunks(Buffer.from(row.stdin, "base64"), width), env: { LC_ALL: "C" } });
    assert.equal(actual.stdoutBytes.toString("base64"), row.stdout); assert.equal(actual.stderrBytes.toString("base64"), row.stderr); assert.equal(actual.exitCode, row.exitCode);
  }
});

async function context(input: string, stdout: CommandContext["stdout"], signal = new AbortController().signal): Promise<CommandContext> {
  return { command: "sort", args: [], cwd: "/work", env: { LC_ALL: "C" }, fs: await fixture(), signal, stdin: toByteSource(input), stdout, stderr: { async write() {} } };
}
const sort = createStandardCommands().find(command => command.name === "sort")!;

test("sort batches completed output without mutating chunks or exceeding 64KiB", async () => {
  const records = Array.from({ length: 5000 }, (_, index) => `record-${5000 - index}-${"x".repeat(40)}`);
  const expected = Buffer.from(records.sort().join("\n") + "\n");
  const writes: Uint8Array[] = [];
  const result = await sort.execute(await context(records.reverse().join("\n") + "\n", { async write(bytes) { writes.push(bytes); await Promise.resolve(); } }));
  assert.equal(result.exitCode, 0); assert.deepEqual(Buffer.concat(writes), expected);
  assert.equal(writes.length, Math.ceil(expected.length / 65536));
  for (const bytes of writes) assert.ok(bytes.length <= 65536);
});

test("sort awaits backpressure and aborts a blocked output without later writes", async () => {
  const controller = new AbortController(); let writes = 0;
  let first!: () => void;
  const started = new Promise<void>(resolve => { first = resolve; });
  const pending = sort.execute(await context("row\n".repeat(40000), { async write() { writes++; first(); await new Promise<void>(() => {}); } }, controller.signal));
  const rejection = assert.rejects(Promise.resolve(pending), /stop sorting/);
  await started; assert.equal(writes, 1); controller.abort(new Error("stop sorting")); await rejection;
  assert.equal(writes, 1);
});

test("sort -o reads before replacement and preserves binary output", async () => {
  const fs = await fixture({ input: Buffer.from([255, 0, 128, 0, 65, 0]) });
  const result = await run("sort", ["-z", "-o", "input", "input"], { fs });
  assert.equal(result.exitCode, 0); assert.deepEqual(Buffer.from(await fs.readFile("/work/input")), Buffer.from([65, 0, 128, 0, 255, 0]));
});
