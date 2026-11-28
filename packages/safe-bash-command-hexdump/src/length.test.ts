import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { run } from "./test-helpers.js";

for (const [args, expected] of [
  [["-n", "0x4"], "00000000  61 62 63 64                                       |abcd|\n00000004\n"],
  [["-s", "0x2", "-n", "2"], "00000002  63 64                                             |cd|\n00000004\n"],
  [["-n", "1k"], "00000000  61 62 63 64 65 66 67 68                           |abcdefgh|\n00000008\n"],
  [["-s", "04"], "00000004  65 66 67 68                                       |efgh|\n00000008\n"],
  [["-n", "1m"], "00000000  61 62 63 64 65 66 67 68                           |abcdefgh|\n00000008\n"],
] as const) test(`default hexdump reads file bytes with ${args.join(" ")}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/f", Buffer.from("abcdefgh"));
  const result = await run(["-C", ...args, "/f"], undefined, {}, { fs });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdout, "hex").toString(), expected);
});

for (const name of ["hexdump", "hd"]) {
  for (const [length, count] of [["0X400", 1024], ["02000", 1024], ["1k", 1024], ["1b", 512]] as const) {
    test(`${name} stops at the exact ${length} byte count`, async () => {
      const result = await run([...(name === "hexdump" ? ["-C"] : []), "-n" + length], Buffer.alloc(2048), {}, {}, name);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.equal(Buffer.from(result.stdout, "hex").toString(), `00000000  00 00 00 00 00 00 00 00  00 00 00 00 00 00 00 00  |................|\n*\n${count.toString(16).padStart(8, "0")}\n`);
    });
  }
}

for (const length of ["-0x1", "9007199254740992", "8796093022208k", "8589934592m"]) {
  test(`default hexdump rejects invalid or overflowing length ${length}`, async () => {
    const result = await run(["-C", "-n", length], Buffer.from("abcdefgh"));
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.notEqual(result.stderr, "");
  });
}
