import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());

test("fast writes use operation time even when the clock was zero at module load", async () => {
  vi.resetModules();
  const clock = vi.spyOn(Date, "now").mockReturnValue(0);
  const { MemoryFileSystem: FreshMemoryFileSystem, tryWriteMemoryFileSync: write,
    tryOpenMemoryRedirectHandleSync, tryReadMemoryFileViewSync, tryMkdirMemorySync,
    tryRmRfMemorySync } = await import("../src/fs/memory/index.js");
  clock.mockReturnValue(1000);
  const fs = new FreshMemoryFileSystem();
  await fs.mkdir("/dir");
  for (let index = 0; index < 20; index++) {
    const now = 2000 + index;
    clock.mockReturnValue(now);
    if (index % 2 === 0) fs.writeMemoryFileInDirFast("/dir/", `file${index}`, Uint8Array.of(1), false, 0o666);
    else assert.equal(write(fs, `/dir/file${index}`, Uint8Array.of(1), false, 0o666), true);
    const stat = await fs.stat(`/dir/file${index}`);
    assert.equal(stat.mtimeMs, now);
    assert.equal(stat.ctimeMs, now);
    assert.equal(stat.birthtimeMs, now);
  }
  clock.mockReturnValue(3000);
  const handle = tryOpenMemoryRedirectHandleSync(fs, "/dir/redirect", false, 0o666);
  assert.ok(handle);
  assert.equal((await fs.stat("/dir/redirect")).birthtimeMs, 3000);
  clock.mockReturnValue(4000);
  handle.writeImmutableSync(Uint8Array.of(1));
  assert.equal((await fs.stat("/dir/redirect")).mtimeMs, 4000);
  clock.mockReturnValue(5000);
  handle.writeRangeSync(Uint8Array.of(2), 1);
  handle.close();
  assert.equal((await fs.stat("/dir/redirect")).mtimeMs, 5000);
  clock.mockReturnValue(6000);
  assert.ok(tryReadMemoryFileViewSync(fs, "/dir/redirect"));
  assert.equal((await fs.stat("/dir/redirect")).atimeMs, 6000);
  clock.mockReturnValue(7000);
  assert.equal(tryMkdirMemorySync(fs, "/dir/nested/child", true, 0o755), true);
  assert.equal((await fs.stat("/dir/nested/child")).mtimeMs, 7000);
  clock.mockReturnValue(8000);
  assert.equal(tryRmRfMemorySync(fs, "/dir/nested"), true);
  assert.equal((await fs.stat("/dir")).mtimeMs, 8000);
});
