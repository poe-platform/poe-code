import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { evalSyncSplit } from "./index.js";
import { files, run } from "./test-helpers.js";

for (const args of [["--by=2"], ["--by", "2"]]) {
  test(`split accepts ${args.join(" ")} with a file operand`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in", Buffer.from("abc"));
    const result = await run([...args, "in"], "", {}, { fs });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await files(fs), { in: "616263", xaa: "6162", xab: "63" });
  });
}

for (const [args, expected, stdout] of [
  [["--lines=1"], { xaa: "610a", xab: "620a" }, ""],
  [["--line-=2"], { xaa: "610a", xab: "620a" }, ""],
  [["--by=2", "--suf=1", "--add=.txt"], { "xa.txt": "610a", "xb.txt": "620a" }, ""],
  [["--by=2", "--numeric-s=9"], { x09: "610a", x10: "620a" }, ""],
  [["--by=2", "--hex=f"], { x0f: "610a", x10: "620a" }, ""],
  [["--by=2", "--numeric-s"], { x00: "610a", x01: "620a" }, ""],
  [["--lines=1", "--sep=\\0"], { xaa: "610a620a" }, ""],
  [["--numb=6", "--elide", "--unb"], { xaa: "61", xab: "0a", xac: "62", xad: "0a" }, ""],
  [["--by=2", "--verb"], { xaa: "610a", xab: "620a" }, "creating file 'xaa'\ncreating file 'xab'\n"],
] as const) {
  test(`split accepts unique long options: ${args.join(" ")}`, async () => {
    const result = await run(args, "a\nb\n");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, stdout);
    assert.deepEqual(await files(result.fs), expected);

    const written: Record<string, string> = {};
    assert.equal(evalSyncSplit(Buffer.from("a\nb\n"), args, undefined, (path, bytes) => {
      written[path] = Buffer.from(bytes).toString("hex");
      return true;
    }), stdout);
    assert.deepEqual(written, expected);
  });
}

for (const option of ["--v", "--ver", "--ver=2", "--li=2", "--lin=2", "--n=2", "--s=2", "--he"]) {
  test(`split rejects ambiguous ${option} before writing`, async () => {
    const result = await run([option], "abc");
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("ambiguous"), result.stderr);
    assert.deepEqual(await files(result.fs), {});
    assert.equal(evalSyncSplit(Buffer.from("abc"), [option], undefined, () => {
      assert.fail("ambiguous options must not write files");
    }), undefined);
  });
}

for (const option of ["--verb=yes", "--elide=yes", "--unb=yes", "--hel=yes", "--vers=yes", "--by", "--unknown", "--constructor"]) {
  test(`split rejects invalid ${option} before writing`, async () => {
    const result = await run([option], "abc");
    assert.equal(result.exitCode, 1);
    assert.deepEqual(await files(result.fs), {});
  });
}

for (const [abbreviated, full] of [["--hel", "--help"], ["--vers", "--version"]]) {
  test(`split accepts ${abbreviated} and stops option parsing`, async () => {
    const expected = await run([full!]);
    const args = ["--by=2", abbreviated!, "--invalid"];
    const result = await run(args, "abc");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected.stdout);
    assert.deepEqual(await files(result.fs), {});
    assert.equal(evalSyncSplit(undefined, args), expected.stdout);
  });
}

test("split preserves option-like operands after --", async () => {
  const result = await run(["--by=2", "--", "-", "--verb"], "abc");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.deepEqual(await files(result.fs), { "--verbaa": "6162", "--verbab": "63" });
});
