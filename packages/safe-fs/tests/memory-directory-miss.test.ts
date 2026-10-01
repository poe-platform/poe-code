import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "vitest";
import { MemoryFileSystem, tryOpenMemoryRedirectHandleSync } from "../src/fs/memory/index.js";

test("failed redirect followed by directory growth preserves every entry", async () => {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/dir", { mode: 0o555 });
  assert.throws(() => tryOpenMemoryRedirectHandleSync(fs, "/dir/file_0", false, 0o666), { code: "EACCES" });
  await fs.chmod("/dir", 0o755);
  for (let i = 0; i < 65; i++) await fs.mkdir(`/dir/sub_${i}`);
  await fs.mkdir("/dir/file_0");
  assert.equal((await fs.readdir("/dir")).length, 66);
  for (const name of ["file_0", ...Array.from({ length: 65 }, (_, i) => `sub_${i}`)]) {
    assert.equal((await fs.stat(`/dir/${name}`)).type, "directory");
  }
});

test("failed writes do not keep a discarded tenant directory alive", () => {
  execFileSync(process.execPath, ["--expose-gc", "--import", "tsx", "--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { setImmediate } from "node:timers/promises";
    import { MemoryFileSystem, tryOpenMemoryRedirectHandleSync, tryWriteMemoryFileSync } from "./packages/safe-fs/src/fs/memory/index.ts";
    for (const [redirect, code, limits] of [
      [true, "EACCES", {}], [false, "EACCES", {}],
      [true, "ENOSPC", { maxMetadataUnits: 3 }], [false, "ENOSPC", { maxMetadataUnits: 3 }],
      [false, "EFBIG", { maxFileBytes: 0 }],
    ]) {
      const weak = await (async () => {
        const fs = new MemoryFileSystem(limits);
        await fs.mkdir("/dir", { mode: code === "EACCES" ? 0o555 : 0o755 });
        const directory = fs.root.entries.get("dir");
        assert.throws(() => redirect
          ? tryOpenMemoryRedirectHandleSync(fs, "/dir/missing", false, 0o666)
          : tryWriteMemoryFileSync(fs, "/dir/missing", new Uint8Array([1]), false, 0o666), { code });
        return new WeakRef(directory.entries);
      })();
      await setImmediate();
      globalThis.gc();
      assert.ok(weak.deref() === undefined, "failed write retained tenant directory");
    }
  `], { cwd: process.cwd(), stdio: "pipe" });
});
