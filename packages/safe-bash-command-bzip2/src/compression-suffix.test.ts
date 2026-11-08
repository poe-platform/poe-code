import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { chunks, run } from "./helpers.js";

for (const suffix of [".bz2", ".bz", ".tbz2", ".tbz"]) {
  for (const flag of ["-k", "-fk", "-c", "-fc"]) {
    test(`bzip2 ${flag} refuses named ${suffix} input`, async () => {
      const fs = createMemoryFileSystem();
      const input = Buffer.from("already suffixed plaintext\n");
      const name = `/note${suffix}`;
      await fs.writeFile(name, input);
      const result = await run("bzip2", [flag, name], undefined, { fs });
      assert.equal(result.exitCode, 1, result.stderr);
      assert.equal(result.stdout.length, 0);
      assert.ok(result.stderr.includes("already has"), result.stderr);
      assert.deepEqual(Buffer.from(await fs.readFile(name)), input);
      assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), [name.slice(1)]);
    });
  }
}

test("bzip2 refuses compressed named input but accepts the same bytes on stdin", async () => {
  const encoded = await run("bzip2", ["-c"], chunks(Buffer.from("payload\n")));
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a.bz2", encoded.stdout);
  const named = await run("bzip2", ["-c", "a.bz2"], undefined, { fs });
  assert.equal(named.exitCode, 1, named.stderr);
  assert.equal(named.stdout.length, 0);
  const stdin = await run("bzip2", ["-c"], chunks(encoded.stdout));
  assert.equal(stdin.exitCode, 0, stdin.stderr);
  assert.ok(stdin.stdout.length > 0);
});

for (const flag of ["-k", "-fk", "-c", "-fc"]) {
  test(`bzip2 ${flag} accepts uppercase .BZ2`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/note.BZ2", Buffer.from("payload\n"));
    const result = await run("bzip2", [flag, "note.BZ2"], undefined, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(flag.includes("c") ? result.stdout.length > 0 : (await fs.readFile("/note.BZ2.bz2")).length > 0);
  });
}

test("bzip2 continues with valid operands after refusing a compressed suffix", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/note.bz2", Buffer.from("refused\n"));
  await fs.writeFile("/plain", Buffer.from("accepted\n"));
  const result = await run("bzip2", ["-fk", "note.bz2", "plain"], undefined, { fs });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.ok((await fs.readFile("/plain.bz2")).length > 0);
  assert.deepEqual((await fs.readdir("/")).map(entry => entry.name).sort(), ["note.bz2", "plain", "plain.bz2"]);
});
