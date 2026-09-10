import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { ShellLimitError } from "../../../src/shell/types.js";
import { createCommandArguments } from "../../../src/contracts/index.js";
import { shellValueFromBytes } from "../../../src/contracts/value.js";
import { run } from "./helpers.js";
import { iconvCommands } from "../../../src/commands/iconv/index.js";
import { reviewCases } from "./review-fixtures.js";

for (const fixture of reviewCases) test(`independent native review: ${fixture.name}`, async () => {
  assert.deepEqual(await run([...fixture.args], Buffer.from(fixture.inputHex, "hex")), { exitCode: fixture.status, stdoutHex: fixture.stdoutHex, stderrHex: fixture.stderrHex });
});

test("one admitted argv snapshot determines the only opened path", async () => {
  let reads = 0;
  const args: string[] = [];
  Object.defineProperty(args, 0, { get() { return ++reads <= 2 ? "a" : "oversized"; }, enumerable: true });
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a", Uint8Array.of(65)); await fs.writeFile("/oversized", Uint8Array.of(66));
  const opened: string[] = [];
  const stat = fs.stat.bind(fs);
  fs.stat = async (path, options) => { opened.push(path); return stat(path, options); };
  const result = await run(args, undefined, { limits: { maxArgumentBytes: 1 } }, { fs });
  assert.deepEqual(result, { exitCode: 0, stdoutHex: "41", stderrHex: "" });
  assert.equal(reads, 1); assert.deepEqual(opened, ["/a"]);
});

test("argument count is snapshotted before byte admission", async () => {
  let lengths = 0;
  const args = new Proxy(["a", "b"], { get(target, key, receiver) { if (key === "length") return ++lengths === 1 ? 1 : 2; return Reflect.get(target, key, receiver); } });
  const fs = new MemoryFileSystem();
  await fs.writeFile("/a", Uint8Array.of(65)); await fs.writeFile("/b", Uint8Array.of(66));
  const result = await run(args, undefined, { limits: { maxArguments: 1 } }, { fs });
  assert.deepEqual(result, { exitCode: 0, stdoutHex: "41", stderrHex: "" }); assert.equal(lengths, 1);
});

for (const reason of [false, 0, "", null]) test(`argv length getter abort stops argument traversal: ${JSON.stringify(reason)}`, async () => {
  const caller = new AbortController();
  let reads = 0;
  const args = new Proxy(["a"], { get(target, key, receiver) {
    if (key === "length") { caller.abort(reason); return 1; }
    if (key === "0" || key === Symbol.iterator) reads++;
    return Reflect.get(target, key, receiver);
  } });
  await assert.rejects(run(args, undefined, {}, { signal: caller.signal }), error => error === reason);
  assert.equal(reads, 0);
});

test("owned raw argument bytes retain their own byte admission", async () => {
  const carrier = createCommandArguments([shellValueFromBytes(Uint8Array.of(255))]);
  const result = await run([], undefined, { limits: { maxArgumentBytes: 1 } }, { args: carrier.args, argumentValues: carrier });
  assert.equal(result.exitCode, 1);
  assert.equal(Buffer.from(result.stderrHex, "hex").toString(), "iconv: filesystem paths must be valid UTF-8\n");
});

test("writes use the stdout destination whose lifetime was acquired", async () => {
  let reads = 0;
  const admitted: number[][] = [], substituted: number[][] = [];
  const first = { async write(bytes: Uint8Array) { admitted.push(Array.from(bytes)); } };
  const second = { async write(bytes: Uint8Array) { substituted.push(Array.from(bytes)); } };
  const result = await run(["-f", "UTF-8", "-t", "UTF-8"], Uint8Array.of(65), {}, { get stdout() { return ++reads === 1 ? first : second; } });
  assert.equal(result.exitCode, 0); assert.equal(reads, 1);
  assert.deepEqual(admitted, [[65]]); assert.deepEqual(substituted, []);
});

test("writes use the owned-output capability whose consumer lifetime was acquired", async () => {
  let reads = 0;
  const admitted: number[][] = [], substituted: number[][] = [];
  const consumer = new AbortController(), closedConsumer = new AbortController();
  closedConsumer.abort(false);
  const first = { consumerClosed: consumer.signal, async write(bytes: Uint8Array) { admitted.push(Array.from(bytes)); } };
  const second = { consumerClosed: closedConsumer.signal, async write(bytes: Uint8Array) { substituted.push(Array.from(bytes)); } };
  const stdout = { get ownedOutput() { return ++reads === 1 ? first : second; }, async write() { assert.fail("owned-output enrollment must not be bypassed"); } };
  const result = await run(["-f", "UTF-8", "-t", "UTF-8"], Uint8Array.of(65), {}, { stdout });
  assert.equal(result.exitCode, 0); assert.equal(reads, 1);
  assert.deepEqual(admitted, [[65]]); assert.deepEqual(substituted, []);
});

test("actual Shell CPU checkpoint stops further input admission", async context => {
  let now = 0, reads = 0, returned = 0;
  context.mock.method(performance, "now", () => now);
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(iconvCommands());
  const stdin = { [Symbol.asyncIterator]() { return {
    async next() {
      reads++;
      if (reads === 1) { now = 10; return { done: false as const, value: new Uint8Array(8192).fill(65) }; }
      return { done: true as const, value: undefined };
    },
    async return() { returned++; return { done: true as const, value: undefined }; },
  }; } };
  try {
    await assert.rejects(shell.exec("iconv -f UTF-8 -t UTF-8", { stdin, limits: { maxCpuMs: 5 } }), error => error instanceof ShellLimitError && error.limit === "maxCpuMs");
    assert.deepEqual({ reads, returned }, { reads: 1, returned: 1 });
  } finally { await shell.dispose(); }
});
