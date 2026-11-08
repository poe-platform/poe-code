import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";
import {
  MEMORY_CACHE_DIR_RELPATH,
  MEMORY_INDEX_RELPATH,
  MEMORY_INGEST_CACHE_DIR_RELPATH,
  MEMORY_LOG_RELPATH,
  MEMORY_PAGES_DIR_RELPATH,
  MemoryPathError,
  assertMemoryRootIsNotSymlink,
  assertSafeRelPath,
  resolveMemoryRoot
} from "./paths.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

describe("resolveMemoryRoot", () => {
  it("places memory under .poe-code/memory in the provided cwd", () => {
    expect(resolveMemoryRoot("/repo")).toBe("/repo/.poe-code/memory");
    expect(resolveMemoryRoot("/repo/nested")).toBe("/repo/nested/.poe-code/memory");
  });

  it("exposes the planned relative path constants", () => {
    expect(MEMORY_INDEX_RELPATH).toBe("INDEX.md");
    expect(MEMORY_LOG_RELPATH).toBe("LOG.md");
    expect(MEMORY_PAGES_DIR_RELPATH).toBe("pages");
    expect(MEMORY_CACHE_DIR_RELPATH).toBe(".cache");
    expect(MEMORY_INGEST_CACHE_DIR_RELPATH).toBe(".cache/ingest");
  });
});

describe("assertSafeRelPath", () => {
  it("returns a normalized posix relative path", () => {
    expect(assertSafeRelPath("./pages//packages/../packages/superintendent.md")).toBe(
      "pages/packages/superintendent.md"
    );
    expect(assertSafeRelPath("pages\\packages\\superintendent.md")).toBe(
      "pages/packages/superintendent.md"
    );
  });

  it("rejects empty, absolute, and traversal paths", () => {
    expect(() => assertSafeRelPath("")).toThrow(MemoryPathError);
    expect(() => assertSafeRelPath(".")).toThrow(/relative path/i);
    expect(() => assertSafeRelPath("/repo/pages/test.md")).toThrow(/absolute/i);
    expect(() => assertSafeRelPath("../secret.md")).toThrow(/escape/i);
    expect(() => assertSafeRelPath("pages/../../secret.md")).toThrow(/escape/i);
  });
});

describe("assertMemoryRootIsNotSymlink", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("allows the normal macOS /var to /private/var system alias", async () => {
    vol.fromJSON({
      "/private/var/folders/test/memory/.keep": ""
    });
    await vol.promises.symlink("/private/var", "/var");

    await expect(
      assertMemoryRootIsNotSymlink("/var/folders/test/memory")
    ).resolves.toBeUndefined();
  });

  it("still rejects user-controlled symlinked root segments", async () => {
    vol.fromJSON({
      "/repo/.poe-code/.keep": "",
      "/outside/memory/.keep": ""
    });
    await vol.promises.symlink("/outside/memory", "/repo/.poe-code/memory");

    await expect(assertMemoryRootIsNotSymlink("/repo/.poe-code/memory")).rejects.toThrow(
      /symbolic link/i
    );
  });
});
