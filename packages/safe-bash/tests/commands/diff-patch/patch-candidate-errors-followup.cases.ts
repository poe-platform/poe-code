import assert from "node:assert/strict";
import test from "node:test";
import { FsError, type FileSystem } from "../../../src/contracts/index.js";
import { contents, filesystem, replacement, run } from "./helpers.js";

for (const atomic of [false, true]) for (const dryRun of [false, true]) {
  for (const parent of [false, true]) {
    test(`followup unused looping candidate parent=${parent}, atomic=${atomic}, dryRun=${dryRun}`, async () => {
      const fs = await filesystem({ a: "old\n", sentinel: "untouched\n" });
      await fs.symlink("unused-long-name", "/work/unused-long-name");
      const link = await fs.lstat("/work/unused-long-name");
      const input = replacement.replace("--- target", "--- a").replace("+++ target", `+++ unused-long-name${parent ? "/child" : ""}`);
      const result = await run("patch", ["--batch", "-p0", ...(atomic ? ["--atomic"] : []), ...(dryRun ? ["--dry-run"] : [])], { fs, input });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(await contents(fs, "a"), dryRun ? "old\n" : "new\n");
      assert.equal(await contents(fs, "sentinel"), "untouched\n");
      assert.equal(await fs.readlink("/work/unused-long-name"), "unused-long-name");
      assert.deepEqual(await fs.lstat("/work/unused-long-name"), link);
      assert.deepEqual((await fs.readdir("/work")).map(entry => entry.name).sort(), ["a", "sentinel", "unused-long-name"]);
    });
  }
  test(`followup selected looping candidate remains forbidden, atomic=${atomic}, dryRun=${dryRun}`, async () => {
    const fs = await filesystem({ sentinel: "untouched\n" });
    await fs.symlink("target", "/work/target");
    const result = await run("patch", [...(atomic ? ["--atomic"] : []), ...(dryRun ? ["--dry-run"] : [])], { fs, input: replacement });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /symlink/u);
    assert.equal(await fs.readlink("/work/target"), "target");
    assert.equal(await contents(fs, "sentinel"), "untouched\n");
  });
}

test("followup candidate I/O failures are not mistaken for nonexistent paths", async () => {
  const backing = await filesystem({ a: "old\n" });
  const fs = new Proxy(backing, {
    get(target, key) {
      if (key === "stat") return async (path: string) => {
        if (path === "/work/unused-long-name") throw new FsError("EIO", { path });
        return target.stat(path);
      };
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as FileSystem;
  const result = await run("patch", [], { fs, input: replacement.replace("--- target", "--- a").replace("+++ target", "+++ unused-long-name") });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /EIO/u);
  assert.equal(await contents(backing, "a"), "old\n");
});
