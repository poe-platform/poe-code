import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type ByteSource } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { run } from "./helpers.js";
import { createCmpCommand } from "../../../src/commands/cmp/index.js";

test("GNU comparison blocks are independent of retained producer fragments", async () => {
  for (const chunkSize of [1, 3, 11, 65536]) {
    for (const [differentAt, count, exitCode] of [[0, 9, 0], [3, 9, 0], [4, 9, 0], [8, 9, 1], [0, 8, 0], [7, 8, 0], [4, 7, 1], [0, 3, 1]]) {
      const left = Buffer.alloc(9, 97), right = Buffer.from(left);
      right[differentAt!] = 98;
      const fs = createMemoryFileSystem();
      await fs.writeFile("/left", left);
      await fs.writeFile("/right", right);
      fs.readStream = path => (async function* () {
        const bytes = path === "/left" ? left : right;
        const reusable = Buffer.alloc(chunkSize);
        try {
          for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            const size = Math.min(chunkSize, bytes.length - offset);
            reusable.set(bytes.subarray(offset, offset + size));
            yield reusable.subarray(0, size);
          }
        } finally { reusable.fill(255); }
      })();
      const result = await run(["-ln" + count, "left", "right"], left, right, { fs }, { comparisonBlockBytes: 4 });
      assert.equal(result.exitCode, exitCode, JSON.stringify({ chunkSize, differentAt, count }));
      assert.equal(result.stdout, `${differentAt! + 1} 141 142\n`);
      assert.equal(result.stderr, "");
    }
  }
});

test("a full final block performs a zero-byte count iteration; a partial block does not", async () => {
  for (const [length, count, differentAt, expected] of [
    [65535, 65535, 0, 1], [65536, 65536, 65535, 0], [65537, 65537, 0, 0],
    [65537, 65537, 65536, 1], [65537, 65535, 0, 1], [131072, 131072, 131071, 0],
  ]) {
    const left = Buffer.alloc(length!, 97), right = Buffer.from(left);
    right[differentAt!] = 98;
    const result = await run(["-ln" + count, "left", "right"], left, right);
    assert.equal(result.exitCode, expected, JSON.stringify({ length, count, differentAt }));
    assert.equal(result.stdout, `${String(differentAt! + 1).padStart(String(count).length)} 141 142\n`);
  }
});

test("full-block read errors precede an already visible leading difference", async () => {
  for (const args of [["left", "-"], ["-s", "left", "-"], ["-l", "left", "-"]]) {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/left", Buffer.from("aa"));
    fs.readStream = () => (async function* () { yield Buffer.from("a"); throw new FsError("EIO"); })();
    let stdinReads = 0;
    const stdin: ByteSource = { [Symbol.asyncIterator]() { stdinReads++; throw new Error("left block must finish first"); } };
    assert.deepEqual(await run(args, undefined, Buffer.from("bb"), { fs, stdin }), {
      exitCode: 2, stdout: "", stderr: "cmp: left: Input/output error\n",
    });
    assert.equal(stdinReads, 0);
  }
});

test("previous verbose output survives a read failure in a later block", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("aaaaaa"));
  await fs.writeFile("/right", Buffer.from("baaaaa"));
  fs.readStream = path => (async function* () {
    yield Buffer.from(path === "/left" ? "aaaa" : "baaa");
    throw new FsError("EIO");
  })();
  assert.deepEqual(await run(["-l", "left", "right"], undefined, undefined, { fs }, { comparisonBlockBytes: 4 }), {
    exitCode: 2, stdout: "1 141 142\n", stderr: "cmp: left: Input/output error\n",
  });
});

test("comparison profile size is validated independently of producer chunk limits", async () => {
  for (const value of [0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createCmpCommand({ comparisonBlockBytes: value }), /comparisonBlockBytes/);
  }
  const fs = createMemoryFileSystem();
  await fs.writeFile("/left", Buffer.from("aaaaa"));
  await fs.writeFile("/right", Buffer.from("baaaa"));
  const result = await run(["-l", "left", "right"], undefined, undefined, { fs }, {
    comparisonBlockBytes: 4, limits: { maxChunkBytes: 1 },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "1 141 142\n");
});
