import assert from "node:assert/strict";
import test from "node:test";
import { type FileSystem } from "../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { createMountFileSystem } from "../../src/fs/mount/index.js";
import { run } from "./helpers.js";

for (const publication of ["copyFile", "writeStream"] as const) test(`cross-device mv refuses an unbound ${publication} overwrite before an ancestor swap can redirect it`, async () => {
  const root = createMemoryFileSystem(), destination = createMemoryFileSystem();
  await root.mkdir("/work");
  await root.writeFile("/work/a", Buffer.from("source"));
  await destination.mkdir("/sub");
  await destination.mkdir("/private");
  await destination.writeFile("/sub/a", Buffer.from("intended"));
  await destination.writeFile("/private/a", Buffer.from("unrelated"));
  const base = createMountFileSystem({ root, mounts: { "/dest": destination } });
  let copies = 0;
  const fs: FileSystem = new Proxy(base, { get(target, key) {
    if (key === "capabilitiesFor") return async (...args: Parameters<NonNullable<typeof base.capabilitiesFor>>) => ({
      ...await base.capabilitiesFor(...args), atomicFileStaging: false,
    });
    if (key === publication) return async (...args: unknown[]) => {
      copies++;
      await destination.rename("/sub", "/held");
      await destination.symlink("/private", "/sub");
      try {
        const publish = base[publication] as (...args: unknown[]) => Promise<void>;
        await publish.apply(base, args);
      }
      finally {
        await destination.rm("/sub");
        await destination.rename("/held", "/sub");
      }
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await run("mv", ["/work/a", "/dest/sub/a"], { fs });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.match(result.stderr, /ENOTSUP.*atomic destination and ancestry binding/u);
  assert.equal(copies, 0);
  assert.equal(Buffer.from(await root.readFile("/work/a")).toString(), "source");
  assert.equal(Buffer.from(await destination.readFile("/sub/a")).toString(), "intended");
  assert.equal(Buffer.from(await destination.readFile("/private/a")).toString(), "unrelated");
});

test("cross-device mv still publishes a missing destination", async () => {
  const root = createMemoryFileSystem(), destination = createMemoryFileSystem();
  await root.writeFile("/a", Buffer.from("source"));
  const fs = createMountFileSystem({ root, mounts: { "/dest": destination } });
  const result = await run("mv", ["/a", "/dest/a"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(await destination.readFile("/a")).toString(), "source");
  await assert.rejects(root.stat("/a"), { code: "ENOENT" });
});

test("same-device mv still replaces an existing regular file", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/a", Buffer.from("source"));
  await fs.writeFile("/b", Buffer.from("target"));
  const result = await run("mv", ["/a", "/b"], { fs });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(Buffer.from(await fs.readFile("/b")).toString(), "source");
  await assert.rejects(fs.stat("/a"), { code: "ENOENT" });
});

test("cross-device mv rejects moving a directory into itself via a symlink ancestor with EINVAL before copying", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/src/sub", { recursive: true });
  await fs.writeFile("/src/sub/file.txt", Buffer.from("payload"));
  await fs.symlink("/src/sub", "/link");
  const originalRename = fs.rename.bind(fs);
  fs.rename = async (from, to) => {
    if (from === "/src") throw Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
    return originalRename(from, to);
  };
  const result = await run("mv", ["/src", "/link/into-self"], { fs });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /EINVAL/u);
  await assert.rejects(fs.lstat("/src/sub/into-self"), { code: "ENOENT" });
  assert.equal(Buffer.from(await fs.readFile("/src/sub/file.txt")).toString(), "payload");
});
