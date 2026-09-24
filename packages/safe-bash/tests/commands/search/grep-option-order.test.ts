import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/index.js";
import { grepCommands } from "../../../src/commands/grep.js";

const cases = [
  ["-G 'mat.*' a", "match\n"],
  ["--basic-regexp 'mat.*' a", "match\n"],
  ["-G 'match|nope' a b", "", 1],
  ["-l -L match a b", "b\n"],
  ["-L -l match a b", "a\n"],
  ["-lLl match a b", "a\n"],
  ["--files-with-matches --files-without-match match a b", "b\n"],
  ["--files-without-match --files-with-matches match a b", "a\n"],
  ["-A2 -C0 match a", "match\n"],
  ["-B2 -C0 match a", "match\n"],
  ["-C0 -A2 match a", "match\n3\n4\n"],
  ["-C0 -B2 match a", "1\nmatch\n"],
  ["--after-context=2 --context=0 match a", "match\n"],
  ["--before-context=2 --context=0 match a", "match\n"],
  ["-C1 -A0 match a", "1\nmatch\n"],
  ["-C1 -B0 match a", "match\n3\n"],
  ["-hH match a", "a:match\n"],
  ["-Hh match a b", "match\n"],
  ["--no-filename --with-filename match a", "a:match\n"],
  ["--with-filename --no-filename match a b", "match\n"],
  ["-hHcn --initial-tab match a", "a:1\n"],
  ["-hHn --initial-tab match a", "a:2:\tmatch\n"],
] as const;

for (const [args, stdout, exitCode = 0] of cases) {
  test(`grep option order: ${args}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/a", Buffer.from("1\nmatch\n3\n4\n5\n"));
    await fs.writeFile("/b", Buffer.from("nope\n"));
    const shell = new Shell({ fs });
    for (const command of grepCommands()) shell.commands.register(command);
    try {
      const result = await shell.exec(`grep ${args}`);
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, exitCode);
      assert.equal(result.stdout, stdout);
    } finally { await shell.dispose(); }
  });
}
