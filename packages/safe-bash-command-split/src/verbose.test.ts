import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { run } from "./test-helpers.js";
import { evalSyncSplit } from "./split.js";

// Expected quoting from GNU split with LC_ALL=C.
const cases = [
  { suffix: "", quoted: "'xaa'" },
  { suffix: "a b", quoted: "'xaaa b'" },
  { suffix: "a'b", quoted: `"xaaa'b"` },
  { suffix: "a'b'c", quoted: `"xaaa'b'c"` },
  { suffix: "a'b\"c", quoted: "'xaaa'\\''b\"c'" },
  { suffix: "a'b$c", quoted: "'xaaa'\\''b$c'" },
  { suffix: "a'b`c", quoted: "'xaaa'\\''b`c'" },
  { suffix: "a'b\\c", quoted: "'xaaa'\\''b\\c'" },
];

for (const { suffix, quoted } of cases) {
  const args = ["-l1", "--verbose", `--additional-suffix=${suffix}`, "in"];
  const expected = `creating file ${quoted}\ncreating file ${quoted.replace("xaa", "xab")}\n`;

  test(`split verbose quotes suffix ${JSON.stringify(suffix)} asynchronously`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in", new TextEncoder().encode("a\nb\n"));
    const { exitCode, stdout, stderr } = await run(args, "", {}, { fs });
    assert.equal(exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(stdout, expected);
    assert.equal(new TextDecoder().decode(await fs.readFile(`/xaa${suffix}`)), "a\n");
    assert.equal(new TextDecoder().decode(await fs.readFile(`/xab${suffix}`)), "b\n");
  });

  test(`split verbose quotes suffix ${JSON.stringify(suffix)} synchronously`, () => {
    const files = new Map<string, Uint8Array>([["in", new TextEncoder().encode("a\nb\n")]]);
    const stdout = evalSyncSplit(undefined, args, path => files.get(path), (path, bytes) => {
      files.set(path, bytes);
      return true;
    });
    assert.equal(stdout, expected);
    assert.equal(new TextDecoder().decode(files.get(`xaa${suffix}`)), "a\n");
    assert.equal(new TextDecoder().decode(files.get(`xab${suffix}`)), "b\n");
  });
}
