import assert from "node:assert/strict";
import { test } from "vitest";
import { MemoryFileSystem, tryGetMemoryDirectoryEntryNamesSync, tryWriteMemoryFileSync } from "../src/fs/memory/index.js";

for (const path of ["/", "/dir"]) {
  for (const cached of [false, true]) {
    test(`directory names require read and search permission: ${path}, cached=${cached}`, async () => {
      const fs = new MemoryFileSystem();
      if (path !== "/") await fs.mkdir(path);
      const prefix = path === "/" ? "/" : `${path}/`;
      await fs.writeFile(`${prefix}file`, Uint8Array.of(1));
      if (cached) assert.equal(tryWriteMemoryFileSync(fs, `${prefix}file`, Uint8Array.of(2), false, 0o666), true);
      assert.ok(tryGetMemoryDirectoryEntryNamesSync(fs, path)?.has("file"));
      await fs.chmod(path, 0o444);
      assert.ok(tryGetMemoryDirectoryEntryNamesSync(fs, path) === undefined);
      await assert.rejects(fs.stat(`${prefix}missing`), { code: "EACCES" });
    });
  }
}
