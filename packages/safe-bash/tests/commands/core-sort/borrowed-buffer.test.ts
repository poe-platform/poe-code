import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem, Shell, standardCommands } from "../../../src/index.js";
import type { ByteSource } from "../../../src/contracts/index.js";
import { run } from "../helpers.js";

function borrowedInput(bytes: Uint8Array, width: number, synchronous = false): ByteSource {
  const window = Buffer.alloc(width);
  let offset = 0;
  const next = (): IteratorResult<Uint8Array> => {
    if (offset === bytes.length) {
      window.fill(0);
      return { done: true, value: undefined };
    }
    const length = Math.min(width, bytes.length - offset);
    window.set(bytes.subarray(offset, offset + length));
    offset += length;
    return { done: false, value: window.subarray(0, length) };
  };
  return { [Symbol.asyncIterator]() {
    return { next: async () => next(), ...(synchronous ? { tryNextSync: next } : {}) };
  } };
}

for (const args of [[], ["-r"], ["-k1,1n"]]) {
  for (const width of [2, 8]) {
    for (const synchronous of [false, true]) {
      test(`sort owns stdin before advancing or finalizing it: ${args.join(" ")}, width=${width}, synchronous=${synchronous}`, async () => {
        const result = await run("sort", args, { stdin: borrowedInput(Buffer.from("2 b\n1 a\n"), width, synchronous) });
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stdout, args.includes("-r") ? "2 b\n1 a\n" : "1 a\n2 b\n");
      });
    }
  }
}

test("sort owns a repeated large first chunk before a scratch producer overwrites it", async () => {
  const first = "z\n".repeat(128);
  const warmup = await run("sort", [], { stdin: borrowedInput(Buffer.from(first), 256, true) });
  assert.equal(warmup.exitCode, 0, warmup.stderr);
  assert.equal(warmup.stdout, first);
  const result = await run("sort", [], { stdin: borrowedInput(Buffer.from(first + "a\n".repeat(128)), 256, true) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "a\n".repeat(128) + first);
});

test("sort owns borrowed stdin when input exceeds the indexed fast-path size", async () => {
  const longRecord = "2 " + "b".repeat(65536) + "\n";
  const result = await run("sort", [], { stdin: borrowedInput(Buffer.from(longRecord + "1 a\n"), 16384) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.compare(Buffer.from(result.stdoutBytes), Buffer.from("1 a\n" + longRecord)), 0);
});

for (const delimiter of [10, 0]) {
  test(`public sort owns named VFS Buffer fragments before advancing the source, delimiter=${delimiter}`, async () => {
    const fs = new MemoryFileSystem();
    const input = Buffer.from([98, 49, delimiter, 97, 49, delimiter]);
    await fs.writeFile("/input", input);
    const original = fs.readStream.bind(fs);
    fs.readStream = (path, options) => path !== "/input" ? original(path, options) : (async function* () {
      const allocation = Buffer.alloc(12, 255);
      const view = allocation.subarray(5, 7);
      for (let offset = 0; offset < input.length; offset += view.length) {
        view.set(input.subarray(offset, offset + view.length));
        yield view;
      }
      allocation.fill(0);
    })();
    const shell = new Shell({ fs }).use(standardCommands());
    try {
      const result = await shell.exec(delimiter === 0 ? "sort -z /input" : "sort /input");
      assert.equal(result.exitCode, 0); assert.equal(result.stderr, "");
      assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from([97, 49, delimiter, 98, 49, delimiter]));
      assert.deepEqual(Buffer.from(await fs.readFile("/input")), input);
    } finally { await shell.dispose(); }
  });
}
