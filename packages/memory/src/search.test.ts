import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { searchMemory } = await import("./search.js");

describe("searchMemory", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ripgrep-shaped hits across markdown files in the memory tree", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "- superintendent\n",
      "/repo/.poe-code/memory/pages/architecture.md": [
        "# Architecture",
        "",
        "Links to superintendent flow.",
        "superintendent owns checkpoints.",
        ""
      ].join("\n"),
      "/repo/.poe-code/memory/pages/notes.txt": "superintendent should be ignored",
      "/repo/.poe-code/memory/pages/empty.md": ""
    });

    await expect(searchMemory("/repo/.poe-code/memory", "superintendent")).resolves.toEqual([
      {
        relPath: "INDEX.md",
        lineNumber: 1,
        line: "- superintendent"
      },
      {
        relPath: "pages/architecture.md",
        lineNumber: 3,
        line: "Links to superintendent flow."
      },
      {
        relPath: "pages/architecture.md",
        lineNumber: 4,
        line: "superintendent owns checkpoints."
      }
    ]);
  });

  it("returns an empty list when there are no matches", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/pages/architecture.md": "# Architecture\n"
    });

    await expect(searchMemory("/repo/.poe-code/memory", "checkpoint")).resolves.toEqual([]);
  });

  it("rejects an empty query", async () => {
    await expect(searchMemory("/repo/.poe-code/memory", "   ")).rejects.toThrow(/query/i);
  });
});
