import { describe, it, expect } from "vitest";
import { createMockFs } from "./mock-fs.js";

describe("createMockFs", () => {
  describe("initialization", () => {
    it("creates empty filesystem", () => {
      const fs = createMockFs();
      expect(fs.files).toEqual({});
    });

    it("initializes with provided files", () => {
      const fs = createMockFs({
        "~/.config.json": '{"key": "value"}'
      });
      expect(fs.files["/home/test/.config.json"]).toBe('{"key": "value"}');
    });

    it("expands ~ paths in initial files", () => {
      const fs = createMockFs({
        "~/.config/app/settings.json": "{}"
      });
      expect(fs.exists("~/.config/app/settings.json")).toBe(true);
    });

    it("creates parent directories for initial files", () => {
      const fs = createMockFs({
        "~/.config/app/deep/settings.json": "{}"
      });
      expect(fs.directories.has("/home/test/.config")).toBe(true);
      expect(fs.directories.has("/home/test/.config/app")).toBe(true);
      expect(fs.directories.has("/home/test/.config/app/deep")).toBe(true);
    });

    it("uses custom homeDir", () => {
      const fs = createMockFs({ "~/.config": "{}" }, "/custom/home");
      expect(fs.files["/custom/home/.config"]).toBe("{}");
    });
  });

  describe("exists", () => {
    it("returns true for existing file", () => {
      const fs = createMockFs({ "~/.config": "{}" });
      expect(fs.exists("~/.config")).toBe(true);
    });

    it("returns false for non-existing file", () => {
      const fs = createMockFs();
      expect(fs.exists("~/.config")).toBe(false);
    });

    it("returns true for existing directory", () => {
      const fs = createMockFs();
      expect(fs.exists("/home/test")).toBe(true);
    });
  });

  describe("getContent", () => {
    it("returns file content", () => {
      const fs = createMockFs({ "~/.config": '{"key": "value"}' });
      expect(fs.getContent("~/.config")).toBe('{"key": "value"}');
    });

    it("returns undefined for non-existing file", () => {
      const fs = createMockFs();
      expect(fs.getContent("~/.config")).toBeUndefined();
    });
  });

  describe("readFile", () => {
    it("reads existing file", async () => {
      const fs = createMockFs({ "~/.config": "content" });
      const content = await fs.readFile("/home/test/.config", "utf8");
      expect(content).toBe("content");
    });

    it("throws ENOENT for missing file", async () => {
      const fs = createMockFs();
      await expect(fs.readFile("/home/test/.missing", "utf8")).rejects.toThrow("ENOENT");
    });
  });

  describe("writeFile", () => {
    it("writes to existing directory", async () => {
      const fs = createMockFs();
      await fs.mkdir("/home/test/.config", { recursive: true });
      await fs.writeFile("/home/test/.config/settings.json", "{}");
      expect(fs.files["/home/test/.config/settings.json"]).toBe("{}");
    });

    it("throws ENOENT when parent directory missing", async () => {
      const fs = createMockFs();
      await expect(
        fs.writeFile("/home/test/.missing/file", "content")
      ).rejects.toThrow("ENOENT");
    });

    it("overwrites existing file", async () => {
      const fs = createMockFs({ "~/.config": "old" });
      await fs.writeFile("/home/test/.config", "new");
      expect(fs.files["/home/test/.config"]).toBe("new");
    });
  });

  describe("mkdir", () => {
    it("creates directory", async () => {
      const fs = createMockFs();
      await fs.mkdir("/home/test/.config", { recursive: true });
      expect(fs.directories.has("/home/test/.config")).toBe(true);
    });

    it("creates nested directories with recursive option", async () => {
      const fs = createMockFs();
      await fs.mkdir("/home/test/.config/app/deep", { recursive: true });
      expect(fs.directories.has("/home/test/.config")).toBe(true);
      expect(fs.directories.has("/home/test/.config/app")).toBe(true);
      expect(fs.directories.has("/home/test/.config/app/deep")).toBe(true);
    });

    it("throws ENOENT without recursive when parent missing", async () => {
      const fs = createMockFs();
      await expect(
        fs.mkdir("/home/test/.missing/dir")
      ).rejects.toThrow("ENOENT");
    });
  });

  describe("unlink", () => {
    it("deletes existing file", async () => {
      const fs = createMockFs({ "~/.config": "{}" });
      await fs.unlink("/home/test/.config");
      expect(fs.exists("~/.config")).toBe(false);
    });

    it("throws ENOENT for missing file", async () => {
      const fs = createMockFs();
      await expect(fs.unlink("/home/test/.missing")).rejects.toThrow("ENOENT");
    });
  });

  describe("stat", () => {
    it("returns mode for existing file", async () => {
      const fs = createMockFs({ "~/.config": "{}" });
      const stat = await fs.stat("/home/test/.config");
      expect(stat.mode).toBe(0o644);
    });

    it("returns mode for existing directory", async () => {
      const fs = createMockFs();
      const stat = await fs.stat("/home/test");
      expect(stat.mode).toBe(0o755);
    });

    it("throws ENOENT for missing path", async () => {
      const fs = createMockFs();
      await expect(fs.stat("/home/test/.missing")).rejects.toThrow("ENOENT");
    });
  });

  describe("chmod", () => {
    it("does not throw for existing file", async () => {
      const fs = createMockFs({ "~/.config": "{}" });
      await expect(fs.chmod("/home/test/.config", 0o755)).resolves.not.toThrow();
    });

    it("throws ENOENT for missing file", async () => {
      const fs = createMockFs();
      await expect(fs.chmod("/home/test/.missing", 0o755)).rejects.toThrow("ENOENT");
    });
  });
});
