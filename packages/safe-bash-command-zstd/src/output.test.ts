import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { chunks, run } from "./helpers.js";

for (const attached of [false, true]) {
  test(`zstd selects compression and decompression filenames (${attached ? "attached" : "separate"} -o)`, async () => {
    const fs = createMemoryFileSystem();
    await fs.mkdir("/work");
    await fs.writeFile("/work/f", Buffer.from("hello\n"));
    const output = (name: string) => attached ? [`-o${name}`] : ["-o", name];
    const encoded = await run("zstd", ["-q", "f", ...output("out.zst")], chunks(), { fs, cwd: "/work" });
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    assert.equal(encoded.stdout.length, 0);
    assert.equal(encoded.stderr, "");
    const decoded = await run("zstd", ["-q", "-d", "out.zst", ...output("back")], chunks(), { fs, cwd: "/work" });
    assert.equal(decoded.exitCode, 0, decoded.stderr);
    assert.equal(decoded.stdout.length, 0);
    assert.equal(decoded.stderr, "");
    assert.equal(Buffer.from(await fs.readFile("/work/back")).toString(), "hello\n");
    assert.equal(Buffer.from(await fs.readFile("/work/f")).toString(), "hello\n");
    assert.ok((await fs.readFile("/work/out.zst")).length > 0);
  });
}

test("zstd selected output preserves existing files and rejects source aliases even with force", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/f", Buffer.from("hello\n"));
  await fs.writeFile("/out", Buffer.from("keep me"));
  const collision = await run("zstd", ["/f", "-o", "/out"], chunks(), { fs });
  assert.equal(collision.exitCode, 1);
  assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "keep me");
  const same = await run("zstd", ["-f", "/f", "-o", "/f"], chunks(), { fs });
  assert.equal(same.exitCode, 1);
  assert.equal(Buffer.from(await fs.readFile("/f")).toString(), "hello\n");
  const forced = await run("zstd", ["-f", "/f", "-o", "/out"], chunks(), { fs });
  assert.equal(forced.exitCode, 0, forced.stderr);
  const decoded = await run("zstd", ["-d", "/out", "-o", "/back"], chunks(), { fs });
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.equal(Buffer.from(await fs.readFile("/back")).toString(), "hello\n");
});

test("zstd rejects a missing output argument before processing input", async () => {
  const result = await run("zstd", ["-o"]);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /requires an argument/);
  assert.equal(result.stdout.length, 0);
});

test("zstd writes stdin to a selected file and decodes to explicit stdout", async () => {
  const fs = createMemoryFileSystem();
  const encoded = await run("zstd", ["--rm", "-o", "/encoded"], chunks(Buffer.from("hello\n")), { fs });
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  assert.equal(encoded.stdout.length, 0);
  const decoded = await run("zstd", ["-d", "/encoded", "-o", "-"], chunks(), { fs });
  assert.equal(decoded.exitCode, 0, decoded.stderr);
  assert.equal(decoded.stdout.toString(), "hello\n");
});

test("zstd refuses multiple inputs sharing a selected output before writing", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/first", Buffer.from("first"));
  await fs.writeFile("/second", Buffer.from("second"));
  const result = await run("zstd", ["-f", "/first", "/second", "-o", "/out"], chunks(), { fs });
  assert.equal(result.exitCode, 1);
  await assert.rejects(fs.stat("/out"));
});
