import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { initMemory } = await import("./init.js");

describe("initMemory", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates the memory root, pages directory, and empty index and log files", async () => {
    await initMemory("/repo/.poe-code/memory");

    await expect(vol.promises.stat("/repo/.poe-code/memory/pages")).resolves.toMatchObject({
      isDirectory: expect.any(Function)
    });
    await expect(vol.promises.readFile("/repo/.poe-code/memory/INDEX.md", "utf8")).resolves.toBe(
      "# Memory index\n"
    );
    await expect(vol.promises.readFile("/repo/.poe-code/memory/LOG.md", "utf8")).resolves.toBe(
      ""
    );
  });

  it("is idempotent and preserves existing memory content", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Existing index\n",
      "/repo/.poe-code/memory/LOG.md": "- existing log\n",
      "/repo/.poe-code/memory/pages/architecture.md": "# Architecture\n"
    });

    await initMemory("/repo/.poe-code/memory");

    await expect(vol.promises.readFile("/repo/.poe-code/memory/INDEX.md", "utf8")).resolves.toBe(
      "# Existing index\n"
    );
    await expect(vol.promises.readFile("/repo/.poe-code/memory/LOG.md", "utf8")).resolves.toBe(
      "- existing log\n"
    );
    await expect(
      vol.promises.readFile("/repo/.poe-code/memory/pages/architecture.md", "utf8")
    ).resolves.toBe("# Architecture\n");
  });

  it("rejects a symlinked memory root before writing scaffold files", async () => {
    vol.fromJSON({
      "/repo/.poe-code/.keep": "",
      "/outside/.keep": ""
    });
    await vol.promises.symlink("/outside", "/repo/.poe-code/memory");

    await expect(initMemory("/repo/.poe-code/memory")).rejects.toThrow(/symbolic link/i);
    await expect(vol.promises.stat("/outside/INDEX.md")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(vol.promises.stat("/outside/LOG.md")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes newly created scaffold artifacts when initialization fails", async () => {
    vi.spyOn(vol.promises, "writeFile").mockImplementation(async (filePath, data, options) => {
      if (String(filePath).endsWith("/LOG.md")) {
        throw new Error("log scaffold failed");
      }

      vol.writeFileSync(String(filePath), data as string, options as never);
    });

    await expect(initMemory("/repo/.poe-code/memory")).rejects.toThrow("log scaffold failed");
    await expect(vol.promises.stat("/repo/.poe-code/memory")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
