import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { chunks, run } from "./helpers.js";

// zstd 1.5.x: a checksummed frame containing "hi\n", with a known content size.
const frame = Buffer.from("28b52ffd240319000068690a343d5092", "hex");
const header = "Frames  Skips  Compressed  Uncompressed  Ratio  Check  Filename\n";

for (const flag of ["-l", "--list"]) {
  test(`zstd ${flag} reports sizes and preserves files even with output/removal options`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/a.zst", frame);
    await fs.writeFile("/out", Buffer.from("retained"));
    const result = await run("zstd", [flag, "--rm", "-f", "-o", "out", "a.zst"], chunks(), { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout.toString(), header + "     1      0      16   B         3   B  0.188  XXH64  a.zst\n");
    assert.deepEqual(Buffer.from(await fs.readFile("/a.zst")), frame);
    assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "retained");
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["a.zst", "out"]);
  });
}

test("zstd listing keeps unknown frame content sizes unknown", async () => {
  const encoded = await run("zstd", ["-c"], chunks(Buffer.from("hi\n")));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  await encoded.fs.writeFile("/stream.zst", encoded.stdout);
  const result = await run("zstd", ["--list", "stream.zst"], chunks(), { fs: encoded.fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), header + "     1      0      16   B                       XXH64  stream.zst\n");
});

test("zstd listing counts concatenated and skippable frames", async () => {
  const fs = createMemoryFileSystem();
  const skip = Buffer.from("502a4d1803000000616263", "hex");
  await fs.writeFile("/mixed.zst", Buffer.concat([frame, skip, frame]));
  const result = await run("zstd", ["-l", "mixed.zst"], chunks(), { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), header + "     3      1      43   B         6   B  0.140  XXH64  mixed.zst\n");
});

test("zstd listing rejects invalid and truncated frames and continues to valid files", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/good.zst", frame);
  for (const bytes of [Buffer.from("invalid"), Buffer.alloc(0), frame.subarray(0, 5), frame.subarray(0, -1)]) {
    await fs.writeFile("/bad.zst", bytes);
    const result = await run("zstd", ["-l", "bad.zst", "good.zst"], chunks(), { fs });
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.length > 0);
    assert.ok(result.stdout.toString().includes("XXH64  good.zst\n"));
    assert.deepEqual(Buffer.from(await fs.readFile("/bad.zst")), bytes);
  }
});

test("zstd listing rejects stdin without consuming it", async () => {
  for (const args of [["-l"], ["--list", "-"]]) {
    const result = await run("zstd", args, (async function* () { assert.fail("must not read stdin"); yield frame; })());
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("--list does not support reading from standard input"), result.stderr);
    assert.equal(result.stdout.length, 0);
  }
});

test("zstd listing respects the last operation flag", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a.zst", frame);
  const decoded = await run("zstd", ["-l", "-dc", "a.zst"], chunks(), { fs });
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.equal(decoded.stdout.toString(), "hi\n");
  const listed = await run("zstd", ["-t", "-l", "a.zst"], chunks(), { fs });
  assert.equal(listed.exitCode, 0, listed.stderr);
  assert.equal(listed.stderr, "");
  assert.ok(listed.stdout.toString().startsWith(header));
});

test("zstd listing propagates input budget failures even with quiet mode", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a.zst", frame);
  const failure = new Error("input budget exceeded");
  await assert.rejects(run("zstd", ["-qql", "a.zst"], chunks(), {
    fs, inputBudget: { maxBytes: 8, check(total) { if (total > 8) throw failure; } },
  }), error => error === failure);
});

test("zstd listing reads short chunks and reports totals for checked and skippable frames", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a.zst", frame);
  await fs.writeFile("/skip.zst", Buffer.from("502a4d1803000000616263", "hex"));
  const open = fs.openReadFile!.bind(fs);
  let closed = 0;
  const openShort: typeof fs.openReadFile = async (...args) => {
    const handle = await open(...args);
    return {
      stat: options => handle.stat(options),
      read: (offset, length, options) => handle.read(offset, Math.min(length, 1), options),
      close: async () => { closed++; await handle.close(); },
    };
  };
  const shortReads = new Proxy(fs, { get(target, key) {
    if (key === "openReadFile") return openShort;
    const value: unknown = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await run("unzstd", ["--list", "a.zst", "skip.zst"], chunks(), { fs: shortReads });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), header
    + "     1      0      16   B         3   B  0.188  XXH64  a.zst\n"
    + "     1      1      11   B         0   B  0.000   None  skip.zst\n"
    + "----------------------------------------------------------------- \n"
    + "     2      1      27   B         3   B  0.111         2 files\n");
  assert.equal(closed, 2);
});

test("zstd listing inspects metadata without validating payload checksums", async () => {
  const fs = createMemoryFileSystem();
  const damaged = Buffer.from(frame);
  damaged[damaged.length - 1]! ^= 1;
  await fs.writeFile("/a.zst", damaged);
  const result = await run("zstd", ["--list", "a.zst"], chunks(), { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), header + "     1      0      16   B         3   B  0.188  XXH64  a.zst\n");
});

test("zstd listing marks files containing checksums and totals checked files", async () => {
  const fs = createMemoryFileSystem();
  const unchecked = Buffer.from(frame.subarray(0, -4));
  unchecked[4]! &= ~4;
  await fs.writeFile("/a.zst", Buffer.concat([frame, unchecked]));
  const result = await run("zstd", ["-l", "a.zst", "a.zst"], chunks(), { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.toString(), header
    + "     2      0      28   B         6   B  0.214  XXH64  a.zst\n".repeat(2)
    + "----------------------------------------------------------------- \n"
    + "     4      0      56   B        12   B  0.214  XXH64  2 files\n");
});

for (const [hex, row] of [
  ["28b52ffd6400034d00001078780100fb2b8005e30ef285", "     1      0      23   B     1.000 KiB  44.522  XXH64  a.zst\n"],
  ["28b52ffd6400ff5500001078780100fb7f1d60016000a49b", "     1      0      24   B      64.0 KiB  2730.667  XXH64  a.zst\n"],
  ["28b52ffda4000002005500001078780100fbff39c002878ff344", "     1      0      26   B       128 KiB  5041.231  XXH64  a.zst\n"],
] as const) {
  test(`zstd listing formats native size units: ${row.trim()}`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/a.zst", Buffer.from(hex, "hex"));
    const result = await run("zstd", ["-l", "a.zst"], chunks(), { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString(), header + row);
  });
}
