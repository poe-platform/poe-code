import { describe, expect, it } from "vitest";
import {
  MEMORY_CACHE_DIR_RELPATH,
  MEMORY_INDEX_RELPATH,
  MEMORY_INGEST_CACHE_DIR_RELPATH,
  MEMORY_LOG_RELPATH,
  MEMORY_PAGES_DIR_RELPATH,
  MemoryPathError,
  assertSafeRelPath,
  resolveMemoryRoot
} from "./paths.js";

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
