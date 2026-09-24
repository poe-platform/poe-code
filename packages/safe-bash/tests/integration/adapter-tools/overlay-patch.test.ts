import assert from "node:assert/strict";
import test from "node:test";
import { original, revised, snapshotTree, success, withFixture } from "./fixtures.js";

const options = { timeout: 20_000 };

for (const atomic of [false, true]) {
  test(`overlay: patch creates, deletes and reverses across copy-up and whiteouts (${atomic})`, options, async () => {
    await withFixture("overlay", async ({ exec, fs, lower }) => {
      const patch = "--- /dev/null\n+++ created/nested/file.txt\n@@ -0,0 +1 @@\n+created\n"
        + "--- old.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-alpha\n-beta\n";
      const before = await snapshotTree(fs);
      const lowerBefore = await snapshotTree(lower!);
      success(await exec(`patch --batch -p0${atomic ? " --atomic" : ""}`, { stdin: patch }));
      assert.equal(Buffer.from(await fs.readFile("/work/created/nested/file.txt")).toString(), "created\n");
      await assert.rejects(fs.lstat("/work/old.txt"), { code: "ENOENT" });
      success(await exec(`patch --batch -p0 -R${atomic ? " --atomic" : ""}`, { stdin: patch }));
      assert.deepEqual(await snapshotTree(fs), before);
      assert.deepEqual(await snapshotTree(lower!), lowerBefore);
    });
  });
}

test("overlay: generated patch replaces lower bytes and reverses upper bytes", options, async () => {
  await withFixture("overlay", async ({ exec, fs, lower }) => {
    const before = await snapshotTree(lower!);
    const diff = await exec("diff -u --label target.txt --label target.txt old.txt new.txt > generated.diff");
    assert.equal(diff.exitCode, 1, diff.stderr);
    success(await exec("patch -i generated.diff"));
    assert.equal(Buffer.from(await fs.readFile("/work/target.txt")).toString(), revised);
    success(await exec("patch -R -i generated.diff"));
    assert.equal(Buffer.from(await fs.readFile("/work/target.txt")).toString(), original);
    assert.deepEqual(await snapshotTree(lower!), before);
    assert.ok((await fs.readdir("/work")).every(entry => !entry.name.startsWith(".patch-")));
  });
});
