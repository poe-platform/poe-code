import { describe, expect, it } from "vitest";
import { createMemoryFs } from "./memory-fs.js";

describe("createMemoryFs", () => {
  it("reads seeded files and returns isolated snapshots", async () => {
    const fs = createMemoryFs({ "/config.json": '{"enabled":true}' });

    await expect(fs.readFile("/config.json")).resolves.toBe('{"enabled":true}');
    await expect(fs.exists("/config.json")).resolves.toBe(true);
    await expect(fs.exists("/missing.json")).resolves.toBe(false);

    const snapshot = fs.snapshot();
    snapshot["/config.json"] = "changed";

    expect(fs.snapshot()).toEqual({ "/config.json": '{"enabled":true}' });
    expect(fs.changes()).toEqual([]);
  });

  it("honors read and write encodings", async () => {
    const fs = createMemoryFs();

    await fs.writeFile("/encoded.txt", "Y2Fmw6k=", { encoding: "base64" });

    await expect(fs.readFile("/encoded.txt", "utf8")).resolves.toBe("café");
    await expect(fs.readFile("/encoded.txt", "base64")).resolves.toBe("Y2Fmw6k=");
    expect(fs.snapshot()).toEqual({ "/encoded.txt": "café" });
  });

  it("reports regular files from lstat", async () => {
    const fs = createMemoryFs({ "/file.txt": "contents" });

    const stats = await fs.lstat("/file.txt");

    expect(stats.isSymbolicLink()).toBe(false);
  });

  it("renames, overwrites, and unlinks files while recording changes", async () => {
    const fs = createMemoryFs({ "/from.txt": "new", "/to.txt": "old" });

    await fs.rename("/from.txt", "/to.txt");
    await fs.unlink("/to.txt");

    expect(fs.snapshot()).toEqual({});
    expect(fs.changes()).toEqual([
      { op: "rename", path: "/from.txt", to: "/to.txt" },
      { op: "unlink", path: "/to.txt" }
    ]);
  });

  it("preserves a file when it is renamed to the same path", async () => {
    const fs = createMemoryFs({ "/file.txt": "contents" });

    await fs.rename("/file.txt", "/file.txt");

    expect(fs.snapshot()).toEqual({ "/file.txt": "contents" });
    expect(fs.changes()).toEqual([{ op: "rename", path: "/file.txt", to: "/file.txt" }]);
  });

  it("records writes in order and returns isolated change arrays", async () => {
    const fs = createMemoryFs();

    await fs.writeFile("/first.txt", "first");
    await fs.writeFile("/second.txt", "second");

    const changes = fs.changes();
    changes[0] = { op: "unlink", path: "/other.txt" };

    expect(fs.changes()).toEqual([
      { op: "writeFile", path: "/first.txt" },
      { op: "writeFile", path: "/second.txt" }
    ]);
  });

  it.each([
    ["readFile", "open", (fs: ReturnType<typeof createMemoryFs>) => fs.readFile("/missing.txt")],
    ["lstat", "lstat", (fs: ReturnType<typeof createMemoryFs>) => fs.lstat("/missing.txt")],
    [
      "rename",
      "rename",
      (fs: ReturnType<typeof createMemoryFs>) => fs.rename("/missing.txt", "/to.txt")
    ],
    ["unlink", "unlink", (fs: ReturnType<typeof createMemoryFs>) => fs.unlink("/missing.txt")]
  ])("matches Node missing-file errors for %s", async (_method, syscall, operation) => {
    const fs = createMemoryFs();

    await expect(operation(fs)).rejects.toMatchObject({
      code: "ENOENT",
      path: "/missing.txt",
      syscall
    });
  });

  it("includes the destination in missing rename errors", async () => {
    const fs = createMemoryFs();

    await expect(fs.rename("/missing.txt", "/to.txt")).rejects.toMatchObject({
      message: "ENOENT: no such file or directory, rename '/missing.txt' -> '/to.txt'",
      code: "ENOENT",
      errno: -2,
      syscall: "rename",
      path: "/missing.txt",
      dest: "/to.txt"
    });
    expect(fs.changes()).toEqual([]);
  });

  it("updates existence after writes, renames, and unlinks", async () => {
    const fs = createMemoryFs();

    await fs.writeFile("/first.txt", "first");
    await expect(fs.exists("/first.txt")).resolves.toBe(true);

    await fs.rename("/first.txt", "/second.txt");
    await expect(fs.exists("/first.txt")).resolves.toBe(false);
    await expect(fs.exists("/second.txt")).resolves.toBe(true);

    await fs.unlink("/second.txt");
    await expect(fs.exists("/second.txt")).resolves.toBe(false);
  });
});
