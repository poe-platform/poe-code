import { describe, expect, it } from "vitest";
import { MemoryFileSystem } from "../src/fs/memory/index.js";

describe("MemoryFileSystem resolution allocation budget", () => {
  it("rejects a large cyclic target before expanding it", async () => {
    const fs = new MemoryFileSystem();
    const target = `l/${"a/".repeat(100_000)}`;
    await fs.symlink(target, "/l");
    await expect(fs.stat("/l")).rejects.toMatchObject({ code: "ENAMETOOLONG" });
    expect(await fs.readlink("/l")).toBe(target);
    expect((await fs.lstat("/l")).type).toBe("symlink");
  });

  it("bounds cumulative expansions even when each target fits", async () => {
    const fs = new MemoryFileSystem();
    await fs.symlink(`l/${"a/".repeat(8_000)}`, "/l");
    await expect(fs.stat("/l")).rejects.toMatchObject({ code: "ENAMETOOLONG" });
  });

  it("bounds input splitting and preserves ordinary loop errors", async () => {
    const fs = new MemoryFileSystem();
    await expect(fs.stat(`/${"./".repeat(32_768)}`)).rejects.toMatchObject({ code: "ENAMETOOLONG" });
    await fs.symlink("loop", "/loop");
    await expect(fs.stat("/loop")).rejects.toMatchObject({ code: "ELOOP" });
    expect((await fs.stat(`/${"./".repeat(32_767)}`)).type).toBe("directory");
  });
});
