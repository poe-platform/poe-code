import assert from "node:assert/strict";
import test from "node:test";
import { isFsError } from "../../../src/contracts/errors.js";
import type { ErrnoCode } from "../../../src/contracts/errors.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

async function rejects(action: Promise<unknown>, code: ErrnoCode): Promise<void> {
  await assert.rejects(action, (error: unknown) => isFsError(error, code));
}

async function fixture(): Promise<MemoryFileSystem> {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/dir/child", { recursive: true });
  await filesystem.writeFile("/dir/child/sentinel", bytes("preserved"));
  return filesystem;
}

async function assertPreserved(filesystem: MemoryFileSystem): Promise<void> {
  assert.equal(text(await filesystem.readFile("/dir/child/sentinel")), "preserved");
  assert.deepEqual(await filesystem.readdir("/"), [{ name: "dir", type: "directory" }]);
  assert.deepEqual(await filesystem.readdir("/dir"), [{ name: "child", type: "directory" }]);
}

for (const path of ["/dir/.", "/dir/./", "/dir//.//", "/dir/child/..", "/dir/child/..//"]) {
  test(`review: recursive rm of terminal dot component ${path} rejects EINVAL and preserves the tree`, async () => {
    const filesystem = await fixture();
    const before = await filesystem.stat("/dir");
    await rejects(filesystem.rm(path, { recursive: true }), "EINVAL");
    await rejects(filesystem.rm(path, { recursive: true, force: true }), "EINVAL");
    assert.deepEqual(await filesystem.stat("/dir"), before);
    await assertPreserved(filesystem);
  });

  test(`review: rename from terminal dot component ${path} rejects EINVAL and preserves the tree`, async () => {
    const filesystem = await fixture();
    const before = await filesystem.stat("/dir");
    await assert.rejects(filesystem.rename(path, "/moved"), (error: unknown) => {
      assert.ok(isFsError(error, "EINVAL"));
      assert.equal(error.path, path);
      assert.equal(error.dest, "/moved");
      assert.equal(error.syscall, "rename");
      return true;
    });
    assert.deepEqual(await filesystem.stat("/dir"), before);
    await assertPreserved(filesystem);
  });

  test(`review: rename to terminal dot component ${path} rejects EINVAL and preserves both operands`, async () => {
    const filesystem = await fixture();
    await filesystem.mkdir("/source");
    const before = await filesystem.stat("/dir");
    await rejects(filesystem.rename("/source", path), "EINVAL");
    assert.deepEqual(await filesystem.stat("/dir"), before);
    assert.equal((await filesystem.stat("/source")).type, "directory");
    assert.equal(text(await filesystem.readFile("/dir/child/sentinel")), "preserved");
  });
}

test("review: exact directory rename to missing trailing-slash destination succeeds", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/directory");
  await filesystem.writeFile("/directory/sentinel", bytes("moved"));
  const before = await filesystem.stat("/directory");
  await filesystem.rename("/directory", "/newdirectory/");
  await rejects(filesystem.stat("/directory"), "ENOENT");
  assert.equal((await filesystem.stat("/newdirectory")).ino, before.ino);
  assert.equal(text(await filesystem.readFile("/newdirectory/sentinel")), "moved");
});

test("review: regular file cannot be renamed to a missing trailing-slash destination", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", bytes("preserved"));
  const before = await filesystem.stat("/file");
  await rejects(filesystem.rename("/file", "/newdirectory/"), "ENOTDIR");
  assert.deepEqual(await filesystem.stat("/file"), before);
  await rejects(filesystem.stat("/newdirectory"), "ENOENT");
  assert.equal(text(await filesystem.readFile("/file")), "preserved");
});

test("review: existing regular-file destination with trailing slash rejects without replacement", async () => {
  const filesystem = await fixture();
  await filesystem.writeFile("/file", bytes("preserved"));
  await filesystem.writeFile("/source-file", bytes("source"));
  await rejects(filesystem.rename("/dir", "/file/"), "ENOTDIR");
  await rejects(filesystem.rename("/source-file", "/file/"), "ENOTDIR");
  assert.equal(text(await filesystem.readFile("/file")), "preserved");
  assert.equal(text(await filesystem.readFile("/source-file")), "source");
  assert.equal(text(await filesystem.readFile("/dir/child/sentinel")), "preserved");
});

