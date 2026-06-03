import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { listPages, readPage } = await import("./pages.js");

describe("listPages", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sorts markdown pages by relPath and skips non-markdown files", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    vol.fromJSON({
      "/repo/.poe-code/memory/pages/zeta.md": "# Zeta\n",
      "/repo/.poe-code/memory/pages/packages/alpha.md": [
        "---",
        "description: Alpha package",
        "---",
        "# Alpha",
        "",
        "Body",
        ""
      ].join("\n"),
      "/repo/.poe-code/memory/pages/notes.txt": "ignore me",
      "/repo/.poe-code/memory/INDEX.md": "# Index\n"
    });

    await expect(listPages("/repo/.poe-code/memory")).resolves.toEqual([
      {
        relPath: "pages/packages/alpha.md",
        frontmatter: {
          description: "Alpha package"
        },
        body: "# Alpha\n\nBody\n",
        bytes: Buffer.byteLength(
          ["---", "description: Alpha package", "---", "# Alpha", "", "Body", ""].join("\n")
        ),
        mtimeMs: expect.any(Number)
      },
      {
        relPath: "pages/zeta.md",
        frontmatter: {},
        body: "# Zeta\n",
        bytes: Buffer.byteLength("# Zeta\n"),
        mtimeMs: expect.any(Number)
      }
    ]);
  });

  it("does not discover markdown pages through symlinked directories", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/pages/local.md": "# Local\n",
      "/outside/secret.md": "# Outside\nsecret text\n"
    });
    await vol.promises.symlink("/outside", "/repo/.poe-code/memory/pages/linked");

    await expect(listPages("/repo/.poe-code/memory")).resolves.toMatchObject([
      { relPath: "pages/local.md", body: "# Local\n" }
    ]);
  });
});

describe("readPage", () => {
  beforeEach(() => {
    vol.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses frontmatter for a markdown page inside the memory root", async () => {
    const content = [
      "---",
      "name: superintendent",
      "description: Loop harness",
      "---",
      "# Superintendent",
      "",
      "Body",
      ""
    ].join("\n");

    vol.fromJSON({
      "/repo/.poe-code/memory/pages/packages/superintendent.md": content
    });

    await expect(
      readPage("/repo/.poe-code/memory", "pages/packages/superintendent.md")
    ).resolves.toEqual({
      relPath: "pages/packages/superintendent.md",
      frontmatter: {
        name: "superintendent",
        description: "Loop harness"
      },
      body: "# Superintendent\n\nBody\n",
      bytes: Buffer.byteLength(content),
      mtimeMs: expect.any(Number)
    });
  });

  it("falls back to the raw body and warns when frontmatter is malformed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const content = ["---", "name: [broken", "---", "# Broken", ""].join("\n");

    vol.fromJSON({
      "/repo/.poe-code/memory/pages/broken.md": content
    });

    await expect(readPage("/repo/.poe-code/memory", "pages/broken.md")).resolves.toEqual({
      relPath: "pages/broken.md",
      frontmatter: {},
      body: content,
      bytes: Buffer.byteLength(content),
      mtimeMs: expect.any(Number)
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse frontmatter for "pages/broken.md"')
    );
  });

  it("rejects traversal and non-markdown paths", async () => {
    await expect(readPage("/repo/.poe-code/memory", "../secrets.md")).rejects.toThrow(/escape/i);
    await expect(readPage("/repo/.poe-code/memory", "pages/notes.txt")).rejects.toThrow(
      /markdown/i
    );
  });

  it("rejects reads through symlinked page directories", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/pages/.keep": "",
      "/outside/secret.md": "# Outside\nsecret text\n"
    });
    await vol.promises.symlink("/outside", "/repo/.poe-code/memory/pages/linked");

    await expect(
      readPage("/repo/.poe-code/memory", "pages/linked/secret.md")
    ).rejects.toThrow(/symbolic link/i);
  });
});
