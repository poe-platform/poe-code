import assert from "node:assert/strict";
import test from "node:test";
import { fixture, run } from "./helpers.js";

for (const alias of [false, true]) {
  test(`ln -sf preserves the same entry through ${alias ? "a parent symlink" : "a direct path"}`, async () => {
    const fs = await fixture({ "real/a": "precious" });
    await fs.symlink("real", "/work/sym");
    const result = await run("ln", ["-sf", "/work/real/a", alias ? "/work/sym/a" : "/work/real/a"], { fs });
    assert.equal(result.exitCode, 1);
    assert.equal((await fs.lstat("/work/real/a")).type, "file");
    assert.equal(new TextDecoder().decode(await fs.readFile("/work/real/a")), "precious");
  });
}

for (const cwd of ["/a", "/a/b"]) {
  test(`rmdir -p removes absolute ancestors past cwd ${cwd}`, async () => {
    const fs = await fixture();
    await fs.mkdir("/a/b/c", { recursive: true });
    const result = await run("rmdir", ["-p", "/a/b/c"], { fs, cwd });
    assert.equal(result.exitCode, 0, result.stderr);
    for (const path of ["/a/b/c", "/a/b", "/a"]) await assert.rejects(fs.stat(path), { code: "ENOENT" });
    assert.equal((await fs.stat("/")).type, "directory");
  });
}

test("ln -sf permits a dangling source and distinct symlink entries", async () => {
  const fs = await fixture({ target: "old" });
  assert.equal((await run("ln", ["-sf", "missing/entry", "target"], { fs })).exitCode, 0);
  assert.equal(await fs.readlink("/work/target"), "missing/entry");
  await fs.symlink("target", "/work/alias");
  assert.equal((await run("ln", ["-sf", "target", "alias"], { fs })).exitCode, 0);
  assert.equal(await fs.readlink("/work/alias"), "target");
});
