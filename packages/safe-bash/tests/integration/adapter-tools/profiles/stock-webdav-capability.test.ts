import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../../src/index.js";
import { snapshotTree, withFixture } from "../fixtures.js";

for (const nonempty of [false, true]) {
  const code = nonempty ? "ENOTEMPTY" : "ENOTSUP";
  test(`stock-webdav: ${nonempty ? "nonempty" : "empty"} rmdir is ${code}`, { timeout: 20_000 }, async () => {
    await withFixture("webdav", async ({ fs, exec, dav, dispatched }) => {
      assert.ok(dav);
      assert.ok(fs.rmdir);
      const path = "/work/refusal";
      await fs.mkdir(path);
      if (nonempty) {
        await fs.mkdir(`${path}/nested`);
        await fs.writeFile(`${path}/child`, Uint8Array.of(0, 255, 128, 10));
        await fs.writeFile(`${path}/nested/deep`, Uint8Array.of(1, 254, 0));
      }
      const before = await snapshotTree(fs, "/");
      const backingBefore = [...dav.files].map(([name, value]) => [name, value === null ? null : [...value]]);
      let diagnostic = "";
      await assert.rejects(fs.rmdir(path), reason => {
        assert.ok(reason instanceof FsError);
        assert.equal(reason.code, code);
        assert.equal(reason.path, path);
        assert.equal(reason.syscall, "rmdir");
        diagnostic = reason.message;
        return true;
      });
      const unchanged = async () => {
        assert.deepEqual(await snapshotTree(fs, "/"), before);
        assert.deepEqual([...dav.files].map(([name, value]) => [name, value === null ? null : [...value]]), backingBefore);
        assert.deepEqual(dav.requests.filter(request => request.init.method === "DELETE"), []);
      };
      await unchanged();
      for (const command of ["rmdir", "rm -d"]) {
        const result = await exec(`${command} ${path}`);
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, "");
        const expected = nonempty ? diagnostic : new FsError("ENOTSUP", { syscall: "rmdir", path }).message;
        assert.equal(result.stderr, `${command === "rmdir" ? "rmdir" : "rm"}: ${expected}\n`);
        await unchanged();
      }
      assert.ok(dispatched.includes("rmdir"));
      assert.ok(dispatched.includes("rm"));
    });
  });
}
