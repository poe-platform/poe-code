import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { chunks, run } from "./helpers.js";

for (const decompress of [false, true]) {
  test(`bzip2 preserves the first ${decompress ? "decompressed" : "compressed"} output for duplicate operands`, async () => {
    const input = Buffer.from("duplicate operand contents\n");
    const encoded = await run("bzip2", ["-c"], chunks(input));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    const fs = createMemoryFileSystem();
    const source = decompress ? "plain.bz2" : "plain";
    const destination = decompress ? "/plain" : "/plain.bz2";
    const sourceBytes = decompress ? encoded.stdout : input;
    await fs.writeFile(`/${source}`, sourceBytes);
    await fs.writeFile(`/later${decompress ? ".bz2" : ""}`, sourceBytes);
    const result = await run("bzip2", [decompress ? "-dk" : "-k", source, source, `later${decompress ? ".bz2" : ""}`], undefined, { fs });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.deepEqual(Buffer.from(await fs.readFile(destination)), decompress ? input : encoded.stdout);
    assert.deepEqual(Buffer.from(await fs.readFile(`/${source}`)), sourceBytes);
    assert.deepEqual(Buffer.from(await fs.readFile(`/later${decompress ? "" : ".bz2"}`)), decompress ? input : encoded.stdout);
    assert.match(result.stderr, /EEXIST/);
    assert.equal(result.stdout.length, 0);
  });
}
