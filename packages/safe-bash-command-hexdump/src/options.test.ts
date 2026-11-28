import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { run } from "./test-helpers.js";

for (const [args, expected] of [
  [["--canonical", "--skip", "1", "--length", "2"], "00000001  62 63                                             |bc|\n00000003\n"],
  [["--format", '4/1 "%02x" "\\n"'], "61626364\n65666768\n"],
  [["--no-squeezing", "-C"], "00000000  61 62 63 64 65 66 67 68                           |abcdefgh|\n00000008\n"],
  [["-X"], "0000000  61  62  63  64  65  66  67  68" + " ".repeat(32) + "\n0000008\n"],
] as const) test(`hexdump file regression: ${args.join(" ")}`, async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/f", new TextEncoder().encode("abcdefgh"));
  const result = await run([...args, "/f"], undefined, {}, { fs });
  assert.equal(result.exitCode, 0, Buffer.from(result.stderr, "hex").toString());
  assert.equal(result.stderr, "");
  assert.equal(Buffer.from(result.stdout, "hex").toString(), expected);
});

for (const [long, short] of [
  ["--one-byte-octal", "-b"], ["--one-byte-char", "-c"],
  ["--canonical", "-C"], ["--two-bytes-decimal", "-d"],
  ["--two-bytes-octal", "-o"], ["--two-bytes-hex", "-x"],
  ["--one-byte-hex", "-X"], ["--no-squeezing", "-v"],
  ["--length=2", "-n2"], ["--skip=1", "-s1"],
  ['--format=4/1 "%02x" "\\n"', '-e4/1 "%02x" "\\n"'],
] as const) test(`long option ${long} matches ${short}`, async () => {
  const input = Buffer.from("abcdefgh".repeat(5));
  const actual = await run([long], input);
  assert.equal(actual.exitCode, 0);
  assert.deepEqual(actual, await run([short], input));
});

for (const args of [["--length"], ["--skip"], ["--format"], ["--unknown"], ["--canonical=yes"], ["--length="], ["--skip="]]) {
  test(`reject invalid long options: ${args.join(" ")}`, async () => {
    assert.equal((await run(args)).exitCode, 1);
  });
}

test("option terminator preserves long-looking filenames", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/--canonical", new TextEncoder().encode("a"));
  assert.deepEqual(await run(["--", "--canonical"], undefined, {}, { fs }), await run(["/--canonical"], undefined, {}, { fs }));
});
