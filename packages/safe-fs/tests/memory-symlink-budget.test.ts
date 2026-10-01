import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";

describe("MemoryFileSystem resolution allocation budget", () => {
  it("rejects a large cyclic target before expanding it", async () => {
    const fs = new MemoryFileSystem({ maxPathBytes: 65_536, maxPathComponents: 256 });
    const target = `l/${"a/".repeat(100_000)}`;
    await expect(fs.symlink(target, "/l")).rejects.toMatchObject({ code: "ENAMETOOLONG" });
    await expect(fs.lstat("/l")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("bounds cumulative expansions even when each target fits", async () => {
    const fs = new MemoryFileSystem({ maxPathBytes: 65_536, maxPathComponents: 256 });
    await fs.symlink(`l/${"a/".repeat(128)}`, "/l");
    await expect(fs.stat("/l")).rejects.toMatchObject({ code: "ENAMETOOLONG" });
  });

  it("bounds input splitting and preserves ordinary loop errors", async () => {
    const fs = new MemoryFileSystem({ maxPathBytes: 65_536, maxPathComponents: 256 });
    await expect(fs.stat(`/${"./".repeat(32_768)}`)).rejects.toMatchObject({ code: "ENAMETOOLONG" });
    await fs.symlink("loop", "/loop");
    await expect(fs.stat("/loop")).rejects.toMatchObject({ code: "ELOOP" });
    await expect(fs.stat(`/${"./".repeat(32_767)}`)).rejects.toMatchObject({ code: "ENAMETOOLONG" });
    expect((await fs.stat("/".repeat(65_536))).type).toBe("directory");
    await expect(fs.stat("/".repeat(65_537))).rejects.toMatchObject({ code: "ENAMETOOLONG" });
    expect((await fs.stat(`/${"./".repeat(256)}`)).type).toBe("directory");
    await expect(fs.stat(`/${"./".repeat(257)}`)).rejects.toMatchObject({ code: "ENAMETOOLONG" });
  });
});
