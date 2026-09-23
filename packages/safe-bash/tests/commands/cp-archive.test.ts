import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";
import { Shell } from "../../src/shell/index.js";
import { agentCommands } from "../../src/plugins/index.js";

for (const option of ["--archive", "-a"]) {
  test(`cp ${option} copies directory trees and preserves symbolic links`, async () => {
    const fs = await fixture({ "tree/input": "abc\n", "tree/deep/file": "nested" });
    await fs.mkdir("/work/tree/empty");
    await fs.symlink("input", "/work/tree/link");
    await fs.symlink("missing", "/work/tree/dangling");
    await fs.symlink("tree", "/work/alias");
    const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
    try {
      const result = await shell.exec(`cp ${option} tree copy; cat copy/input`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "abc\n");
      assert.equal(new TextDecoder().decode(await fs.readFile("/work/copy/deep/file")), "nested");
      assert.equal((await fs.stat("/work/copy/empty")).type, "directory");
      assert.equal(await fs.readlink("/work/copy/link"), "input");
      assert.equal(await fs.readlink("/work/copy/dangling"), "missing");
      const link = await shell.exec(`cp ${option} alias copied-alias`);
      assert.equal(link.exitCode, 0, link.stderr);
      assert.equal(await fs.readlink("/work/copied-alias"), "tree");
    } finally { await shell.dispose(); }
  });
}

test("archive copies retain verbose, no-clobber and self-copy protection", async () => {
  const fs = await fixture({ "tree/input": "new", "target/tree/input": "kept" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec("cp -av tree copy");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "'tree/input' -> 'copy/input'\n" + "'tree' -> 'copy'\n");
    const skipped = await shell.exec("cp -an tree target");
    assert.equal(skipped.exitCode, 0, skipped.stderr);
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/target/tree/input")), "kept");
    const recursive = await shell.exec("cp -a tree tree/inside");
    assert.equal(recursive.exitCode, 1);
    assert.ok(recursive.stderr.includes("cannot copy a directory into itself"));
    await assert.rejects(fs.stat("/work/tree/inside"), { code: "ENOENT" });
  } finally { await shell.dispose(); }
});