test("review: mixed symlink and parent traversal precedes trailing-directory rename validation", async () => {
  const filesystem = await fixture();
  await filesystem.mkdir("/a/b", { recursive: true });
  await filesystem.symlink("/a/b", "/link");
  await filesystem.rename("/dir", "/link/../newdirectory/");
  assert.equal(text(await filesystem.readFile("/a/newdirectory/child/sentinel")), "preserved");
  await rejects(filesystem.stat("/newdirectory"), "ENOENT");
  await rejects(filesystem.stat("/dir"), "ENOENT");
  assert.equal(await filesystem.readlink("/link"), "/a/b");
});

test("review: mixed symlink paths with terminal dot and dotdot cannot mutate resolved directories", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/a/b", { recursive: true });
  await filesystem.writeFile("/a/sentinel", bytes("preserved"));
  await filesystem.symlink("/a/b", "/link");
  for (const path of ["/link/.", "/link/..", "/link/../.", "/link/../b/..//"]) {
    await rejects(filesystem.rm(path, { recursive: true }), "EINVAL");
    await rejects(filesystem.rename(path, "/moved"), "EINVAL");
    assert.equal(text(await filesystem.readFile("/a/sentinel")), "preserved");
    assert.equal((await filesystem.stat("/a/b")).type, "directory");
    assert.equal(await filesystem.readlink("/link"), "/a/b");
    await rejects(filesystem.stat("/moved"), "ENOENT");
  }
});

test("review: terminal-dot validation does not erase missing or non-directory traversal errors", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/file", bytes("preserved"));
  for (const path of ["/file/.", "/file/..", "/file/./", "/file/../"]) {
    await rejects(filesystem.rm(path, { recursive: true }), "ENOTDIR");
    await rejects(filesystem.rename(path, "/moved"), "ENOTDIR");
  }
  for (const path of ["/absent/.", "/absent/..", "/absent/../file"]) {
    await rejects(filesystem.rm(path, { recursive: true }), "ENOENT");
    await rejects(filesystem.rename(path, "/moved"), "ENOENT");
  }
  assert.equal(text(await filesystem.readFile("/file")), "preserved");
});

test("review: operation paths and absolute or relative symlink targets preserve mixed components", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/a/b", { recursive: true });
  await filesystem.mkdir("/relative");
  await filesystem.writeFile("/a/x", bytes("RIGHT"));
  await filesystem.writeFile("/x", bytes("WRONG"));
  await filesystem.symlink("/a/b", "/link");
  await filesystem.symlink("/link/../x", "/absolute-alias");
  await filesystem.symlink("../link/../x", "/relative/alias");
  for (const path of ["/link/../x", "/absolute-alias", "/relative/alias"]) {
    assert.equal(text(await filesystem.readFile(path)), "RIGHT");
    assert.equal(await filesystem.realpath(path), "/a/x");
  }
  assert.equal(await filesystem.readlink("/absolute-alias"), "/link/../x");
  assert.equal(await filesystem.readlink("/relative/alias"), "../link/../x");
});

test("review: ordinary mixed-component mutations resolve their physical parent", async () => {
  const filesystem = new MemoryFileSystem();
  await filesystem.mkdir("/a/b", { recursive: true });
  await filesystem.writeFile("/a/x", bytes("RIGHT"));
  await filesystem.writeFile("/x", bytes("WRONG"));
  await filesystem.symlink("/a/b", "/link");
  await filesystem.rename("/link/../x", "/link/../renamed");
  assert.equal(text(await filesystem.readFile("/a/renamed")), "RIGHT");
  assert.equal(text(await filesystem.readFile("/x")), "WRONG");
  await filesystem.rm("/link/../renamed");
  await rejects(filesystem.stat("/a/renamed"), "ENOENT");
  assert.equal(text(await filesystem.readFile("/x")), "WRONG");
});
