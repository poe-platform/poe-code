import { strict as assert } from "node:assert";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { FsError } from "safe-bash-contracts";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { chunks, run } from "./test-helpers.js";

for (const command of ["gzip", "gunzip", "zcat"]) {
  test(`${command} associates integrity failures with each operand`, async () => {
    const member = gzipSync("integrity diagnostic fixture\n");
    const files = [
      ["crc.gz", Buffer.from(member).fill(0, member.length - 8, member.length - 4)],
      ["len.gz", Buffer.from(member).fill(0, member.length - 4)],
      ["short.gz", member.subarray(0, -1)],
    ] as const;
    const fs = createMemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
    const result = await run(command, ["-t", ...files.map(([name]) => name)], undefined, { fs });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr, `${command}: /crc.gz: incorrect data check (CRC)\n${command}: /len.gz: incorrect length check\n${command}: /short.gz: unexpected end of file\n`);
    for (const [name, bytes] of files) assert.deepEqual(Buffer.from(await fs.readFile(`/${name}`)), bytes);
  });

  test(`${command} labels implicit and explicit stdin diagnostics`, async () => {
    const member = gzipSync("stdin fixture\n");
    for (const operands of [[], ["-"]]) {
      const corrupt = await run(command, ["-t", ...operands], chunks(member.subarray(0, -1)));
      assert.equal(corrupt.exitCode, 1);
      assert.equal(corrupt.stdout.length, 0);
      assert.equal(corrupt.stderr, `${command}: stdin: unexpected end of file\n`);
      const warning = await run(command, ["-t", ...operands], chunks(member, Buffer.from("garbage")));
      assert.equal(warning.exitCode, 2);
      assert.equal(warning.stdout.length, 0);
      assert.equal(warning.stderr, `${command}: stdin: decompression OK, trailing garbage ignored\n`);
    }
  });
}

test("gzip preserves filesystem diagnostics during operand execution", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input.gz", gzipSync("payload"));
  const error = new FsError("EIO", { path: "/input.gz" });
  fs.openReadFile = async () => { throw error; };
  const result = await run("gzip", ["-t", "input.gz"], undefined, { fs });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout.length, 0);
  assert.equal(result.stderr, `gzip: ${error.message}\n`);
});
