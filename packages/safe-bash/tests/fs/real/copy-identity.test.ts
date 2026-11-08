import assert from "node:assert/strict";
import test from "node:test";
import { FsError } from "../../../src/contracts/index.js";
import { bytes, fixture } from "./helpers.js";

for (const alias of ["same-path", "hardlink", "symlink"] as const) {
  for (const exclusive of [false, true]) {
    test(`native copy rejects ${alias}, exclusive=${exclusive}, before mutation`, async (context) => {
      const { filesystem } = await fixture(context);
      const sentinel = bytes("native identity sentinel");
      await filesystem.writeFile("/file", sentinel);
      const destination = alias === "same-path" ? "/file" : "/alias";
      if (alias === "hardlink") await filesystem.link("/file", destination);
      if (alias === "symlink") await filesystem.symlink("/file", destination);
      const before = await filesystem.lstat(destination);
      await assert.rejects(filesystem.copyFile("/file", destination, { exclusive }), (error: unknown) => {
        assert.ok(error instanceof FsError);
        assert.equal(error.code, exclusive ? "EEXIST" : "EINVAL");
        assert.equal(error.syscall, "copyFile");
        assert.equal(error.path, "/file");
        assert.equal(error.dest, destination);
        return true;
      });
      const after = await filesystem.lstat(destination);
      for (const key of ["type", "size", "mode", "mtimeMs", "ctimeMs", "birthtimeMs", "dev", "ino", "nlink"] as const) {
        assert.equal(after[key], before[key], key);
      }
      assert.deepEqual(await filesystem.readFile("/file"), sentinel);
      assert.deepEqual(await filesystem.readFile(destination), sentinel);
      if (alias === "symlink") assert.equal(await filesystem.readlink(destination), "/file");
    });
  }
}

test("native identity guard keeps distinct overwrites and exclusive creation supported", async (context) => {
  const { filesystem } = await fixture(context);
  await filesystem.writeFile("/file", bytes("source"));
  await filesystem.writeFile("/other", bytes("target"));
  await filesystem.copyFile("/file", "/other");
  await filesystem.copyFile("/file", "/new", { exclusive: true });
  assert.deepEqual(await filesystem.readFile("/file"), bytes("source"));
  assert.deepEqual(await filesystem.readFile("/other"), bytes("source"));
  assert.deepEqual(await filesystem.readFile("/new"), bytes("source"));
});
