import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { listMemoryFiles, listPages, readPage } = await import("./pages.js");

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

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

  it("rejects a symlinked top-level pages directory", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Index\n",
      "/outside/pages/secret.md": "# Outside\nsecret text\n"
    });
    await vol.promises.symlink("/outside/pages", "/repo/.poe-code/memory/pages");

    await expect(listPages("/repo/.poe-code/memory")).rejects.toThrow(/symbolic link/i);
  });

  it("does not treat inherited lstat error codes as missing path segments", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/pages/local.md": "# Local\n"
    });
    const lstat = vol.promises.lstat.bind(vol.promises);
    vi.spyOn(vol.promises, "lstat").mockImplementation(async (targetPath) => {
      if (String(targetPath) === "/repo/.poe-code/memory/pages") {
        throw new Error("page lstat denied");
      }

      return lstat(targetPath);
    });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(listPages("/repo/.poe-code/memory")).rejects.toThrow("page lstat denied");
    });
  });

  it("does not treat inherited readdir error codes as missing page directories", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/pages/local.md": "# Local\n"
    });
    const readdir = vol.promises.readdir.bind(vol.promises);
    vi.spyOn(vol.promises, "readdir").mockImplementation(async (targetPath, options) => {
      if (String(targetPath) === "/repo/.poe-code/memory/pages") {
        throw new Error("page scan denied");
      }

      return readdir(targetPath, options);
    });

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(listPages("/repo/.poe-code/memory")).rejects.toThrow("page scan denied");
    });
  });
});

describe("listMemoryFiles", () => {
  beforeEach(() => {
    vol.reset();
  });

  it("lists the memory root INDEX.md and LOG.md alongside pages", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/LOG.md": "",
      "/repo/.poe-code/memory/pages/one.md": "# One\n"
    });

    await expect(listMemoryFiles("/repo/.poe-code/memory")).resolves.toMatchObject([
      { relPath: "INDEX.md", body: "# Memory index\n" },
      { relPath: "LOG.md", body: "" },
      { relPath: "pages/one.md", body: "# One\n" }
    ]);
  });

  it("skips ingest cache entries at the memory root", async () => {
    vol.fromJSON({
      "/repo/.poe-code/memory/INDEX.md": "# Memory index\n",
      "/repo/.poe-code/memory/.cache/ingest/entry.md": "# Cached\n"
    });

    await expect(listMemoryFiles("/repo/.poe-code/memory")).resolves.toMatchObject([
      { relPath: "INDEX.md" }
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
