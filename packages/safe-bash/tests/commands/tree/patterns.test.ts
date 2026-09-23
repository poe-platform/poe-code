import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { shellRun } from "./helpers.js";

// Native tree 2.1.1, LC_ALL=C: only ^ negates a bracket set; ! is a member.
for (const [pattern, included, excluded] of [
  ["[!a]*", "!\na\n", "b\nz\n"],
  ["[!]", "!\n", "a\nb\nz\n"],
  ["[!a-b]*", "!\na\nb\n", "z\n"],
  ["[^a]*", "!\nb\nz\n", "a\n"],
  ["[^!a]*", "b\nz\n", "!\na\n"],
  ["[ab]*", "a\nb\n", "!\nz\n"],
  ["?", "!\na\nb\nz\n", ""],
  ["*", "!\na\nb\nz\n", ""],
] as const) {
  for (const [flag, expected] of [["-P", included], ["-I", excluded]] as const) {
    test(`tree ${flag} '${pattern}' follows native bracket and wildcard semantics`, async () => {
      const fs = createMemoryFileSystem();
      await fs.mkdir("/data");
      for (const name of ["!", "a", "b", "z"]) await fs.writeFile(`/data/${name}`, new Uint8Array());

      const result = await shellRun(fs, ["-i", "--noreport", flag, pattern, "data"]);

      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, `data\n${expected}`);
    });
  }
}
