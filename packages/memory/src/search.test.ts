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

  it("returns ripgrep-shaped hits across markdown files in memory pages", async () => {
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

  it("rejects a symlinked memory root before reading external markdown", async () => {
    vol.fromJSON({
      "/outside/memory/INDEX.md": "external needle\n",
      "/outside/memory/pages/secret.md": "needle outside\n"
    });
    vol.mkdirSync("/repo/.poe-code", { recursive: true });
    await vol.promises.symlink("/outside/memory", "/repo/.poe-code/memory");

    await expect(searchMemory("/repo/.poe-code/memory", "needle")).rejects.toThrow(/symbolic link/i);
  });

  it("rejects a symlinked pages directory before scanning", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Index\n",
      "/outside/pages/secret.md": "needle outside\n"
    });
    await vol.promises.symlink("/outside/pages", "/repo/.poe-code/memory/pages");

    await expect(searchMemory("/repo/.poe-code/memory", "needle")).rejects.toThrow(/symbolic link/i);
  });
});
